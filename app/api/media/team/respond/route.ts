// app/api/media/team/respond/route.ts
//
// Media manager responds to an incoming media shoot request (Phase 5).
// Mirrors app/api/booking/respond/route.ts (engineer accept/pass) but for the
// shared media-team queue:
//   - accept  → per-manager conflict check, then atomic claim
//               (media_manager_id null → me, status 'requested' → 'scheduled')
//   - decline → cancel the request + REFUND the credit (it wasn't done)
//
// Any media_manager (or admin) can act on any request — it's a shared team
// queue, not per-person. The atomic `.is('media_manager_id', null)` guard
// prevents two managers double-claiming.

import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyMediaManagerAccess } from '@/lib/admin-auth';
import { checkMediaManagerConflict } from '@/lib/media-scheduling-server';
import { fmtStampDateTime } from '@/lib/studio-time';
import { SITE_URL } from '@/lib/constants';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!(await verifyMediaManagerAccess(supabase))) {
    return NextResponse.json({ error: 'Media team only' }, { status: 403 });
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { sessionId, action } = await request.json();
  // accept   → claim an unclaimed request (→ scheduled)
  // cancel   → cancel a request OR scheduled job + REFUND the credit
  // complete → mark a scheduled/in-progress job done (credit stays consumed)
  // ("decline" kept as an alias of cancel for the incoming-requests UI.)
  const act = action === 'decline' ? 'cancel' : action;
  if (!sessionId || !['accept', 'cancel', 'complete'].includes(act)) {
    return NextResponse.json({ error: 'sessionId and action ("accept"|"cancel"|"complete") required' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: session } = await service
    .from('media_session_bookings')
    .select('id, status, media_manager_id, media_credit_id, requested_by, starts_at, ends_at, session_kind')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

  const s = session as {
    id: string; status: string; media_manager_id: string | null; media_credit_id: string | null;
    requested_by: string | null; starts_at: string; ends_at: string; session_kind: string;
  };

  // Resolve requester email for notifications.
  async function requesterEmail(): Promise<string | null> {
    if (!s.requested_by) return null;
    const { data } = await service.from('profiles').select('email').eq('user_id', s.requested_by).maybeSingle();
    return (data as { email?: string } | null)?.email ?? null;
  }
  const whenLabel = fmtStampDateTime(s.starts_at, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  // ── ACCEPT ──────────────────────────────────────────────────────────
  if (action === 'accept') {
    if (s.media_manager_id) {
      return NextResponse.json({ error: 'Already claimed by another manager.' }, { status: 409 });
    }
    if (s.status !== 'requested') {
      return NextResponse.json({ error: `Cannot accept a ${s.status} request.` }, { status: 409 });
    }
    // Per-manager conflict check (their other media sessions only).
    const conflict = await checkMediaManagerConflict(
      { managerId: user.id, startsAt: s.starts_at, endsAt: s.ends_at },
      service,
    );
    if (conflict) {
      return NextResponse.json(
        { error: `You're already booked then: ${conflict.label}` },
        { status: 409 },
      );
    }
    // Atomic claim — only succeeds if still unclaimed.
    const { data: updated, error } = await service
      .from('media_session_bookings')
      .update({
        media_manager_id: user.id,
        confirmed_by: user.id,
        confirmed_at: new Date().toISOString(),
        status: 'scheduled',
      })
      .eq('id', sessionId)
      .is('media_manager_id', null)
      .select('id')
      .single();
    if (error || !updated) {
      return NextResponse.json({ error: 'Just claimed by another manager.' }, { status: 409 });
    }

    const email = await requesterEmail();
    if (email) {
      try {
        await resend.emails.send({
          from: 'Sweet Dreams Music <studio@sweetdreamsmusic.com>',
          to: [email],
          subject: `Your media shoot is confirmed — ${whenLabel}`,
          html: `
            <h2>Confirmed 🎬</h2>
            <p>Your ${s.session_kind} shoot on <strong>${whenLabel}</strong> (Fort Wayne) is confirmed. The media team will reach out to plan the details.</p>
            <p><a href="${SITE_URL}/dashboard/hub?tab=media">View in your Artist Hub</a></p>
          `,
        });
      } catch (e) { console.error('[media/respond] confirm email error:', e); }
    }
    return NextResponse.json({ ok: true, action: 'accepted' });
  }

  // ── COMPLETE ────────────────────────────────────────────────────────
  // The shoot happened. Credit was already decremented at request time, so
  // completion just flips status — the credit stays permanently consumed.
  if (act === 'complete') {
    if (!['scheduled', 'in_progress', 'requested'].includes(s.status)) {
      return NextResponse.json({ error: `Cannot complete a ${s.status} session.` }, { status: 409 });
    }
    const { error } = await service
      .from('media_session_bookings')
      .update({ status: 'completed' })
      .eq('id', sessionId);
    if (error) return NextResponse.json({ error: 'Could not complete' }, { status: 500 });
    return NextResponse.json({ ok: true, action: 'completed' });
  }

  // ── CANCEL ──────────────────────────────────────────────────────────
  // Cancel + refund the credit (the shoot didn't happen). Completion is the
  // only path that permanently consumes a credit.
  if (s.status === 'completed') {
    return NextResponse.json({ error: 'Cannot cancel a completed session.' }, { status: 409 });
  }
  if (s.status === 'cancelled') {
    return NextResponse.json({ error: 'Already cancelled.' }, { status: 409 });
  }
  const { error: cancelErr } = await service
    .from('media_session_bookings')
    .update({ status: 'cancelled' })
    .eq('id', sessionId);
  if (cancelErr) {
    return NextResponse.json({ error: 'Could not decline' }, { status: 500 });
  }
  // Refund: give the credit back (decrement quantity_redeemed by 1, floor 0).
  if (s.media_credit_id) {
    const { data: cr } = await service
      .from('media_credits')
      .select('quantity_redeemed')
      .eq('id', s.media_credit_id)
      .maybeSingle();
    const used = (cr as { quantity_redeemed?: number } | null)?.quantity_redeemed ?? 0;
    if (used > 0) {
      await service.from('media_credits')
        .update({ quantity_redeemed: used - 1 })
        .eq('id', s.media_credit_id)
        .eq('quantity_redeemed', used);
    }
  }
  const email = await requesterEmail();
  if (email) {
    try {
      await resend.emails.send({
        from: 'Sweet Dreams Music <studio@sweetdreamsmusic.com>',
        to: [email],
        subject: `Update on your media request — ${whenLabel}`,
        html: `
          <h2>We couldn't lock that time</h2>
          <p>Your ${s.session_kind} request for ${whenLabel} couldn't be confirmed and your credit has been returned to your balance. Please pick another time in your <a href="${SITE_URL}/dashboard/hub?tab=media">Artist Hub</a>, or reply and we'll help.</p>
        `,
      });
    } catch (e) { console.error('[media/respond] decline email error:', e); }
  }
  return NextResponse.json({ ok: true, action: 'declined', credit_refunded: !!s.media_credit_id });
}
