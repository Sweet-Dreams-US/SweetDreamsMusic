// lib/packages-mint.ts
//
// Entitlement minting on quote acceptance / payment success.
//
// Flow:
//   1. Customer accepts quote → Stripe Checkout Session created
//   2. Customer pays → Stripe webhook fires checkout.session.completed
//   3. Webhook calls mintEntitlementFromQuote() — that's this helper
//   4. Helper:
//        a. Marks the quote 'accepted' (race-safe)
//        b. Inserts a package_entitlement row with the right validity
//           window (one-off → now + duration_days; membership → now +
//           membership_months × ~30 days)
//        c. Inserts a per-line balance row for every template line,
//           snapshotting full_price_cents + package_value_cents
//        d. Returns the entitlement id
//   5. Webhook continues with email confirmation + admin alert
//
// Idempotency: if the quote is already accepted (e.g. webhook retry),
// returns the existing entitlement_id without re-inserting. The call
// is safe to retry.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface QuoteForMint {
  id: string;
  template_id: string;
  user_id: string | null;
  band_id: string | null;
  status: string;
  /** When set, the quote represents an EXTENSION of an existing entitlement
   *  rather than a fresh purchase. The webhook calls extendEntitlement()
   *  instead of mintEntitlementFromQuote() in that case. */
  extends_entitlement_id?: string | null;
  /** Total customer-facing price in cents — used to compute the
   *  salesperson commission snapshot. For memberships this is the full
   *  contract value. */
  total_price_cents?: number | null;
  /** Optional salesperson attribution carried over from the quote.
   *  Null = no commission (the default for most quotes). */
  salesperson_name?: string | null;
  /** Commission as a whole-number percentage (0-100). */
  sales_commission_pct?: number | null;
}

export interface TemplateForMint {
  is_membership: boolean;
  membership_months: number | null;
  duration_days: number | null;
}

export interface TemplateLineForMint {
  id: string;
  kind: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
  quantity: number;
  media_offering_id: string | null;
  full_price_cents: number;
  package_value_cents: number;
  notes: string | null;
}

export interface MintStripeData {
  /** Stripe Checkout Session id, for the audit trail. */
  stripeCheckoutSessionId?: string;
  /** Stripe Subscription id (memberships only). */
  stripeSubscriptionId?: string;
  /** Number of monthly iterations on the Stripe Subscription. */
  stripeSubscriptionIterations?: number;
  /** When the next monthly invoice is due (memberships only). */
  currentPeriodEnd?: string;
}

export interface MintResult {
  entitlementId: string;
  alreadyMinted: boolean;
}

/**
 * Mint an entitlement (or return the existing one) for an accepted quote.
 *
 * Caller is expected to use a service-role client — RLS on the package
 * tables denies anon and authenticated.
 */
export async function mintEntitlementFromQuote(
  service: SupabaseClient,
  quote: QuoteForMint,
  template: TemplateForMint,
  templateLines: TemplateLineForMint[],
  stripe: MintStripeData,
): Promise<MintResult> {
  // Idempotency: if the quote is already accepted, find the existing
  // entitlement and return it. Webhook retries hit this path.
  if (quote.status === 'accepted') {
    const { data: existing } = await service
      .from('package_entitlements')
      .select('id')
      .eq('quote_id', quote.id)
      .maybeSingle();
    if (existing) {
      return {
        entitlementId: (existing as { id: string }).id,
        alreadyMinted: true,
      };
    }
    // Quote is accepted but entitlement is missing — recover by
    // creating it. Shouldn't happen in practice but defensive.
  }

  // Compute the validity window.
  // One-off: now → now + duration_days
  // Membership: now → now + months × 30 days (close enough for human
  // readability; Stripe Subscription handles the actual billing dates)
  const now = new Date();
  const startsAt = now.toISOString();
  let endsAt: string;
  if (template.is_membership) {
    const months = template.membership_months ?? 3;
    const end = new Date(now);
    end.setMonth(end.getMonth() + months);
    endsAt = end.toISOString();
  } else {
    const days = template.duration_days ?? 60;
    const end = new Date(now);
    end.setDate(end.getDate() + days);
    endsAt = end.toISOString();
  }

  // Race-safe accept: only flips draft/sent → accepted, captures
  // accepted_at. Returns the row count so we know whether we won the
  // race. If 0 rows updated, another delivery beat us — bail with
  // alreadyMinted=true after looking up the entitlement.
  const { data: acceptUpdate, error: acceptErr } = await service
    .from('package_quotes')
    .update({ status: 'accepted', accepted_at: startsAt })
    .eq('id', quote.id)
    .in('status', ['draft', 'sent'])
    .select('id');
  if (acceptErr) {
    console.error('[mintEntitlement] quote accept update failed:', acceptErr);
    throw new Error(`Quote accept update failed: ${acceptErr.message}`);
  }
  const wonRace = !!acceptUpdate && acceptUpdate.length > 0;
  if (!wonRace) {
    // Lost the race — entitlement might already exist.
    const { data: existing } = await service
      .from('package_entitlements')
      .select('id')
      .eq('quote_id', quote.id)
      .maybeSingle();
    if (existing) {
      return {
        entitlementId: (existing as { id: string }).id,
        alreadyMinted: true,
      };
    }
    // Race-loss with no entitlement is anomalous; fall through to
    // mint anyway — better to have the entitlement than not.
  }

  // Salesperson commission snapshot. Per Cole's rule, commission is
  // earned ON PAYMENT — this mint function only runs after the webhook
  // confirms payment, so snapshotting here freezes the earned amount.
  // A later quote edit can't retroactively change a salesperson's
  // payroll. Null salesperson → null commission (the default).
  let salesCommissionCents: number | null = null;
  if (quote.salesperson_name && typeof quote.sales_commission_pct === 'number' && quote.sales_commission_pct > 0) {
    const basis = quote.total_price_cents ?? 0;
    salesCommissionCents = Math.round((basis * quote.sales_commission_pct) / 100);
  }

  // Insert the entitlement row.
  const { data: created, error: insertErr } = await service
    .from('package_entitlements')
    .insert({
      quote_id: quote.id,
      template_id: quote.template_id,
      user_id: quote.user_id,
      band_id: quote.band_id,
      status: 'active',
      payment_status: 'current',
      starts_at: startsAt,
      ends_at: endsAt,
      stripe_subscription_id: stripe.stripeSubscriptionId ?? null,
      stripe_subscription_iterations: stripe.stripeSubscriptionIterations ?? null,
      current_period_end: stripe.currentPeriodEnd ?? null,
      salesperson_name: quote.salesperson_name ?? null,
      sales_commission_cents: salesCommissionCents,
    })
    .select('id')
    .single();
  if (insertErr || !created) {
    console.error('[mintEntitlement] entitlement insert failed:', insertErr);
    throw new Error(`Entitlement insert failed: ${insertErr?.message ?? 'unknown'}`);
  }
  const entitlementId = (created as { id: string }).id;

  // Insert per-line balances.
  if (templateLines.length > 0) {
    const balancesPayload = templateLines.map((line) => ({
      entitlement_id: entitlementId,
      template_line_id: line.id,
      kind: line.kind,
      media_offering_id: line.media_offering_id,
      full_price_cents: line.full_price_cents,
      package_value_cents: line.package_value_cents,
      notes: line.notes,
      quantity_granted: line.quantity,
      quantity_redeemed: 0,
      redemptions: [],
    }));
    const { error: balErr } = await service
      .from('package_entitlement_balances')
      .insert(balancesPayload);
    if (balErr) {
      // Entitlement exists but balances missing — surface but don't
      // fail the webhook (admin can re-trigger or fix manually).
      console.error('[mintEntitlement] balances insert failed:', balErr);
      throw new Error(`Balances insert failed: ${balErr.message}`);
    }
  }

  return { entitlementId, alreadyMinted: false };
}

/**
 * Extend an existing entitlement by N months. Called from the webhook
 * when a quote with extends_entitlement_id is paid. We:
 *   1. Bump ends_at by months × 30 days
 *   2. Add proportional balance lines (so customer gets N more months
 *      of value at the same per-month rate)
 *   3. Mark the extension quote as 'accepted' so it doesn't show up
 *      as pending
 *   4. Stamp the new Stripe subscription details on the entitlement
 *
 * Returns alreadyMinted=true if the quote was already accepted (retry).
 */
export async function extendEntitlement(
  service: SupabaseClient,
  quote: QuoteForMint & { extends_entitlement_id: string },
  template: TemplateForMint,
  templateLines: TemplateLineForMint[],
  months: number,
  stripe: MintStripeData,
): Promise<MintResult> {
  // Idempotency.
  if (quote.status === 'accepted') {
    return {
      entitlementId: quote.extends_entitlement_id,
      alreadyMinted: true,
    };
  }

  // Race-safe accept.
  const { data: acceptUpdate, error: acceptErr } = await service
    .from('package_quotes')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', quote.id)
    .in('status', ['draft', 'sent'])
    .select('id');
  if (acceptErr) {
    throw new Error(`Quote accept update failed: ${acceptErr.message}`);
  }
  if (!acceptUpdate || acceptUpdate.length === 0) {
    return { entitlementId: quote.extends_entitlement_id, alreadyMinted: true };
  }

  // Pull the existing entitlement's current ends_at + balances.
  const { data: existingEnt, error: entErr } = await service
    .from('package_entitlements')
    .select('id, ends_at')
    .eq('id', quote.extends_entitlement_id)
    .single();
  if (entErr || !existingEnt) {
    throw new Error('Existing entitlement not found for extension');
  }

  // Compute new ends_at = max(current, now()) + months × 30d.
  // (max ensures we extend forward, not into the past if the extension
  // was issued shortly before original expiry — gives the customer at
  // least the full extension window from now.)
  const currentEnd = new Date((existingEnt as { ends_at: string }).ends_at);
  const baseDate = currentEnd > new Date() ? currentEnd : new Date();
  const newEnd = new Date(baseDate);
  newEnd.setMonth(newEnd.getMonth() + months);

  // Update the entitlement: bump ends_at + stamp new Stripe subscription.
  // (Original stripe_subscription_id is overwritten with the new one
  // because Stripe's checkout creates a fresh subscription per quote.
  // The old subscription has cancel_at set so it auto-stops; the
  // new one carries the extension.)
  const { error: updateErr } = await service
    .from('package_entitlements')
    .update({
      ends_at: newEnd.toISOString(),
      stripe_subscription_id: stripe.stripeSubscriptionId ?? null,
      stripe_subscription_iterations: stripe.stripeSubscriptionIterations ?? null,
      current_period_end: stripe.currentPeriodEnd ?? null,
      // Reset payment_status to current — they just paid.
      payment_status: 'current',
      last_payment_failed_at: null,
    })
    .eq('id', quote.extends_entitlement_id);
  if (updateErr) {
    throw new Error(`Entitlement extend update failed: ${updateErr.message}`);
  }

  // Add balance line ADDITIONS proportional to the extension.
  // Each template line represents a full membership term's worth of
  // that line's value. For an extension of N months out of an M-month
  // template, each line contributes (N/M) × original_quantity.
  // Round up so customers don't lose fractional value.
  const originalMonths = template.membership_months ?? 1;
  if (originalMonths > 0 && templateLines.length > 0) {
    // Pull existing balances for this entitlement so we can either
    // ADD to existing balances (preferred — keeps a single row per kind)
    // or insert new ones if no matching balance exists.
    const { data: existingBals } = await service
      .from('package_entitlement_balances')
      .select('id, kind, media_offering_id, quantity_granted, quantity_redeemed')
      .eq('entitlement_id', quote.extends_entitlement_id);
    type Bal = {
      id: string;
      kind: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
      media_offering_id: string | null;
      quantity_granted: number;
      quantity_redeemed: number;
    };
    const balsByKey = new Map<string, Bal>();
    for (const b of (existingBals ?? []) as Bal[]) {
      // Key includes media_offering_id so multiple media lines stay
      // separate (one per offering).
      const key = `${b.kind}:${b.media_offering_id ?? ''}`;
      balsByKey.set(key, b);
    }

    for (const line of templateLines) {
      const additionalQty = Math.ceil(line.quantity * (months / originalMonths));
      if (additionalQty <= 0) continue;
      const key = `${line.kind}:${line.media_offering_id ?? ''}`;
      const existing = balsByKey.get(key);
      if (existing) {
        // Add to existing balance.
        await service
          .from('package_entitlement_balances')
          .update({
            quantity_granted: existing.quantity_granted + additionalQty,
          })
          .eq('id', existing.id);
      } else {
        // Insert a new balance row.
        await service
          .from('package_entitlement_balances')
          .insert({
            entitlement_id: quote.extends_entitlement_id,
            template_line_id: line.id,
            kind: line.kind,
            media_offering_id: line.media_offering_id,
            full_price_cents: Math.round(line.full_price_cents * (months / originalMonths)),
            package_value_cents: Math.round(line.package_value_cents * (months / originalMonths)),
            notes: line.notes,
            quantity_granted: additionalQty,
            quantity_redeemed: 0,
            redemptions: [],
          });
      }
    }
  }

  return { entitlementId: quote.extends_entitlement_id, alreadyMinted: false };
}

