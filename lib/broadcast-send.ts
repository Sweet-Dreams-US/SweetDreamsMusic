import { Resend } from 'resend';
import { createServiceClient } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/constants';

const FROM = 'Sweet Dreams Music <studio@sweetdreamsmusic.com>';

// Resend allows ~25 requests/sec. resend.batch.send packs up to 100 emails
// into ONE request, so chunks of 100 with a 500ms gap = at most 2 req/sec —
// comfortably under the limit.
const BATCH_SIZE = 100;
const INTER_BATCH_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wrap the admin-entered body fragment in the full Sweet Dreams email shell.
 * Kept identical to the original POST route so resumed sends look the same.
 */
function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#000;font-family:'IBM Plex Mono',monospace;color:#fff"><div style="max-width:600px;margin:0 auto;padding:40px 24px">${content}<div style="margin-top:40px;padding-top:24px;border-top:1px solid #333;text-align:center"><p style="color:#666;font-size:11px;margin:0">Sweet Dreams Music LLC &mdash; Fort Wayne, IN</p><p style="color:#666;font-size:11px;margin:4px 0 0"><a href="${SITE_URL}" style="color:#F4C430;text-decoration:none">sweetdreamsmusic.com</a></p></div></div></body></html>`;
}

/**
 * Detect a Resend rate-limit / quota error from either a thrown exception or
 * the `error` field on a batch response. When this trips we STOP and leave the
 * remaining recipients 'pending' so a later resume picks up exactly where we
 * left off — rather than burning attempts/marking them failed.
 */
function isRateLimitOrQuota(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as { statusCode?: number; status?: number; name?: string; message?: string };
  if (anyErr.statusCode === 429 || anyErr.status === 429) return true;
  const haystack = `${anyErr.name ?? ''} ${anyErr.message ?? ''} ${typeof err === 'string' ? err : ''}`.toLowerCase();
  return (
    haystack.includes('rate limit') ||
    haystack.includes('rate_limit') ||
    haystack.includes('too many requests') ||
    haystack.includes('429') ||
    haystack.includes('quota') ||
    haystack.includes('limit_exceeded') ||
    haystack.includes('daily_quota')
  );
}

export interface SendResult {
  sent: number;
  failed: number;
  pending: number;
}

interface RecipientRow {
  id: string;
  email: string;
  attempts: number;
}

/**
 * Send (or resume sending) a broadcast to every recipient that is NOT yet
 * 'sent'. Safe to call repeatedly: a recipient already marked 'sent' is never
 * loaded here, so it is NEVER re-sent (no duplicates).
 *
 * Behavior:
 *  - Loads the admin_broadcasts row (subject, body_html) and its
 *    broadcast_recipients WHERE status IN ('pending','failed').
 *  - Sends in chunks of <=100 via resend.batch.send, 500ms between chunks.
 *  - On chunk success: mark each recipient status='sent', sent_at=now().
 *  - On a non-rate-limit chunk error: mark those recipients status='failed',
 *    record the error, attempts+1 (they're retryable on the next resume).
 *  - On a Resend 429 / rate-limit / quota error: STOP gracefully and leave the
 *    remaining recipients 'pending' so a later resume continues them.
 *  - Finally recomputes the broadcast's sent_count / failed_count / send_status.
 */
export async function sendPendingBroadcast(broadcastId: string): Promise<SendResult> {
  const service = createServiceClient();

  const { data: broadcast, error: bErr } = await service
    .from('admin_broadcasts')
    .select('id, subject, body_html')
    .eq('id', broadcastId)
    .single();

  if (bErr || !broadcast) {
    throw new Error(`Broadcast ${broadcastId} not found: ${bErr?.message ?? 'no row'}`);
  }

  const { data: pendingRows, error: rErr } = await service
    .from('broadcast_recipients')
    .select('id, email, attempts')
    .eq('broadcast_id', broadcastId)
    .in('status', ['pending', 'failed'])
    .order('created_at', { ascending: true });

  if (rErr) {
    throw new Error(`Failed to load recipients for ${broadcastId}: ${rErr.message}`);
  }

  const recipients = (pendingRows ?? []) as RecipientRow[];

  // Nothing to do — still recompute counters so callers get fresh numbers.
  if (recipients.length === 0) {
    return finalizeCounts(broadcastId);
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fullHtml = wrapEmail(broadcast.body_html as string);
  const subject = broadcast.subject as string;

  let stoppedForRateLimit = false;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const payload = chunk.map((r) => ({ from: FROM, to: r.email, subject, html: fullHtml }));

    let chunkError: unknown = null;
    try {
      const result = await resend.batch.send(payload);
      if (result.error) chunkError = result.error;
    } catch (e) {
      chunkError = e;
    }

    if (!chunkError) {
      // Whole chunk accepted by Resend — mark every recipient sent.
      const nowIso = new Date().toISOString();
      const ids = chunk.map((r) => r.id);
      await service
        .from('broadcast_recipients')
        .update({ status: 'sent', sent_at: nowIso, error: null })
        .in('id', ids);
    } else if (isRateLimitOrQuota(chunkError)) {
      // Rate-limited / out of quota: STOP. Leave this chunk (and everything
      // after it) 'pending' so a resume continues cleanly with no duplicates.
      stoppedForRateLimit = true;
      break;
    } else {
      // A real per-chunk error (bad address, transient failure, etc.).
      // Mark them 'failed' with the message + bump attempts, but DON'T lose
      // them — a future resume retries 'failed' recipients too.
      const msg = errorMessage(chunkError);
      for (const r of chunk) {
        await service
          .from('broadcast_recipients')
          .update({ status: 'failed', error: msg, attempts: r.attempts + 1 })
          .eq('id', r.id);
      }
    }

    // Throttle between chunks (skip after the last, and don't bother if we
    // already decided to stop).
    if (!stoppedForRateLimit && i + BATCH_SIZE < recipients.length) {
      await sleep(INTER_BATCH_MS);
    }
  }

  return finalizeCounts(broadcastId);
}

function errorMessage(err: unknown): string {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  const anyErr = err as { message?: string };
  return anyErr.message ?? 'unknown error';
}

/**
 * Recompute the broadcast roll-up from the source-of-truth recipient rows and
 * persist it. send_status is 'complete' only when nothing is left to send.
 */
async function finalizeCounts(broadcastId: string): Promise<SendResult> {
  const service = createServiceClient();

  const counts = { sent: 0, failed: 0, pending: 0 };
  for (const status of ['sent', 'failed', 'pending'] as const) {
    const { count } = await service
      .from('broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', broadcastId)
      .eq('status', status);
    counts[status] = count ?? 0;
  }

  const sendStatus = counts.pending + counts.failed === 0 ? 'complete' : 'partial';

  await service
    .from('admin_broadcasts')
    .update({
      sent_count: counts.sent,
      failed_count: counts.failed,
      send_status: sendStatus,
    })
    .eq('id', broadcastId);

  return counts;
}
