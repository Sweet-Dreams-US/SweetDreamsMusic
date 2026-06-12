// app/api/admin/media/bookings/manual/route.ts
//
// Admin manually creates a media_bookings row. Two modes:
//
//   • paymentMethod === 'cash' (or 'venmo' / 'check' / 'other'):
//     Booking is recorded as fully paid immediately (admin already
//     collected the money off-platform). Status lands at 'deposited'.
//     Cash gets a cash_ledger row. Audit log captures the action.
//
//   • paymentMethod === 'link':
//     Booking is created in 'inquiry' status with no payment yet.
//     A Stripe Payment Link is generated and emailed to the buyer.
//     The existing Stripe webhook /api/booking/webhook already
//     listens for payment_link.completed events with media metadata
//     so the buyer's payment lands on the right row automatically.
//
// Pattern mirrors /api/booking/invite/route.ts (studio sessions) so
// admins switching between studio + media flows see the same shape.
//
// Body: {
//   user_id: string,           // pick a buyer from the customer library
//   offering_id: string,       // which package they're buying
//   final_price_cents: number, // admin-set price (overrides offering.price_cents)
//   paymentMethod: 'cash' | 'venmo' | 'check' | 'other' | 'link',
//   collected_by?: string,     // for cash/venmo/check
//   note?: string,
//   band_id?: string | null,
//   notes_to_us?: string | null,
//   project_details?: object,  // matches buyer-facing inquiry shape
//   customer_phone?: string,
// }

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { sendMediaPaymentLink } from '@/lib/email';
import { SITE_URL } from '@/lib/constants';

const VALID_OFFLINE_METHODS = ['cash', 'venmo', 'check', 'other'] as const;
type OfflineMethod = (typeof VALID_OFFLINE_METHODS)[number];
type PaymentMethod = OfflineMethod | 'link';

export async function POST(request: NextRequest) {
  // ── Admin gate ─────────────────────────────────────────────────────
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  // ── Parse + validate ───────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  const offeringId = typeof body.offering_id === 'string' ? body.offering_id.trim() : '';
  const priceCents = typeof body.final_price_cents === 'number' ? body.final_price_cents : NaN;
  const paymentMethod = (typeof body.paymentMethod === 'string' ? body.paymentMethod : '') as PaymentMethod;
  const bandId = typeof body.band_id === 'string' && body.band_id.trim() ? body.band_id.trim() : null;
  const notesToUs = typeof body.notes_to_us === 'string' ? body.notes_to_us.trim() || null : null;
  const customerPhone = typeof body.customer_phone === 'string' ? body.customer_phone.trim() || null : null;
  const projectDetails =
    body.project_details && typeof body.project_details === 'object' && !Array.isArray(body.project_details)
      ? (body.project_details as Record<string, unknown>)
      : null;
  const collectedBy =
    typeof body.collected_by === 'string' && body.collected_by.trim()
      ? body.collected_by.trim()
      : user.email;
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  if (!userId) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  }
  if (!offeringId) {
    return NextResponse.json({ error: 'offering_id is required' }, { status: 400 });
  }
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    return NextResponse.json(
      { error: 'final_price_cents must be a non-negative integer' },
      { status: 400 },
    );
  }
  const allMethods = [...VALID_OFFLINE_METHODS, 'link'] as const;
  if (!allMethods.includes(paymentMethod)) {
    return NextResponse.json(
      { error: `paymentMethod must be one of: ${allMethods.join(', ')}` },
      { status: 400 },
    );
  }

  // ── Resolve buyer + offering ───────────────────────────────────────
  const service = createServiceClient();
  const [{ data: buyerRow }, { data: offeringRow }] = await Promise.all([
    // profiles.full_name does NOT exist in this schema — display_name is
    // the one full-name column on profiles. Selecting full_name caused the
    // query to error out and return null, which surfaced as "Buyer not
    // found" even when the dropdown showed a valid match.
    service.from('profiles').select('user_id, email, display_name').eq('user_id', userId).maybeSingle(),
    service.from('media_offerings').select('id, title, slug, components').eq('id', offeringId).maybeSingle(),
  ]);
  const buyer = buyerRow as
    | { user_id: string; email: string | null; display_name: string | null }
    | null;
  const offering = offeringRow as
    | { id: string; title: string; slug: string; components: Record<string, unknown> | null }
    | null;
  if (!buyer) {
    return NextResponse.json({ error: 'Buyer not found' }, { status: 404 });
  }
  if (!offering) {
    return NextResponse.json({ error: 'Offering not found' }, { status: 404 });
  }
  if (paymentMethod === 'link' && !buyer.email) {
    return NextResponse.json(
      { error: "Buyer has no email — can't send a payment link" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();

  // ── Branch: offline (cash/venmo/check/other) — fully paid immediately
  if (paymentMethod !== 'link') {
    const insertPayload = {
      offering_id: offeringId,
      user_id: userId,
      band_id: bandId,
      status: 'deposited',
      configured_components: null,
      project_details: projectDetails,
      final_price_cents: priceCents,
      deposit_cents: priceCents,
      actual_deposit_paid: priceCents,
      deposit_paid_at: now,
      final_paid_at: priceCents > 0 ? now : null,
      stripe_payment_intent_id: `MANUAL-${paymentMethod.toUpperCase()}-${crypto.randomUUID()}`,
      stripe_session_id: null,
      notes_to_us: notesToUs,
      customer_phone: customerPhone,
      is_test: false,
      created_by: user.email,
    };

    const { data: inserted, error: insErr } = await service
      .from('media_bookings')
      .insert(insertPayload)
      .select('id')
      .single();
    if (insErr || !inserted) {
      console.error('[admin/media/bookings/manual] insert error:', insErr);
      return NextResponse.json(
        { error: `Could not create booking: ${insErr?.message || 'unknown error'}` },
        { status: 500 },
      );
    }
    const bookingId = (inserted as { id: string }).id;

    // Cash ledger insert (parallels /api/admin/media/bookings/[id]/record-payment)
    if (paymentMethod === 'cash' && priceCents > 0) {
      try {
        const buyerName = buyer.display_name || 'Unknown';
        await service.from('cash_ledger').insert({
          media_booking_id: bookingId,
          booking_id: null,
          engineer_name: collectedBy,
          amount: priceCents,
          client_name: buyerName,
          note: note || `Manual media booking — ${offering.title}`,
          recorded_by: user.email,
          status: 'owed',
        });
      } catch (e) {
        console.error('[admin/media/bookings/manual] cash_ledger error:', e);
      }
    }

    // Audit log: capture the manual creation + payment in one entry so
    // we don't have to cross-correlate two rows later.
    await service.from('media_booking_audit_log').insert({
      booking_id: bookingId,
      action: `manual_created_${paymentMethod}`,
      performed_by: user.email,
      details: {
        offering_id: offeringId,
        offering_title: offering.title,
        final_price_cents: priceCents,
        payment_method: paymentMethod,
        collected_by: collectedBy,
        note,
      },
    });

    return NextResponse.json({
      success: true,
      bookingId,
      paymentMethod,
      mode: 'offline',
    });
  }

  // ── Branch: link (Stripe Payment Link emailed to the buyer) ─────────
  // Create the row first (status='inquiry') so the Stripe link's metadata
  // can carry booking_id straight back to the webhook handler.
  const { data: linkRow, error: linkInsErr } = await service
    .from('media_bookings')
    .insert({
      offering_id: offeringId,
      user_id: userId,
      band_id: bandId,
      status: 'inquiry',
      configured_components: null,
      project_details: projectDetails,
      final_price_cents: priceCents,
      deposit_cents: priceCents, // full price asked — admin can adjust later
      actual_deposit_paid: 0,
      notes_to_us: notesToUs,
      customer_phone: customerPhone,
      is_test: false,
      created_by: user.email,
    })
    .select('id')
    .single();
  if (linkInsErr || !linkRow) {
    console.error('[admin/media/bookings/manual] link insert error:', linkInsErr);
    return NextResponse.json(
      { error: `Could not create booking row: ${linkInsErr?.message || 'unknown'}` },
      { status: 500 },
    );
  }
  const bookingId = (linkRow as { id: string }).id;

  try {
    // Stripe: product → price → payment link. The metadata is what the
    // webhook reads to know "this is a media booking, here's the row".
    const product = await stripe.products.create({
      name: `${offering.title} — Booking ${bookingId.slice(0, 8)}`,
      metadata: { booking_id: bookingId, type: 'media_manual' },
    });
    const price = await stripe.prices.create({
      unit_amount: priceCents,
      currency: 'usd',
      product: product.id,
    });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { booking_id: bookingId, type: 'media_manual' },
      after_completion: {
        type: 'redirect',
        redirect: { url: `${SITE_URL}/dashboard/media/orders/${bookingId}?status=paid` },
      },
    });

    // Email the buyer using the existing template (same one the
    // charge-remainder flow uses — the copy works for both)
    if (buyer.email) {
      try {
        await sendMediaPaymentLink(buyer.email, {
          buyerName: buyer.display_name || 'there',
          amount: priceCents,
          paymentUrl: link.url,
          bookingId,
        });
      } catch (e) {
        console.error('[admin/media/bookings/manual] email error:', e);
      }
    }

    await service.from('media_booking_audit_log').insert({
      booking_id: bookingId,
      action: 'manual_created_link',
      performed_by: user.email,
      details: {
        offering_id: offeringId,
        offering_title: offering.title,
        final_price_cents: priceCents,
        payment_link_url: link.url,
        stripe_price_id: price.id,
        stripe_product_id: product.id,
      },
    });

    return NextResponse.json({
      success: true,
      bookingId,
      paymentMethod: 'link',
      mode: 'link',
      paymentUrl: link.url,
    });
  } catch (err: unknown) {
    // If Stripe blew up, we already have the row — don't try to clean it
    // up; admin can charge it via the existing charge-remainder flow.
    const message = err instanceof Error ? err.message : 'Stripe error';
    console.error('[admin/media/bookings/manual] stripe error:', err);
    return NextResponse.json(
      { error: `Booking row created but payment link failed: ${message}`, bookingId },
      { status: 500 },
    );
  }
}
