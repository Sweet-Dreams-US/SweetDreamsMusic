// lib/booking-accept.ts
//
// Charge-on-accept: an engineer accepts a 'requested' booking (card saved at
// booking, nothing charged yet). We atomically CLAIM it, charge the saved card
// off-session, and resolve to:
//   • 'confirmed'        — card charged (or free hour covered it), slot locked,
//                          rewards (grant + free hour) consumed.
//   • 'payment_pending'  — the charge failed twice → engineer's acceptance stands
//                          but the session is NOT on the calendar; the customer
//                          gets a repayment link (token) and a 60-min slot hold.
//   • 'slot_taken'       — another booking already locked this room+time.
//   • 'race_lost'        — a different engineer claimed this booking first.
//
// Order of operations (the safe shape): claim FIRST (the `.is(engineer_name,null)`
// is the single race winner, so only the winning engineer ever charges), THEN
// charge, THEN flip status. A failed charge therefore never produced a 'confirmed'
// row, and rewards are consumed only on success.

import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chargeSavedCardForAccept } from '@/lib/booking-accept-charge';
import { markGrantRedeemed } from '@/lib/rewards-issue';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

export interface AcceptBookingRow {
  id: string;
  status: string;
  room: string | null;
  start_time: string;
  engineer_name: string | null;
  deposit_amount: number | null;
  admin_notes: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  reward_grant_id: string | null;
  pending_free_hour_credit_id: string | null;
  pending_free_hour_redeemed_by: string | null;
}

/** True iff this booking is a charge-on-accept request that still needs charging. */
export function isChargeOnAcceptBooking(b: { status: string; stripe_payment_method_id: string | null }): boolean {
  return b.status === 'requested' && !!b.stripe_payment_method_id;
}

export type AcceptChargeOutcome = 'confirmed' | 'payment_pending' | 'slot_taken' | 'race_lost';

export interface AcceptResult {
  outcome: AcceptChargeOutcome;
  repaymentToken?: string;
  chargedCents?: number;
  error?: string;
}

const SLOT_HOLD_MINUTES = 60;
// Statuses that HARD-hold a room+time slot. 'requested' is excluded (first-come-
// first-serve); 'payment_pending' holds while its window is open.
const SLOT_BLOCKING = ['confirmed', 'payment_pending', 'pending', 'approved'];

export async function chargeAndConfirmOnAccept(
  db: Client,
  booking: AcceptBookingRow,
  engineerName: string,
): Promise<AcceptResult> {
  // 1. Slot-race guard — has another booking already locked this room+time?
  if (booking.room) {
    const { data: clash } = await db
      .from('bookings')
      .select('id')
      .eq('room', booking.room)
      .eq('start_time', booking.start_time)
      .neq('id', booking.id)
      .in('status', SLOT_BLOCKING)
      .limit(1);
    if (clash && clash.length > 0) return { outcome: 'slot_taken' };
  }

  // 2. Atomic claim — set engineer_name only if still unclaimed. Status stays
  // 'requested' until the charge resolves. The .is(null) WHERE is the race guard.
  const { data: claimed, error: claimErr } = await db
    .from('bookings')
    .update({ engineer_name: engineerName, claimed_at: new Date().toISOString() })
    .eq('id', booking.id)
    .is('engineer_name', null)
    .select('id')
    .single();
  if (claimErr || !claimed) return { outcome: 'race_lost' };

  // 3. Charge the saved card (off-session, 2-try, double-charge-safe).
  const amount = booking.deposit_amount ?? 0;
  const charge = await chargeSavedCardForAccept({
    bookingId: booking.id,
    customerId: booking.stripe_customer_id ?? '',
    paymentMethodId: booking.stripe_payment_method_id,
    amountCents: amount,
  });

  if (charge.outcome === 'charged' || charge.outcome === 'no_charge_needed') {
    // 4a. Confirmed — lock the slot, record the charge, consume the rewards.
    const charged = charge.outcome === 'charged';
    await db.from('bookings').update({
      status: 'confirmed',
      charged_at: new Date().toISOString(),
      actual_deposit_paid: charged ? amount : 0,
      stripe_payment_intent_id: charge.paymentIntentId ?? null,
      charge_attempts: charge.attempts,
    }).eq('id', booking.id);
    await consumeRewardsOnConfirm(db, booking);
    return { outcome: 'confirmed', chargedCents: charged ? amount : 0 };
  }

  // 4b. Charge failed twice → payment_pending + repay link + slot hold. Rewards
  // are NOT consumed (session isn't locked). The engineer's acceptance stands.
  const repaymentToken = randomBytes(24).toString('hex');
  const holdUntil = new Date(Date.now() + SLOT_HOLD_MINUTES * 60 * 1000).toISOString();
  await db.from('bookings').update({
    status: 'payment_pending',
    charge_attempts: charge.attempts,
    repayment_token: repaymentToken,
    slot_hold_expires_at: holdUntil,
  }).eq('id', booking.id);
  return { outcome: 'payment_pending', repaymentToken, error: charge.error };
}

/**
 * Consume the deferred rewards once a request confirms: redeem the discount grant
 * and drain 1 hour from the free-hour credit. Mirrors drainFreeHourForBooking
 * (redemption row + optimistic hours_used bump) AND stamps a `credit_redemption:`
 * marker into admin_notes so restoreRewardsOnCancel can give the hour back on a
 * later cancel. Idempotent (skips if already drained). Never throws.
 */
export async function consumeRewardsOnConfirm(db: Client, booking: AcceptBookingRow): Promise<void> {
  if (booking.reward_grant_id) {
    try { await markGrantRedeemed(db, booking.reward_grant_id, booking.id); }
    catch (e) { console.error('[accept] mark grant redeemed failed (non-fatal):', e); }
  }

  const creditId = booking.pending_free_hour_credit_id;
  const redeemedBy = booking.pending_free_hour_redeemed_by;
  if (!creditId || !redeemedBy) return;

  try {
    const { data: existing } = await db
      .from('studio_credit_redemptions')
      .select('id')
      .eq('studio_booking_id', booking.id)
      .maybeSingle();
    if (existing) return; // already drained

    const { error: redErr } = await db.from('studio_credit_redemptions').insert({
      credit_id: creditId,
      studio_booking_id: booking.id,
      hours_redeemed: 1,
      redeemed_by: redeemedBy,
    });
    if (redErr) { console.error('[accept][free_hour] redemption insert failed:', redErr); return; }

    const { data: credit } = await db
      .from('studio_credits')
      .select('hours_used')
      .eq('id', creditId)
      .maybeSingle();
    if (credit) {
      const used = Number((credit as any).hours_used) || 0;
      await db.from('studio_credits')
        .update({ hours_used: used + 1 })
        .eq('id', creditId)
        .eq('hours_used', used); // optimistic concurrency
    }

    // Marker so restoreRewardsOnCancel can find + restore this credit on cancel.
    const notes = `${booking.admin_notes || ''} credit_redemption:${creditId}`.trim();
    await db.from('bookings').update({ admin_notes: notes }).eq('id', booking.id);
  } catch (e) {
    console.error('[accept][free_hour] drain failed (non-fatal):', e);
  }
}
