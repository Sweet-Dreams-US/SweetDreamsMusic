// lib/deposit.ts
//
// Single source of truth for "how much deposit was ACTUALLY collected" on a
// booking. Use this everywhere instead of `actual_deposit_paid || deposit_amount`.
//
// Why this exists:
//   `deposit_amount` is the EXPECTED deposit, set at booking creation whether or
//   not anyone ever pays. `actual_deposit_paid` is what was actually collected.
//   The old `actual_deposit_paid || deposit_amount` pattern fell back to the
//   EXPECTED deposit when nothing was recorded — so unpaid bookings reported
//   their deposit as collected money (the "deposit overcount" bug). It inflated
//   "deposits collected" across Accounting / Analytics / Overview / CRM.
//
// The rule:
//   1. If actual_deposit_paid is recorded (> 0), that's the truth — use it.
//   2. Otherwise only count the expected deposit when there's EVIDENCE a payment
//      happened: a Stripe charge (stripe_payment_intent_id), or the balance is
//      settled to $0 (remainder_amount === 0, i.e. paid in full — covers legacy
//      rows whose method predates actual_deposit_paid).
//   3. No evidence (balance still owed, no charge) => $0 collected.
//
// Note on cash-only sessions: their collected cash lives in `cash_ledger` and
// they typically carry deposit_amount = 0, so this returns 0 for them by design
// — their cash is reported via the cash ledger, not the deposit metric.

export interface DepositFields {
  actual_deposit_paid: number | null;
  deposit_amount: number;
  remainder_amount?: number | null;
  stripe_payment_intent_id?: string | null;
}

/** Cents actually collected as a deposit. See file header for the rule. */
export function depositCollectedCents(b: DepositFields): number {
  if (b.actual_deposit_paid != null && b.actual_deposit_paid > 0) {
    return b.actual_deposit_paid;
  }
  const hasPaymentEvidence = !!b.stripe_payment_intent_id || b.remainder_amount === 0;
  return hasPaymentEvidence ? b.deposit_amount : 0;
}
