// /api/listen/[token] — the public listen-page API. No auth (the token IS the
// auth). GET: validate + return track meta and a SHORT-TTL signed stream URL
// (15 min — long enough to listen, useless to hotlink). POST: actions —
// 'play' increments the counter (listening_party at 25), 'feedback' records
// a response and re-evaluates the artist's gates (s2_share).

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { evaluateGates } from '@/lib/career-rules';
import { grantAchievement } from '@/lib/achievements-server';
import { CAREER_ACHIEVEMENTS, shareLinkInvalidReason } from '@/lib/career';

async function loadValidLink(token: string) {
  const db = createServiceClient();
  const { data } = await db.from('track_share_links').select('*').eq('token', token).maybeSingle();
  if (!data) return { db, link: null, reason: 'not_found' as const };
  const link = data as any;
  const invalid = shareLinkInvalidReason(link);
  if (invalid) return { db, link: null, reason: invalid };
  return { db, link, reason: null };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { db, link, reason } = await loadValidLink(token);
  if (!link) return NextResponse.json({ error: reason }, { status: reason === 'not_found' ? 404 : 410 });

  const { data: artist } = await db.from('profiles')
    .select('display_name').eq('user_id', link.user_id).maybeSingle();

  let streamUrl: string | null = null;
  if (link.deliverable_id) {
    const { data: file } = await db.from('deliverables')
      .select('file_path').eq('id', link.deliverable_id).maybeSingle();
    if (file) {
      const { data: signed } = await db.storage.from('client-audio-files')
        .createSignedUrl((file as any).file_path, 900); // 15 min — listen, not hoard
      streamUrl = signed?.signedUrl ?? null;
    }
  }
  if (!streamUrl) return NextResponse.json({ error: 'track_unavailable' }, { status: 410 });

  return NextResponse.json({
    trackLabel: link.track_label,
    artistName: (artist as any)?.display_name ?? 'the artist',
    streamUrl,
    playCount: link.play_count,
  });
}

// Cheap listener fingerprint: hashed IP + day bucket. Not PII at rest (hashed),
// just enough to dedup play inflation without auth.
async function listenerKey(req: NextRequest): Promise<string> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip') || 'anon';
  const day = new Date().toISOString().slice(0, 10);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${day}`));
  return Array.from(new Uint8Array(buf)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { db, link, reason } = await loadValidLink(token);
  if (!link) return NextResponse.json({ error: reason }, { status: reason === 'not_found' ? 404 : 410 });

  if (body.action === 'play') {
    // Atomic vanity counter (no lost updates).
    const { data: newCount } = await db.rpc('increment_share_play', { p_link_id: link.id });
    if (Number(newCount) >= 25) await grantAchievement(db, link.user_id, CAREER_ACHIEVEMENTS.sharing.party);

    // GATE/rollout signal uses DISTINCT listeners (one per IP per day), so a
    // refresh/curl loop can't manufacture the 5+ share_plays rollout item.
    const key = await listenerKey(req);
    const { error: dupErr } = await db.from('track_share_plays')
      .insert({ share_link_id: link.id, listener_key: key } as never);
    // 23505 = this listener already counted today (expected). Any OTHER error
    // is a real failure — log it; don't silently treat it as a dup.
    if (dupErr && (dupErr as { code?: string }).code !== '23505') {
      console.error('[listen] play dedup insert failed:', dupErr.message);
    }
    const firstToday = !dupErr;
    if (firstToday && link.project_id) {
      try {
        const { recomputeProjectRollout } = await import('@/lib/career-rules');
        await recomputeProjectRollout(db, link.project_id);
      } catch { /* best-effort */ }
    }
    return NextResponse.json({ success: true });
  }

  if (body.action === 'feedback') {
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const vibe = Math.round(Number(body.vibe_score));
    if (!name || !email || !/.+@.+\..+/.test(email)) return NextResponse.json({ error: 'Name and a real email required' }, { status: 400 });
    if (!(vibe >= 1 && vibe <= 10)) return NextResponse.json({ error: 'Vibe must be 1-10' }, { status: 400 });

    // One response per email per link.
    const { data: dup } = await db.from('track_share_feedback').select('id')
      .eq('share_link_id', link.id).eq('listener_email', email).limit(1);
    if (dup && dup.length > 0) return NextResponse.json({ success: true, duplicate: true });

    const { error } = await db.from('track_share_feedback').insert({
      share_link_id: link.id, listener_name: name, listener_email: email,
      vibe_score: vibe,
      favorite_moment_seconds: body.favorite_moment_seconds != null ? Math.max(0, Math.round(Number(body.favorite_moment_seconds))) : null,
      comment: body.comment ? String(body.comment).slice(0, 2000) : null,
    } as never);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Feedback achievements + gate re-evaluation for the ARTIST. The
    // feedback10 count, like the s2_share gate (buildContext), excludes the
    // artist's OWN email so they can't farm it with throwaways.
    try {
      const { data: owner } = await db.from('profiles').select('email').eq('user_id', link.user_id).maybeSingle();
      const ownerEmail = String((owner as any)?.email || '').toLowerCase();
      const { data: rows } = await db.from('track_share_feedback')
        .select('listener_email,track_share_links!inner(user_id)')
        .eq('track_share_links.user_id', link.user_id);
      const distinct = new Set(((rows ?? []) as any[])
        .map((r) => String(r.listener_email || '').toLowerCase())
        .filter((e) => e && e !== ownerEmail));
      if (distinct.size >= 10) await grantAchievement(db, link.user_id, CAREER_ACHIEVEMENTS.sharing.feedback10);
      await evaluateGates(db, link.user_id);
    } catch (e) { console.error('[career] feedback hook failed:', e); }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
