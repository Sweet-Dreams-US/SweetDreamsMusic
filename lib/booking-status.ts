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
  AWAITING_ENGINEER: 'pending',       // deposit paid; no engineer has claimed yet
  CONFIRMED: 'confirmed',             // an engineer has claimed it
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

/** Customer/admin-facing label. Paid-but-unclaimed reads as "Awaiting Engineer". */
export function bookingStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'pending': return 'Awaiting Engineer';
    case 'confirmed': return 'Confirmed';
    case 'completed': return 'Completed';
    case 'cancelled': return 'Cancelled';
    case 'pending_deposit': return 'Awaiting Deposit';
    default: return status || 'Unknown';
  }
}
