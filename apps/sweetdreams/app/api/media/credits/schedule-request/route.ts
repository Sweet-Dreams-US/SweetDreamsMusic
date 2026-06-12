// app/api/media/credits/schedule-request/route.ts
//
// Artist schedules a media shoot against a media_credit (Phase 5). Unlike the
// studio credit flow, the artist picks ONLY a date/time + types their vision —
// no studio room, no videographer. This creates a media_session_bookings row
// with status='requested'; the media team confirms it later (/api/media/team/
// respond). The credit is optimistically decremented (refunded if the request
// insert or a later cancellation fails / happens).
//
// Time handling: media_session_bookings.starts_at/ends_at are TRUE UTC
// instants. The artist enters studio-local (Eastern) wall-clock; we convert
// via studioInputToUtcISO. The 48h-lead check then compares against Date.now()
// (correct, since storage is real UTC).

import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getUserBands } from '@/lib/bands-server';
import { getMediaManagerEmails } from '@/lib/media-team-server';
import {
  SCHEDULABLE_CREDIT_KINDS,
  CREDIT_KIND_LABELS,
  sessionKindForCreditKind,
  defaultDurationHoursForCreditKind,
  type CreditKind,
} from '@/lib/media-credits';
import { violates48hLead } from '@/lib/media-scheduling';
import { studioInputToUtcISO } from '@/lib/studio-time';
import { fmtStampDateTime } from '@/lib/studio-time';
import { SITE_URL } from '@/lib/constants';
import { emailIdentity } from '@/lib/email';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const creditId = String(body.credit_id || '').trim();
  const date = String(body.date || '').trim(); // YYYY-MM-DD (studio-local)
  const startTime = String(body.start_time || '').trim(); // HH:MM (studio-local)
  const vision = body.vision ? String(body.vision).trim() : '';
  const locationPref = body.location === 'external' ? 'external' : 'studio';
  const externalLocationText = body.external_location_text ? String(body.external_location_text).trim() : null;

  if (!creditId) return NextResponse.json({ error: 'credit_id required' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (!/^\d{2}:\d{2}$/.test(startTime)) {
    return NextResponse.json({ error: 'start_time must be HH:MM' }, { status: 400 });
  }
  if (!vision || vision.length < 3) {
    return NextResponse.json({ error: 'Tell the team your vision/goals for the shoot (a sentence is fine).' }, { status: 400 });
  }

  // studio-local wall-clock → true UTC instant (DST-aware).
  const startsAt = studioInputToUtcISO(`${date}T${startTime}`);
  if (!startsAt) {
    return NextResponse.json({ error: 'Invalid date/time' }, { status: 400 });
  }

  // 48-hour minimum lead (server-authoritative; client also enforces).
  if (violates48hLead(startsAt)) {
    return NextResponse.json(
      { error: 'Media shoots must be booked at least 48 hours in advance.' },
      { status: 400 },
    );
  }

  // ── Validate credit ownership + balance + schedulability ────────────
  const service = createServiceClient();
  const { data: credit, error: creditErr } = await service
    .from('media_credits')
    .select('id, user_id, band_id, credit_kind, quantity_granted, quantity_redeemed, source_booking_id, tier')
    .eq('id', creditId)
    .maybeSingle();
  if (creditErr || !credit) {
    return NextResponse.json({ error: 'Credit not found' }, { status: 404 });
  }
  const c = credit as {
    id: string; user_id: string | null; band_id: string | null;
    credit_kind: CreditKind; quantity_granted: number; quantity_redeemed: number;
    source_booking_id: string | null; tier: string | null;
  };

  if (c.user_id && c.user_id !== user.id) {
    return NextResponse.json({ error: 'Not your credit' }, { status: 403 });
  }
  if (c.band_id) {
    const memberships = await getUserBands(user.id);
    if (!memberships.some((m) => m.band_id === c.band_id)) {
      return NextResponse.json({ error: 'Not in that band' }, { status: 403 });
    }
  }
  if (!SCHEDULABLE_CREDIT_KINDS.includes(c.credit_kind)) {
    return NextResponse.json({ error: 'That credit is handled by the team directly — no shoot to schedule.' }, { status: 400 });
  }
  const remaining = Number(c.quantity_granted) - Number(c.quantity_redeemed);
  if (remaining < 1) {
    return NextResponse.json({ error: 'No remaining balance for that credit.' }, { status: 400 });
  }

  // ── Compute end + insert the request ────────────────────────────────
  const durationHours = defaultDurationHoursForCreditKind(c.credit_kind);
  const endsAt = new Date(new Date(startsAt).getTime() + durationHours * 3_600_000).toISOString();
  const sessionKind = sessionKindForCreditKind(c.credit_kind);

  const { data: sessionRow, error: insErr } = await service
    .from('media_session_bookings')
    .insert({
      parent_booking_id: c.source_booking_id, // may be null (comp credit)
      media_credit_id: c.id,
      requested_by: user.id,
      vision,
      starts_at: startsAt,
      ends_at: endsAt,
      location: locationPref,
      external_location_text: locationPref === 'external' ? externalLocationText : null,
      engineer_id: null,
      media_manager_id: null,
      session_kind: sessionKind,
      status: 'requested',
      notes: `Requested via media credit ${c.credit_kind}${c.tier ? ` (${c.tier})` : ''}.`,
    })
    .select('id')
    .single();

  if (insErr || !sessionRow) {
    console.error('[media/schedule-request] insert error:', insErr);
    return NextResponse.json({ error: 'Could not create request' }, { status: 500 });
  }
  const sessionId = (sessionRow as { id: string }).id;

  // Optimistic decrement — CHECK (quantity_redeemed <= quantity_granted)
  // guards overdraw; optimistic WHERE guards concurrent drain. Roll back the
  // session row if it fails so we never strand a request without a credit.
  const { error: drainErr } = await service
    .from('media_credits')
    .update({ quantity_redeemed: Number(c.quantity_redeemed) + 1 })
    .eq('id', c.id)
    .eq('quantity_redeemed', c.quantity_redeemed);
  if (drainErr) {
    console.error('[media/schedule-request] credit drain error:', drainErr);
    await service.from('media_session_bookings').delete().eq('id', sessionId);
    return NextResponse.json({ error: 'Credit balance changed — please try again.' }, { status: 409 });
  }

  // ── Notify the media team + confirm to the artist (fire-and-forget) ──
  const whenLabel = fmtStampDateTime(startsAt, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  try {
    const teamEmails = await getMediaManagerEmails(service);
    if (teamEmails.length > 0) {
      await resend.emails.send({
        from: await emailIdentity(),
        to: teamEmails,
        subject: `🎬 New media request — ${CREDIT_KIND_LABELS[c.credit_kind]} (${whenLabel})`,
        html: `
          <h2>New media shoot request</h2>
          <p><strong>Type:</strong> ${CREDIT_KIND_LABELS[c.credit_kind]}${c.tier ? ` (${c.tier})` : ''}</p>
          <p><strong>Requested time:</strong> ${whenLabel} (Fort Wayne)</p>
          <p><strong>Location:</strong> ${locationPref}${externalLocationText ? ` — ${externalLocationText}` : ''}</p>
          <p><strong>Vision:</strong><br>${vision.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>
          <p><a href="${SITE_URL}/media-team">Open the media team dashboard</a> to accept or reschedule.</p>
        `,
      });
    }
    await resend.emails.send({
      from: await emailIdentity(),
      to: [user.email],
      subject: `Request received — ${CREDIT_KIND_LABELS[c.credit_kind]} on ${whenLabel}`,
      html: `
        <h2>We got your request</h2>
        <p>Your ${CREDIT_KIND_LABELS[c.credit_kind]} request for <strong>${whenLabel}</strong> (Fort Wayne) is in. The media team will confirm and reach out to plan the details.</p>
        <p>You can view it any time in your <a href="${SITE_URL}/dashboard/hub?tab=media">Artist Hub</a>.</p>
      `,
    });
  } catch (e) {
    console.error('[media/schedule-request] email error (non-fatal):', e);
  }

  return NextResponse.json({
    ok: true,
    session_id: sessionId,
    remaining: remaining - 1,
    starts_at: startsAt,
  });
}
