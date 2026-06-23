// lib/booking-status.ts
// Booking status vocabulary + the load-bearing rule the studio operates by:
//
//   A session is "Confirmed" ONLY when an engineer has claimed it.
//
// Deposit-paid-but-unclaimed is its own state ('pending', shown as "Awaiting
// Engineer"). Claiming flips it to 'confirmed'. This is enforced in code (the
// helpers below) AND at the database (CHECK: status='confirmed' ⇒ engineer_name
// IS NOT NULL — migration 072). Payroll is unaffected: engineers are paid only
// on 'completed' (lib/earnings-core.ts).

export const BOOKING_STATUS = {
  PENDING_DEPOSIT: 'pending_deposit', // invite created; deposit NOT yet paid (slot not held)
  REQUESTED: 'requested',             // charge-on-accept: card SAVED, UNPAID, awaiting an engineer — slot NOT held (first-come-first-serve)
  AWAITING_ENGINEER: 'pending',       // (legacy) deposit already paid; no engineer has claimed yet — slot held
  CONFIRMED: 'confirmed',             // an engineer claimed it (and, for charge-on-accept bookings, the saved card was charged)
  PAYMENT_PENDING: 'payment_pending', // engineer accepted but the saved-card charge failed; NOT on the calendar — awaiting the customer's repayment link
  COMPLETED: 'completed',             // session happened (only status that pays)
  CANCELLED: 'cancelled',             // cancelled / refunded
} as const;

export type BookingStatus = (typeof BOOKING_STATUS)[keyof typeof BOOKING_STATUS];

/**
 * Status for a booking whose deposit just cleared. 'confirmed' ONLY if an
 * engineer is already attached (prepaid/credit sessions, or an invite the
 * engineer created for themselves); otherwise 'pending' (awaiting a claim).
 * This is the single source of truth for the paid → (confirmed|pending) split.
 */
export function paidBookingStatus(engineerName: string | null | undefined): 'confirmed' | 'pending' {
  return engineerName ? 'confirmed' : 'pending';
}

/** Active paid sessions — both pre-claim ('pending') and claimed ('confirmed').
 *  Use for slot-blocking + "upcoming session" surfaces so a paid session is
 *  always held + visible whether or not an engineer has claimed it yet. */
export const ACTIVE_PAID_STATUSES = ['confirmed', 'pending'] as const;

/**
 * Statuses that HARD-hold a calendar slot (block availability). 'requested' is
 * intentionally absent — charge-on-accept requests are first-come-first-serve and
 * never reserve the slot until an engineer accepts + the card charges. A
 * 'payment_pending' booking soft-holds its slot ONLY while slot_hold_expires_at
 * is still in the future; the availability route applies that time check itself.
 */
export const SLOT_BLOCKING_STATUSES = ['confirmed', 'pending', 'approved'] as const;

/** Upcoming-session surfaces (customer dashboard): everything not-yet-terminal,
 *  including a charge-on-accept 'requested' and an engineer-accepted-but-unpaid
 *  'payment_pending', so the customer always sees their request + its real state. */
export const UPCOMING_STATUSES = ['requested', 'pending', 'confirmed', 'payment_pending', 'approved'] as const;

/** Customer/admin-facing label. Paid-but-unclaimed reads as "Awaiting Engineer". */
export function bookingStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'requested': return 'Awaiting Engineer';
    case 'pending': return 'Awaiting Engineer';
    case 'confirmed': return 'Confirmed';
    case 'payment_pending': return 'Payment Needed';
    case 'completed': return 'Completed';
    case 'cancelled': return 'Cancelled';
    case 'pending_deposit': return 'Awaiting Deposit';
    default: return status || 'Unknown';
  }
}
