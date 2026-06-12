// app/api/admin/media/test-checkout/route.ts
//
// Admin-only endpoint that simulates the full media checkout pipeline
// WITHOUT charging Stripe. The exact same booking rows + audit log +
// admin notification emails fire as if the buyer paid, but:
//
//   • is_test = TRUE on every row created → excluded from accounting
//   • stripe_payment_intent_id stamped with `TEST-<uuid>` so it's
//     instantly visible as a test row in admin UIs
//   • actual_deposit_paid = 0 (no money actually moved)
//   • final_paid_at stays NULL — admin can manually flip via the same
//     remainder flow used in production, which is part of what we're
//     trying to test
//
// SECURITY: admin role required. Other gates (session auth) are sanity
// belts since /api/admin/* lives behind the admin role check, but we
// re-check explicitly so direct-URL hits without admin session bounce
// with a clean 403 instead of leaking schema details.
//
// Body shape mirrors /api/media/checkout's cart shape exactly so we can
// reuse the same client wiring with a single extra `?test=1` query
// flag (or a separate Test button in the cart sidebar).

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getOfferingBySlug } from '@/lib/media-server';
import { getUserBands } from '@/lib/bands-server';
import {
  type MediaOffering,
  isOfferingVisibleTo,
  viewerEligibilityFromBands,
} from '@/lib/media';
import {
  type ConfiguredComponents,
  computeConfiguredPriceCents,
  describeConfig,
  isOfferingConfigurable,
  validateConfig,
  EMPTY_CONFIG,
} from '@/lib/media-config';
import {
  sendMediaPurchaseConfirmation,
  sendMediaPurchaseAdminAlert,
} from '@/lib/email';
import { SITE_URL } from '@/lib/constants';

interface CartLine {
  slug: string;
  configured_components?: ConfiguredComponents;
  project_details?: Record<string, unknown>;
  offering: MediaOffering;
  config: ConfiguredComponents;
  computedPriceCents: number;
  decisionLines: string[];
}

export async function POST(request: NextRequest) {
  // ── Admin gate ─────────────────────────────────────────────────────
  // Two-tier: must be authenticated AND have role=admin. The role check
  // is the actual security boundary; the auth check is the friendly
  // 401 vs 403 distinction.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required for test-mode checkout' },
      { status: 403 },
    );
  }

  // ── Parse body ──────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const rawCart = Array.isArray(body.cart) ? body.cart : null;
  const incomingItems: Array<{
    slug?: unknown;
    configured_components?: unknown;
    project_details?: unknown;
  }> = rawCart ?? [
    {
      slug: body.slug,
      configured_components: body.configured_components,
      project_details: body.project_details,
    },
  ];
  if (incomingItems.length === 0) {
    return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
  }
  if (incomingItems.length > 12) {
    return NextResponse.json(
      { error: 'Cart has too many items — max 12 per order' },
      { status: 400 },
    );
  }

  // Optional phone — not required for test mode (admin is just simulating)
  const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const customerPhone = rawPhone || null;

  // ── Resolve buyer (defaults to the admin themselves for self-test) ──
  // Admin can target a different user via `target_user_id` (e.g., when
  // testing a real customer's flow), but unspecified means they're
  // testing as themselves.
  const targetUserId =
    typeof body.target_user_id === 'string' && body.target_user_id.length > 0
      ? body.target_user_id
      : user.id;

  const service = createServiceClient();
  const { data: buyerProfile } = await service
    .from('profiles')
    .select('display_name, email')
    .eq('user_id', targetUserId)
    .maybeSingle();
  if (!buyerProfile) {
    return NextResponse.json(
      { error: 'Target user profile not found' },
      { status: 404 },
    );
  }
  const buyer = buyerProfile as { display_name: string; email: string | null };
  const buyerName = buyer.display_name || 'Test buyer';
  const buyerEmail = buyer.email || user.email;

  // ── Visibility + band attribution ──────────────────────────────────
  const bandMemberships = await getUserBands(targetUserId);
  const viewer = viewerEligibilityFromBands({
    authenticated: true,
    bandCount: bandMemberships.length,
  });
  const bandIdForCredits =
    bandMemberships.length === 1 ? bandMemberships[0]?.band_id ?? null : null;

  // ── Validate every cart line ────────────────────────────────────────
  const lines: CartLine[] = [];
  for (let i = 0; i < incomingItems.length; i++) {
    const raw = incomingItems[i];
    const slug = typeof raw.slug === 'string' ? raw.slug : '';
    if (!slug) {
      return NextResponse.json(
        { error: `Cart item ${i + 1}: slug required` },
        { status: 400 },
      );
    }

    const offering = await getOfferingBySlug(slug);
    if (!offering || !offering.is_active) {
      return NextResponse.json(
        { error: `Cart item ${i + 1}: offering "${slug}" not found or unavailable` },
        { status: 404 },
      );
    }
    if (!isOfferingVisibleTo(offering, viewer)) {
      return NextResponse.json(
        { error: `Cart item ${i + 1}: offering not available for the target user` },
        { status: 403 },
      );
    }
    const hasFixedPrice =
      offering.price_cents != null &&
      offering.price_range_low_cents == null &&
      offering.price_range_high_cents == null;
    if (!hasFixedPrice) {
      return NextResponse.json(
        { error: `Cart item ${i + 1}: requires a custom quote — not test-mode-able` },
        { status: 400 },
      );
    }

    let config: ConfiguredComponents = EMPTY_CONFIG;
    const rawConfig = raw.configured_components;
    if (rawConfig !== undefined && rawConfig !== null) {
      if (
        typeof rawConfig !== 'object' ||
        Array.isArray(rawConfig) ||
        !('selections' in rawConfig) ||
        typeof (rawConfig as { selections: unknown }).selections !== 'object'
      ) {
        return NextResponse.json(
          { error: `Cart item ${i + 1}: configured_components shape invalid` },
          { status: 400 },
        );
      }
      const selections = (rawConfig as { selections: Record<string, unknown> }).selections;
      config = { selections: selections as ConfiguredComponents['selections'] };
      if (Object.keys(config.selections).length > 0 && !isOfferingConfigurable(offering)) {
        return NextResponse.json(
          { error: `Cart item ${i + 1}: this offering has no configurable slots` },
          { status: 400 },
        );
      }
      const err = validateConfig(offering, config);
      if (err) {
        return NextResponse.json(
          { error: `Cart item ${i + 1}: ${err}` },
          { status: 400 },
        );
      }
    }

    const computedPriceCents = computeConfiguredPriceCents(offering, config);
    if (computedPriceCents == null || computedPriceCents <= 0) {
      return NextResponse.json(
        { error: `Cart item ${i + 1}: unable to compute a valid price` },
        { status: 400 },
      );
    }

    let projectDetails: Record<string, unknown> | undefined;
    if (
      raw.project_details &&
      typeof raw.project_details === 'object' &&
      !Array.isArray(raw.project_details)
    ) {
      projectDetails = raw.project_details as Record<string, unknown>;
    }

    lines.push({
      slug,
      configured_components: config,
      project_details: projectDetails,
      offering,
      config,
      computedPriceCents,
      decisionLines: describeConfig(offering, config),
    });
  }

  // ── Insert media_bookings rows + audit + studio_credits ────────────
  const fakeSessionId = `TEST-${randomUUID()}`;
  const fakePaymentIntentId = `TEST-PI-${randomUUID()}`;
  const createdBookingIds: string[] = [];
  let primaryBookingId: string | null = null;
  let totalStudioHours = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const fullPrice = line.computedPriceCents;
    const lineDeposit = Math.floor(fullPrice * 0.5);

    const { data: row, error: bookingErr } = await service
      .from('media_bookings')
      .insert({
        offering_id: line.offering.id,
        user_id: targetUserId,
        band_id: bandIdForCredits,
        status: 'deposited',
        configured_components: line.config,
        project_details: line.project_details ?? null,
        final_price_cents: fullPrice,
        deposit_cents: lineDeposit,
        actual_deposit_paid: 0, // No money moved in test mode
        customer_phone: customerPhone,
        is_test: true,
        stripe_payment_intent_id: idx === 0 ? fakePaymentIntentId : null,
        stripe_session_id: fakeSessionId,
        deposit_paid_at: new Date().toISOString(),
        final_paid_at: null,
        created_by: user.email,
      })
      .select('id')
      .single();

    if (bookingErr) {
      console.error('[test-checkout] insert failed:', bookingErr);
      return NextResponse.json(
        { error: `Failed to create booking ${idx + 1}: ${bookingErr.message}` },
        { status: 500 },
      );
    }
    if (row) {
      const id = (row as { id: string }).id;
      createdBookingIds.push(id);
      if (!primaryBookingId) primaryBookingId = id;

      // Write an audit row so the test creation is visible in the trail.
      await service.from('media_booking_audit_log').insert({
        booking_id: id,
        action: 'test_checkout_created',
        performed_by: user.email,
        details: {
          target_user_id: targetUserId,
          target_user_email: buyerEmail,
          offering_slug: line.slug,
          full_price_cents: fullPrice,
          deposit_cents_simulated: lineDeposit,
          decisions: line.decisionLines,
        },
      });
    }
    totalStudioHours += line.offering.studio_hours_included || 0;
  }

  // Studio credits row — also marked is_test? Studio credits don't have
  // is_test. For test bookings we still write the credit row so the
  // balance widget shows it (admin testing the flow needs to see hours
  // accumulate). The accounting deferred-revenue view uses cost_basis_cents
  // which will be 0 for test rows since no money moved — so the liability
  // accrues correctly.
  if (totalStudioHours > 0 && primaryBookingId) {
    const creditOwner = bandIdForCredits
      ? { band_id: bandIdForCredits, user_id: null }
      : { user_id: targetUserId, band_id: null };

    await service.from('studio_credits').insert({
      ...creditOwner,
      source_booking_id: primaryBookingId,
      hours_granted: totalStudioHours,
      hours_used: 0,
      cost_basis_cents: 0, // No revenue recognized for test bookings
    });
  }

  // ── Notification emails (fire-and-forget) ──────────────────────────
  // Even for test mode we send the emails — the whole point of the test
  // is to verify the notification copy renders correctly. The admin
  // alert subject line includes "[TEST]" so the team can filter.
  const cartSummaryLines = lines.map((line) => {
    const cfg = line.decisionLines.length > 0 ? ` (${line.decisionLines.join(' · ')})` : '';
    return `${line.offering.title} — ${(line.computedPriceCents / 100).toFixed(2)}${cfg}`;
  });
  const totalSticker = lines.reduce((sum, line) => sum + line.computedPriceCents, 0);
  const totalDeposit = lines.reduce(
    (sum, line) => sum + Math.floor(line.computedPriceCents * 0.5),
    0,
  );
  const offeringTitle =
    lines.length === 1
      ? lines[0].offering.title
      : `${lines.length} media items (TEST)`;

  if (buyerEmail) {
    try {
      await sendMediaPurchaseConfirmation(buyerEmail, {
        buyerName,
        offeringTitle: `[TEST] ${offeringTitle}`,
        amountPaid: totalDeposit,
        studioHoursIncluded: totalStudioHours,
        bandAttached: !!bandIdForCredits,
        configurationLines: cartSummaryLines,
        bookingId: primaryBookingId ?? undefined,
      });
    } catch (e) {
      console.error('[test-checkout] confirmation email error:', e);
    }
  }
  try {
    await sendMediaPurchaseAdminAlert({
      buyerName: `[TEST] ${buyerName}`,
      buyerEmail: buyerEmail || 'unknown',
      offeringTitle,
      amountPaid: totalDeposit,
      studioHoursIncluded: totalStudioHours,
      bandAttached: !!bandIdForCredits,
      configurationLines: cartSummaryLines,
      customerPhone,
      fullPriceTotal: totalSticker,
      depositPaid: totalDeposit,
      cartItemCount: lines.length,
    });
  } catch (e) {
    console.error('[test-checkout] admin alert error:', e);
  }

  // ── Done ────────────────────────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    test: true,
    booking_ids: createdBookingIds,
    primary_booking_id: primaryBookingId,
    success_url: `${SITE_URL}/dashboard/media?status=test-success&test_session=${fakeSessionId}`,
  });
}
