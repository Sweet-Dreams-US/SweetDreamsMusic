import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { generateRsvpToken } from '@/lib/events';
import { sendEventInvitation } from '@/lib/email';

/**
 * POST /api/admin/events/[id]/invites — bulk invite by email.
 *
 * Body: { emails: string[], message?: string }
 *
 * For each email:
 *   - Dedupe against existing `invited` rows for this event (skip if one
 *     exists and hasn't been responded to — re-send would just confuse them).
 *   - Lookup if that email belongs to an existing profile; if so, link user_id
 *     so the invite also appears in their /dashboard/events view.
 *   - Create event_rsvps row with status='invited', invited_email, token,
 *     invited_by.
 *   - Send sendEventInvitation email (fire and forget per-address so one bad
 *     email doesn't fail the whole batch).
 *
 * Returns { results: Array<{ email, status: 'sent'|'skipped'|'failed', reason? }> }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;

  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) {
    return NextResponse.json({ error: 'Admins only' }, { status: 401 });
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { emails?: string[]; message?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const rawEmails = Array.isArray(body.emails) ? body.emails : [];
  const emails = Array.from(
    new Set(
      rawEmails
        .map((e) => typeof e === 'string' ? e.trim().toLowerCase() : '')
        .filter((e) => e && e.includes('@')),
    ),
  );

  if (emails.length === 0) {
    return NextResponse.json({ error: 'No valid email addresses provided' }, { status: 400 });
  }

  const customNote = typeof body.message === 'string' ? body.message.trim() : '';

  const service = createServiceClient();

  // Fetch event details once — we need them for the email body + to confirm
  // the event exists.
  const { data: event } = await service
    .from('events')
    .select('id, title, slug, starts_at, location')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  // Inviter display name — prefer profile.display_name, fall back to email.
  const { data: inviterProfile } = await service
    .from('profiles')
    .select('display_name')
    .eq('user_id', user.id)
    .maybeSingle();
  const inviterName = inviterProfile?.display_name || user.email || 'A Sweet Dreams admin';

  // Batch-lookup profiles for all invitee emails — lets us link user_id when
  // available, so invites also surface in their /dashboard/events.
  const { data: profileMatches } = await service
    .from('profiles')
    .select('user_id, email')
    .in('email', emails);
  const emailToUserId = new Map<string, string>();
  for (const p of (profileMatches || []) as { user_id: string; email: string }[]) {
    emailToUserId.set(p.email.toLowerCase(), p.user_id);
  }

  const results: Array<{ email: string; status: 'sent' | 'skipped' | 'failed'; reason?: string }> = [];

  // Throttle invites to 2/sec to stay under Resend's per-second cap.
  // Each invitation is a unique email (per-recipient token + personalized
  // note), so we can't use the batch API — have to send serially with a
  // small delay.
  const INTER_SEND_MS = 500;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let emailsSentThisRun = 0;

  for (const email of emails) {
    // Skip if there's already a pending invite for this email.
    const existingQuery = service
      .from('event_rsvps')
      .select('id, status, responded_at')
      .eq('event_id', eventId);
    const matchedUserId = emailToUserId.get(email);
    const { data: existing } = matchedUserId
      ? await existingQuery.or(`invited_email.ilike.${email},user_id.eq.${matchedUserId}`).maybeSingle()
      : await existingQuery.ilike('invited_email', email).maybeSingle();

    if (existing && existing.status === 'invited' && !existing.responded_at) {
      results.push({ email, status: 'skipped', reason: 'Already invited' });
      continue;
    }
    if (existing && (existing.status === 'going' || existing.status === 'maybe')) {
      results.push({ email, status: 'skipped', reason: `Already ${existing.status}` });
      continue;
    }

    const token = generateRsvpToken();
    const { error: insertErr } = await service.from('event_rsvps').insert({
      event_id: eventId,
      user_id: matchedUserId || null,
      invited_email: email,
      invited_by: user.id,
      status: 'invited',
      token,
    });
    if (insertErr) {
      console.error('[admin:events:invites] insert failed for', email, insertErr);
      results.push({ email, status: 'failed', reason: 'DB insert failed' });
      continue;
    }

    // Throttle between sends (skip the first one so it's immediate).
    if (emailsSentThisRun > 0) await sleep(INTER_SEND_MS);

    try {
      await sendEventInvitation({
        toEmail: email,
        eventTitle: event.title,
        eventSlug: event.slug,
        eventStartsAt: event.starts_at,
        eventLocation: event.location,
        inviterName,
        token,
        customNote: customNote || undefined,
      });
      results.push({ email, status: 'sent' });
      emailsSentThisRun++;
    } catch (e) {
      console.error('[admin:events:invites] email failed for', email, e);
      results.push({ email, status: 'failed', reason: 'Email send failed' });
    }
  }

  return NextResponse.json({ results });
}
