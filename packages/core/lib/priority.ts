// ============================================================
// Engineer Priority Window Calculation
// ============================================================
// Priority window = requested engineer has exclusive right to accept/pass
// until 12 hours before the session.
//
// If the session is booked with less than 14 hours to go, the engineer
// gets a minimum 2-hour window from the time of booking.
//
// Timeline:
//   Booking created → requested engineer notified
//   (If they don't respond by priority expiry...)
//   Priority expires → client notified, all engineers alerted
//   12 hours before session → safety net admin alert if still unclaimed
//   8 hours before session → artist can no longer request reschedule
//   Session time → go time

export function calculatePriorityExpiry(sessionStartTime: string | Date): string {
  const sessionStart = new Date(sessionStartTime);
  const now = new Date();

  // 12 hours before the session
  const twelveHoursBefore = new Date(sessionStart.getTime() - 12 * 60 * 60 * 1000);

  // Minimum 2-hour window from now
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  // Use whichever is later (gives the engineer at least 2 hours)
  const expiry = twelveHoursBefore > twoHoursFromNow ? twelveHoursBefore : twoHoursFromNow;

  return expiry.toISOString();
}

// Calculate how many hours of priority the engineer has (for display in emails)
export function getPriorityHoursLabel(expiryStr: string): string {
  const expiry = new Date(expiryStr);
  const now = new Date();
  const hoursRemaining = Math.max(0, (expiry.getTime() - now.getTime()) / (1000 * 60 * 60));

  if (hoursRemaining >= 48) return `${Math.round(hoursRemaining / 24)} days`;
  if (hoursRemaining >= 1) return `${Math.round(hoursRemaining)} hours`;
  return `${Math.round(hoursRemaining * 60)} minutes`;
}

// Calculate the reschedule deadline (8 hours before session)
export function calculateRescheduleDeadline(sessionStartTime: string | Date): string {
  const sessionStart = new Date(sessionStartTime);
  return new Date(sessionStart.getTime() - 8 * 60 * 60 * 1000).toISOString();
}

// Check if artist can still request a reschedule
export function canRequestReschedule(sessionStartTime: string | Date): boolean {
  const deadline = new Date(new Date(sessionStartTime).getTime() - 8 * 60 * 60 * 1000);
  return new Date() < deadline;
}
