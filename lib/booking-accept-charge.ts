// lib/booking-accept-charge.ts
//
// Charge a charge-on-accept ('requested') booking's SAVED CARD off-session at the
// moment an engineer accepts. Reuses the proven off-session pattern from
// app/api/booking/charge-remainder/route.ts (plain platform charge — there is NO
// Stripe Connect in this app). The card was saved at booking time via a Stripe
// Checkout setup-mode session; nothing was charged until now.
//
// The "fail on two tries" failsafe (Cole's rule) lives here: we attempt the charge,
// and on a CLEAN card decline we retry exactly once (2 attempts total). On any
// AMBIGUOUS error (network / idempotency / processing) we do NOT retry — retrying an
// ambiguous failure with a fresh key could double-charge — we surface it as a
// payment failure so the caller routes the booking to 'payment_pending' + a
// repayment link. Each attempt carries its own idempotency key, so a retried clean
// decline is safe and a re-run of the SAME attempt can never create a second charge.

import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';

export type AcceptChargeOutcome = 'charged' | 'no_charge_needed' | 'payment_failed';

export interface AcceptChargeResult {
  outcome: AcceptChargeOutcome;
  paymentIntentId?: string;
  attempts: number;     // how many charge attempts were made (0 when nothing to charge)
  error?: string;       // failure reason (card decline message etc.)
}

const MAX_ATTEMPTS = 2; // "fails on two tries" → then payment_pending

/**
 * Off-session charge of a saved card for an accepted booking.
 *  - `amountCents` 0 → nothing to charge (free hour / credit covered it) → 'no_charge_needed'.
 *  - success → 'charged' (+ paymentIntentId).
 *  - both tries fail (or an ambiguous error) → 'payment_failed' (+ error).
 *
 * The customer + payment method live on the PLATFORM account (saved at booking).
 * Pass the stored `paymentMethodId`; if absent we fall back to the customer's first
 * saved card, exactly like charge-remainder does.
 */
export async function chargeSavedCardForAccept(opts: {
  bookingId: string;
  customerId: string;
  paymentMethodId: string | null;
  amountCents: number;
}): Promise<AcceptChargeResult> {
  const { bookingId, customerId, amountCents } = opts;

  if (!amountCents || amountCents <= 0) {
    return { outcome: 'no_charge_needed', attempts: 0 };
  }
  if (!customerId) {
    return { outcome: 'payment_failed', attempts: 0, error: 'No saved customer on file' };
  }

  // Resolve the payment method: prefer the one stored at save-time, else the
  // customer's first card (the charge-remainder fallback).
  let paymentMethodId = opts.paymentMethodId;
  if (!paymentMethodId) {
    try {
      const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card' });
      paymentMethodId = pms.data[0]?.id ?? null;
    } catch (e) {
      return { outcome: 'payment_failed', attempts: 0, error: errMsg(e) };
    }
  }
  if (!paymentMethodId) {
    return { outcome: 'payment_failed', attempts: 0, error: 'No saved card on file' };
  }

  let lastError = 'charge failed';
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'usd',
          customer: customerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          description: `Session deposit — Booking ${bookingId.slice(0, 8)}`,
          metadata: { type: 'booking_deposit_on_accept', booking_id: bookingId },
        },
        // Per-attempt key: a re-run of the SAME attempt is idempotent (no double
        // charge), while a fresh attempt after a clean decline gets a new key.
        { idempotencyKey: `accept-charge-${bookingId}-${attempt}` },
      );

      if (pi.status === 'succeeded') {
        return { outcome: 'charged', paymentIntentId: pi.id, attempts: attempt + 1 };
      }
      // requires_action / processing / requires_payment_method — off-session can't
      // do 3DS, so this is a failure. Do NOT retry these (not a clean decline).
      return { outcome: 'payment_failed', attempts: attempt + 1, error: `payment ${pi.status}` };
    } catch (e) {
      lastError = errMsg(e);
      // Retry ONLY on a clean card decline (no money moved). Anything else
      // (network, idempotency, rate-limit, ambiguous) we do NOT retry — retrying
      // an ambiguous failure could double-charge.
      if (isCleanCardDecline(e) && attempt + 1 < MAX_ATTEMPTS) {
        continue;
      }
      return { outcome: 'payment_failed', attempts: attempt + 1, error: lastError };
    }
  }
  return { outcome: 'payment_failed', attempts: MAX_ATTEMPTS, error: lastError };
}

/** A clean card decline = the charge definitively did not go through (safe to retry). */
function isCleanCardDecline(e: unknown): boolean {
  if (e instanceof Stripe.errors.StripeCardError) return true;
  const anyErr = e as { type?: string; code?: string };
  return anyErr?.type === 'StripeCardError' || anyErr?.code === 'card_declined';
}

function errMsg(e: unknown): string {
  if (e instanceof Stripe.errors.StripeError) return e.message;
  const anyErr = e as { message?: string; code?: string };
  return anyErr?.message || anyErr?.code || 'charge failed';
}
