// app/api/media/inquiry/route.ts
//
// Submit endpoint for the media inquiry form. Two outcomes:
//   1. Insert a `media_bookings` row with status='inquiry' so the lead is
//      tracked in our own system (admin can convert it to 'deposited' later
//      once the buyer pays).
//   2. Email Jay + Cole via `sendMediaInquiry` with the message + offering.
//
// Validation:
//   - Auth required
//   - Offering must exist + be active + be visible to the viewer
//   - Offering must NOT have a fixed price (those use the buy/configure path)
//   - Band attribution: if the buyer claims a band_id they're not actually
//     in, we drop it silently (treat as personal inquiry) rather than
//     erroring — defensive against form-state edge cases
//
// We never block the response on the email send. If Resend is down, the row
// still gets written and the team can reach out via the admin pipeline.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getOfferingBySlug } from '@/lib/media-server';
import { getUserBands } from '@/lib/bands-server';
import { isOfferingVisibleTo, viewerEligibilityFromBands } from '@/lib/media';
import { sendMediaInquiry } from '@/lib/email';

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }

  // ── Parse + validate input ──────────────────────────────────────────
  let slug: string | undefined;
  let name = '';
  let phone = '';
  let message = '';
  let bandId: string | null = null;
  try {
    const body = await request.json();
    slug = body.slug;
    name = (body.name || '').toString().trim();
    phone = (body.phone || '').toString().trim();
    message = (body.message || '').toString().trim();
    bandId = body.band_id || null;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!slug || typeof slug !== 'string') {
    return NextResponse.json({ error: 'slug required' }, { status: 400 });
  }
  if (name.length < 2) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  // Phone is now required — admin calls these inquiries to plan.
  // Same permissive digit count as the cart sidebar (phones come in
  // many formats; we just need enough to dial).
  const phoneClean = phone.replace(/\D/g, '');
  if (phoneClean.length < 7) {
    return NextResponse.json({ error: 'Phone number required' }, { status: 400 });
  }
  if (message.length < 10) {
    return NextResponse.json({ error: 'message too short' }, { status: 400 });
  }

  // ── Look up offering + visibility check ─────────────────────────────
  const offering = await getOfferingBySlug(slug);
  if (!offering || !offering.is_active) {
    return NextResponse.json({ error: 'Offering not found' }, { status: 404 });
  }

  const bandMemberships = await getUserBands(user.id);
  const viewer = viewerEligibilityFromBands({
    authenticated: true,
    bandCount: bandMemberships.length,
  });
  if (!isOfferingVisibleTo(offering, viewer)) {
    return NextResponse.json({ error: 'Offering not available' }, { status: 403 });
  }

  // ── Reject inquiries on fixed-price offerings ───────────────────────
  // Those should go through buy/configure. Sending an inquiry on them
  // wastes the team's time and is almost always a misclick.
  const hasFixedPrice =
    offering.price_cents != null &&
    offering.price_range_low_cents == null &&
    offering.price_range_high_cents == null;
  if (hasFixedPrice) {
    return NextResponse.json(
      { error: 'This offering has a fixed price — please buy or configure instead' },
      { status: 400 },
    );
  }

  // ── Band attribution sanity check ───────────────────────────────────
  // If the user claims a band_id they're not actually a member of, drop
  // the attribution silently. Don't 403 — they might just have stale
  // form state from a band they left.
  let attributedBand: { id: string; name: string } | null = null;
  if (bandId) {
    const match = bandMemberships.find((m) => m.band_id === bandId);
    if (match) {
      attributedBand = { id: match.band_id, name: match.band.display_name };
    }
  }

  // ── Insert media_bookings row ───────────────────────────────────────
  // Use service role so RLS doesn't get in the way for the write. The
  // status='inquiry' state has zero pricing claims attached — it's a lead
  // record that admin can later convert into a paid booking.
  const service = createServiceClient();
  const { data: newBooking, error: insertErr } = await service
    .from('media_bookings')
    .insert({
      offering_id: offering.id,
      user_id: user.id,
      band_id: attributedBand?.id ?? null,
      status: 'inquiry',
      // Inquiry rows have no price commitment yet. We store 0 to satisfy
      // the NOT NULL constraint on final_price_cents and the admin UI
      // can fill in a real number when they convert this to deposited.
      final_price_cents: 0,
      customer_phone: phone,
      notes_to_us: `${name}\n\n${message}`,
    })
    .select('id')
    .single();

  // Persist the phone to profile so the buyer doesn't re-enter on
  // future inquiries. Best-effort — log + continue if this fails.
  try {
    await service
      .from('profiles')
      .update({ phone })
      .eq('user_id', user.id);
  } catch (e) {
    console.warn('[media/inquiry] profile phone update failed', e);
  }

  if (insertErr) {
    console.error('[media] inquiry insert failed:', insertErr);
    return NextResponse.json(
      { error: 'Could not save inquiry — try again or email us directly.' },
      { status: 500 },
    );
  }

  // ── Send email — fire-and-forget. Email failure does not roll back.
  try {
    await sendMediaInquiry({
      inquirerName: name,
      inquirerEmail: user.email,
      inquirerPhone: phone,
      offeringTitle: offering.title,
      offeringSlug: offering.slug,
      bandName: attributedBand?.name ?? null,
      message,
    });
  } catch (e) {
    console.error('[media] inquiry email error:', e);
    // Don't fail the request — the row is written, admin will see it.
  }

  return NextResponse.json({ ok: true, inquiry_id: newBooking?.id });
}
