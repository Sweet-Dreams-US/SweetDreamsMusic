// app/api/media/checkout/route.ts
//
// Creates a Stripe Checkout session for media offerings. Two body shapes
// are accepted:
//
//   • SINGLE-ITEM (legacy / direct buy + multi-page details flow):
//       { slug, configured_components?, project_details? }
//
//   • CART (new /dashboard/media cart pattern):
//       { cart: [ { slug, configured_components?, project_details }, ... ] }
//
// The cart shape produces one Stripe line item per cart entry. Server
// validates + recomputes each item independently — the buyer's cart
// could be tampered with on the wire, but every price hitting Stripe
// comes from the offering row's `components` JSONB + the server-side
// `computeConfiguredPriceCents` helper.
//
// Webhook (`booking/webhook` `media_purchase` branch) receives the cart
// JSON in metadata and fans out into one media_bookings row per item.
// Stripe metadata is 500 char per field, so we chunk the cart snapshot
// across `cart_part_0`…`cart_part_N` keys when it's large.

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createClient, createServiceClient } from '@/lib/supabase/server';
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
import { SITE_URL } from '@/lib/constants';
import type Stripe from 'stripe';

// Round 6: charge 50% deposit on every media checkout. Cole's call —
// admin reaches out to plan after payment, then bills the remaining
// half once the project is scoped. Defined as a constant here so the
// webhook + any future "charge remainder" admin endpoint can read the
// same source of truth.
const MEDIA_DEPOSIT_FRACTION = 0.5;

// Chunk a long string into Stripe-metadata-sized pieces. Stripe's per-field
// limit is 500 chars; we leave a small margin for safety.
const STRIPE_META_CHUNK = 480;
function chunkForMetadata(value: string): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (let i = 0; i < value.length; i += STRIPE_META_CHUNK) {
    out.push(value.slice(i, i + STRIPE_META_CHUNK));
  }
  return out;
}

interface CartLine {
  slug: string;
  configured_components?: ConfiguredComponents;
  project_details?: Record<string, unknown>;
  // Resolved server-side after lookup + validation:
  offering: MediaOffering;
  config: ConfiguredComponents;
  computedPriceCents: number;
  decisionLines: string[];
}

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json(
      { error: 'Login required to purchase media services' },
      { status: 401 },
    );
  }

  // ── Parse body ──────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Normalize: cart shape vs single-item shape. Both go through the same
  // per-item validator; the cart shape just iterates.
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
    // Sanity cap — protect against accidental DoS / metadata blowout.
    return NextResponse.json(
      { error: 'Cart has too many items — max 12 per order' },
      { status: 400 },
    );
  }

  // Phone capture (Round 6). Required for multi-item cart checkouts so
  // admin can call to plan dates + bill the remainder. Legacy single-
  // item callers without phone are tolerated (the buyer's order page
  // shows "no phone on file" and admin can chase by email).
  const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const phoneClean = rawPhone.replace(/\D/g, '');
  if (rawCart && phoneClean.length < 7) {
    return NextResponse.json(
      { error: 'Phone number required to check out — admin needs to call to plan.' },
      { status: 400 },
    );
  }
  const customerPhone = rawPhone || null;

  // ── Visibility + band attribution shared by all items ───────────────
  const bandMemberships = await getUserBands(user.id);
  const viewer = viewerEligibilityFromBands({
    authenticated: true,
    bandCount: bandMemberships.length,
  });
  const bandIdForCredits =
    bandMemberships.length === 1 ? bandMemberships[0]?.band_id ?? null : null;

  const { data: buyerProfile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('user_id', user.id)
    .single();
  const buyerName =
    buyerProfile?.display_name ||
    user.email.split('@')[0] ||
    'Buyer';

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
        { error: `Cart item ${i + 1}: offering not available for your account` },
        { status: 403 },
      );
    }

    // Buyability: only fixed-price offerings can auto-checkout. Range /
    // inquire-only items belong in the inquiry flow, not here.
    const hasFixedPrice =
      offering.price_cents != null &&
      offering.price_range_low_cents == null &&
      offering.price_range_high_cents == null;
    if (!hasFixedPrice) {
      return NextResponse.json(
        { error: `Cart item ${i + 1}: "${offering.title}" requires a custom quote — send an inquiry instead` },
        { status: 400 },
      );
    }

    // Configured components — same validation as the single-item path.
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
          { error: `Cart item ${i + 1}: configured_components must be an object with a 'selections' map` },
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

    // project_details is a plain object or null — no strict validation
    // here, the form gates that; we just refuse arrays and primitives.
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

  // ── Build Stripe line items at 50% deposit ─────────────────────────
  // Charge half of each line's full price now. Round each line down so
  // the integer-cents Stripe demands always sums to <= 50% — no risk of
  // accidentally over-charging. The remainder per line is computed in
  // the webhook from the snapshot's full price minus what was charged.
  const stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = lines.map(
    (line) => {
      const baseDescription =
        line.offering.public_blurb ?? line.offering.description ?? line.offering.title;
      const description =
        line.decisionLines.length > 0
          ? `${baseDescription}\n\nYour build: ${line.decisionLines.join(' · ')}`
          : baseDescription;
      const depositCents = Math.floor(line.computedPriceCents * MEDIA_DEPOSIT_FRACTION);
      return {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${line.offering.title} — Deposit`,
            description: `${description}\n\n50% deposit. Remainder billed once we've planned dates with you.`.slice(0, 500),
            tax_code: 'txcd_20030000',
          },
          unit_amount: depositCents,
        },
        quantity: 1,
      };
    },
  );

  // ── Build cart snapshot for the webhook ─────────────────────────────
  // Each entry carries everything the webhook needs to insert one
  // media_bookings row. The webhook re-fetches the offering by ID for
  // fresh canonical data, but uses the per-item snapshot for the
  // configured_components + project_details + studio_hours.
  const cartSnapshot = lines.map((line) => ({
    offering_id: line.offering.id,
    offering_slug: line.offering.slug,
    offering_title: line.offering.title,
    offering_kind: line.offering.kind,
    studio_hours_included: line.offering.studio_hours_included || 0,
    price_cents: line.computedPriceCents,
    configured_components: line.config,
    project_details: line.project_details ?? null,
    summary: line.decisionLines.join(' · '),
  }));
  const cartJson = JSON.stringify(cartSnapshot);

  // Total studio hours across the cart — sum so a single grant can be
  // written once. The webhook uses this for the `studio_credits` row.
  const totalStudioHours = cartSnapshot.reduce(
    (sum, c) => sum + (Number(c.studio_hours_included) || 0),
    0,
  );

  // ── Metadata. Chunk the cart JSON across multiple fields if large. ─
  const cartChunks = chunkForMetadata(cartJson);
  if (cartChunks.length > 10) {
    return NextResponse.json(
      { error: 'Cart payload too large — try fewer items per checkout' },
      { status: 400 },
    );
  }
  const cartMeta: Record<string, string> = {};
  cartChunks.forEach((chunk, i) => {
    cartMeta[`cart_part_${i}`] = chunk;
  });

  // Round 6: persist phone to profile if the buyer typed one (or
  // overwrote a stale one). Service role write — RLS would block the
  // user-context client from updating `profiles.phone` on their own row
  // depending on policy. Best-effort; if it fails, log + continue. The
  // phone still flows through metadata → media_bookings.customer_phone
  // either way, so the team gets it on the order even if profile-save
  // didn't stick.
  if (customerPhone) {
    try {
      const service = createServiceClient();
      await service.from('profiles').update({ phone: customerPhone }).eq('user_id', user.id);
    } catch (e) {
      console.warn('[media] checkout: profile phone update failed', e);
    }
  }

  // Pre-rendered cart summary for the admin alert email. Each line gets
  // a one-liner so the team can scan the order at a glance without
  // parsing the JSON cart snapshot themselves.
  const cartSummaryLines = lines.map((line) => {
    const cfg = line.decisionLines.length > 0
      ? ` (${line.decisionLines.join(' · ')})`
      : '';
    const songs = (() => {
      const pd = line.project_details as
        | { songs_breakdown?: Array<{ title: string; notes?: string | null }>; songs?: string }
        | undefined;
      if (pd?.songs_breakdown && Array.isArray(pd.songs_breakdown) && pd.songs_breakdown.length > 0) {
        return pd.songs_breakdown
          .map((s) => `${s.title}${s.notes ? ` (${s.notes})` : ''}`)
          .filter((s) => s.trim().length > 0)
          .join(', ');
      }
      return pd?.songs?.trim() || '';
    })();
    const songsSuffix = songs ? ` — songs: ${songs}` : '';
    return `${line.offering.title} — ${(line.computedPriceCents / 100).toFixed(2)}${cfg}${songsSuffix}`;
  });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      automatic_tax: { enabled: true },
      line_items: stripeLineItems,
      success_url: `${SITE_URL}/dashboard/media?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/dashboard/media?status=cancelled`,
      customer_email: user.email,
      metadata: {
        type: 'media_purchase',
        // Backwards-compatible flat fields — the webhook still reads these
        // when the cart is a single item. The richer cart snapshot below
        // is what drives multi-item fan-out.
        offering_id: lines[0].offering.id,
        offering_slug: lines[0].offering.slug,
        offering_title:
          lines.length === 1
            ? lines[0].offering.title
            : `${lines.length} media items`,
        offering_kind: lines[0].offering.kind,
        studio_hours_included: String(totalStudioHours),
        buyer_id: user.id,
        buyer_email: user.email,
        buyer_name: buyerName,
        // Phone for follow-up call (Round 6). Empty string if missing —
        // webhook treats falsy as null when writing to the row.
        customer_phone: customerPhone ?? '',
        band_id: bandIdForCredits ?? '',
        // Number of cart parts so the webhook knows how many `cart_part_N`
        // chunks to read. 0 means single-item legacy mode.
        cart_count: String(lines.length),
        cart_parts: String(cartChunks.length),
        // Pre-rendered admin summary, joined on ` || ` to survive Stripe
        // metadata field's 500-char per-field limit (each line gets a
        // dedicated cart_summary_N field if there are many).
        cart_summary: cartSummaryLines.join(' || ').slice(0, 500),
        ...cartMeta,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[media] checkout creation error:', err);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 },
    );
  }
}
