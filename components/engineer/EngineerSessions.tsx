'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatCents, formatDuration } from '@/lib/utils';
import { ENGINEERS } from '@/lib/constants';
import CashCorrectionModal from '@/components/booking/CashCorrectionModal';
import { fmtSessionDate, fmtSessionTime, fmtSessionDateTime, fmtStampDate, fmtStampDateTime } from '@/lib/studio-time';

interface Booking {
  id: string;
  customer_name: string;
  customer_email?: string;
  customer_phone?: string | null;
  artist_name?: string | null;
  start_time: string;
  end_time: string;
  duration: number;
  room?: string;
  total_amount: number;
  deposit_amount: number;
  remainder_amount?: number;
  actual_deposit_paid: number | null;
  status: string;
  created_at: string;
  admin_notes: string | null;
  engineer_name?: string | null;
  requested_engineer?: string | null;
  priority_expires_at?: string | null;
  reschedule_requested?: boolean;
  deposit_method?: string;
  stripe_customer_id?: string | null;
  stripe_payment_intent_id?: string | null;
  // Round 4: surfaces from the new band-booking workflow.
  // - booking_group_id present means this row is part of a 3×8 day block.
  //   We render a "Day X of 3" badge so the engineer knows it's not a
  //   one-off session.
  // - sweet_spot_addon present means the band tacked a Sweet Spot filming
  //   session onto the END of this day. The duration is already inflated
  //   on this row (duration = 8 + extra_filming_hours), but the engineer
  //   needs to know to expect cameras + extra crew for the last 2 hours.
  // - setup_minutes_before tells them when to arrive — band day 1 has
  //   60 free minutes of setup before metered hours start.
  booking_group_id?: string | null;
  sweet_spot_addon?: {
    kind?: '8hr-addon' | '3day-addon';
    filmingDayIndex?: 0 | 1 | 2;
    price_cents?: number;
    extra_filming_hours?: number;
  } | null;
  setup_minutes_before?: number | null;
  band_id?: string | null;
}

interface StudioBooking {
  id: string;
  customer_name: string;
  artist_name: string | null;
  start_time: string;
  end_time: string;
  duration: number;
  room: string | null;
  engineer_name: string | null;
  status: string;
}

export default function EngineerSessions({ userEmail }: { userEmail: string }) {
  const [mySessions, setMySessions] = useState<Booking[]>([]);
  const [unclaimed, setUnclaimed] = useState<Booking[]>([]);
  const [allBookings, setAllBookings] = useState<StudioBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [showAllBookings, setShowAllBookings] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [myRes, unclaimedRes, allRes] = await Promise.all([
        fetch('/api/engineer/accounting'),
        fetch('/api/booking/unclaimed'),
        fetch('/api/booking/all'),
      ]);
      const myData = await myRes.json();
      const unclaimedData = await unclaimedRes.json();
      const allData = await allRes.json();
      setMySessions(myData.bookings || []);
      setUnclaimed(unclaimedData.bookings || []);
      setAllBookings(allData.bookings || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function respondToSession(bookingId: string, action: 'accept' | 'pass') {
    setClaiming(bookingId);
    try {
      const res = await fetch('/api/booking/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || `Failed to ${action} session`);
        return;
      }
      if (action === 'pass') {
        alert('Session passed. Other engineers have been notified.');
      }
      await loadData();
    } catch {
      alert('Network error');
    } finally {
      setClaiming(null);
    }
  }

  // Legacy wrapper
  async function claimSession(bookingId: string) {
    return respondToSession(bookingId, 'accept');
  }

  if (loading) return <p className="font-mono text-sm text-black/70">Loading sessions...</p>;

  const pendingInvites = mySessions.filter((b) =>
    b.status === 'pending_deposit' && b.engineer_name
  );
  const myActive = mySessions.filter((b) =>
    ['confirmed', 'pending', 'approved'].includes(b.status) && b.engineer_name
  );
  const myCompleted = mySessions.filter((b) => b.status === 'completed');

  return (
    <div className="space-y-10">
      {/* All Studio Bookings — for availability reference */}
      <div>
        <button
          onClick={() => setShowAllBookings(!showAllBookings)}
          className="font-mono text-sm font-semibold uppercase tracking-wider mb-4 flex items-center gap-2 hover:text-accent transition-colors"
        >
          Studio Schedule ({allBookings.length} upcoming)
          <span className="text-xs font-normal text-black/60">{showAllBookings ? '▲ Hide' : '▼ Show'}</span>
        </button>
        {showAllBookings && (
          allBookings.length === 0 ? (
            <p className="font-mono text-xs text-black/60 border border-black/10 p-6 text-center">
              No upcoming bookings
            </p>
          ) : (
            <div className="border-2 border-black/10 overflow-hidden">
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr className="bg-black/5 text-left">
                    <th className="px-3 py-2 font-semibold uppercase tracking-wider">Date</th>
                    <th className="px-3 py-2 font-semibold uppercase tracking-wider">Time</th>
                    <th className="px-3 py-2 font-semibold uppercase tracking-wider">Client</th>
                    <th className="px-3 py-2 font-semibold uppercase tracking-wider hidden sm:table-cell">Studio</th>
                    <th className="px-3 py-2 font-semibold uppercase tracking-wider hidden sm:table-cell">Engineer</th>
                    <th className="px-3 py-2 font-semibold uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allBookings.map((b) => {
                    return (
                      <tr key={b.id} className="border-t border-black/5 hover:bg-accent/5 transition-colors">
                        <td className="px-3 py-2">
                          {fmtSessionDate(b.start_time, { weekday: 'short', month: 'short', day: 'numeric' })}
                        </td>
                        <td className="px-3 py-2">
                          {fmtSessionTime(b.start_time, { hour: 'numeric', minute: '2-digit' })}
                          {' · '}{formatDuration(b.duration)}
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-semibold">{b.customer_name}</span>
                          {b.artist_name && <span className="text-black/60 ml-1">({b.artist_name})</span>}
                        </td>
                        <td className="px-3 py-2 hidden sm:table-cell">
                          {b.room === 'studio_a' ? 'Studio A' : b.room === 'studio_b' ? 'Studio B' : b.room || '—'}
                        </td>
                        <td className="px-3 py-2 hidden sm:table-cell">{b.engineer_name || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`font-bold uppercase text-[10px] px-1.5 py-0.5 ${
                            b.status === 'confirmed' ? 'bg-accent/20 text-amber-700' :
                            b.status === 'pending_deposit' ? 'bg-blue-100 text-blue-700' :
                            'bg-black/5 text-black/70'
                          }`}>
                            {b.status === 'pending_deposit' ? 'Pending' : b.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <div>
          <h3 className="font-mono text-sm font-semibold uppercase tracking-wider mb-4">
            Pending Invites ({pendingInvites.length})
          </h3>
          <div className="space-y-3">
            {pendingInvites.map((b) => (
              <PendingInviteCard key={b.id} booking={b} onUpdate={loadData} />
            ))}
          </div>
        </div>
      )}

      {/* Available Sessions (Unclaimed) */}
      <div>
        <h3 className="font-mono text-sm font-semibold uppercase tracking-wider mb-4">
          Available Sessions ({unclaimed.length})
        </h3>
        {unclaimed.length === 0 ? (
          <p className="font-mono text-xs text-black/60 border border-black/10 p-6 text-center">
            No available sessions right now
          </p>
        ) : (
          <div className="space-y-3">
            {unclaimed.map((b) => (
              <BookingCard
                key={b.id}
                booking={b}
                onUpdate={loadData}
                unclaimed
                onClaim={() => claimSession(b.id)}
                onPass={b.requested_engineer ? () => respondToSession(b.id, 'pass') : undefined}
                claimLoading={claiming === b.id}
                userEmail={userEmail}
              />
            ))}
          </div>
        )}
      </div>

      {/* My Active Sessions */}
      <div>
        <h3 className="font-mono text-sm font-semibold uppercase tracking-wider mb-4">
          My Sessions ({myActive.length})
        </h3>
        {myActive.length === 0 ? (
          <p className="font-mono text-xs text-black/60 border border-black/10 p-6 text-center">No active sessions</p>
        ) : (
          <div className="space-y-3">
            {myActive.map((b) => (
              <BookingCard key={b.id} booking={b} onUpdate={loadData} />
            ))}
          </div>
        )}
      </div>

      {/* Completed */}
      <div>
        <h3 className="font-mono text-sm font-semibold uppercase tracking-wider mb-4">
          Completed ({myCompleted.length})
        </h3>
        {myCompleted.length === 0 ? (
          <p className="font-mono text-xs text-black/60 border border-black/10 p-6 text-center">No completed sessions</p>
        ) : (
          <div className="space-y-3">
            {myCompleted.map((b) => (
              <BookingCard key={b.id} booking={b} onUpdate={loadData} completed />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PendingInviteCard({ booking, onUpdate }: { booking: Booking; onUpdate: () => void }) {
  const [resending, setResending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Extract invite URL from admin_notes if stored there
  const tokenMatch = booking.admin_notes?.match(/Token: ([a-f0-9-]+)/);
  const inviteToken = tokenMatch?.[1];
  const inviteUrl = inviteToken
    ? `https://sweetdreamsmusic.com/book/invite/${inviteToken}?booking=${booking.id}`
    : null;

  async function resendInvite() {
    if (!booking.customer_email) {
      alert('No email on file for this client');
      return;
    }
    setResending(true);
    try {
      const res = await fetch('/api/booking/resend-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Invite resent to ${booking.customer_email}`);
      } else {
        alert(data.error || 'Failed to resend');
      }
    } catch {
      alert('Network error');
    } finally {
      setResending(false);
    }
  }

  function copyLink() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function cancelInvite() {
    if (!confirm(`Cancel invite for ${booking.customer_name}?`)) return;
    setCancelling(true);
    try {
      const res = await fetch('/api/booking/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, status: 'cancelled' }),
      });
      if (res.ok) onUpdate();
      else alert('Failed to cancel');
    } catch {
      alert('Network error');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="border-2 border-amber-300/50 bg-amber-50/30 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-mono text-sm font-bold">{booking.customer_name}</p>
            {booking.artist_name && (
              <span className="font-mono text-xs text-black/60">({booking.artist_name})</span>
            )}
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 px-2 py-0.5">
              Awaiting Payment
            </span>
          </div>
          {booking.customer_email && (
            <p className="font-mono text-xs text-black/70">{booking.customer_email}</p>
          )}
          <p className="font-mono text-xs text-black/60 mt-1">
            {fmtSessionDate(booking.start_time, { weekday: 'short', month: 'short', day: 'numeric' })}
            {' · '}
            {fmtSessionTime(booking.start_time, { hour: 'numeric', minute: '2-digit' })}
            {' · '}
            {formatDuration(Number(booking.duration))}
            {booking.room && ` · ${booking.room === 'studio_a' ? 'Studio A' : 'Studio B'}`}
          </p>
          <p className="font-mono text-[10px] text-black/60 mt-1">
            Created {fmtStampDate(booking.created_at, { month: 'short', day: 'numeric' })}
            {' · '}Deposit: {formatCents(booking.deposit_amount)} of {formatCents(booking.total_amount)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-semibold">{formatCents(booking.total_amount)}</p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-amber-200/50 flex flex-wrap gap-2">
        {booking.customer_email && (
          <button
            onClick={resendInvite}
            disabled={resending}
            className="font-mono text-xs font-bold uppercase tracking-wider bg-accent text-black px-4 py-2 hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {resending ? 'Sending...' : 'Resend Invite'}
          </button>
        )}
        {inviteUrl && (
          <button
            onClick={copyLink}
            className="font-mono text-xs font-bold uppercase tracking-wider border-2 border-black/20 text-black/60 px-4 py-2 hover:bg-black/5 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        )}
        <button
          onClick={cancelInvite}
          disabled={cancelling}
          className="font-mono text-xs font-bold uppercase tracking-wider border-2 border-red-300 text-red-500 px-4 py-2 hover:bg-red-50 disabled:opacity-50 transition-colors"
        >
          {cancelling ? 'Cancelling...' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

function BookingCard({ booking, onUpdate, completed, unclaimed, onClaim, onPass, claimLoading, userEmail }: {
  booking: Booking; onUpdate?: () => void; completed?: boolean;
  unclaimed?: boolean; onClaim?: () => void; onPass?: () => void;
  claimLoading?: boolean; userEmail?: string;
}) {
  const [charging, setCharging] = useState(false);
  const [chargeError, setChargeError] = useState('');
  const [showChargeEdit, setShowChargeEdit] = useState(false);
  const [chargeAmountInput, setChargeAmountInput] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newDuration, setNewDuration] = useState<number>(booking.duration || 2);

  // Open the time/duration editor pre-filled with the booking's current
  // values. Engineers most often use this to *correct* a session post-fact
  // (added 15 min, ran over by an hour, etc.), so making them re-enter
  // date+time from blank just to bump duration is friction we don't need.
  // Stored timestamps in this app are Fort Wayne wall-clock tagged with
  // a +00 suffix — we use UTC getters to round-trip the digits as-is.
  function openTimeEditor() {
    const sd = new Date(booking.start_time);
    const y = sd.getUTCFullYear();
    const mo = String(sd.getUTCMonth() + 1).padStart(2, '0');
    const da = String(sd.getUTCDate()).padStart(2, '0');
    const hh = String(sd.getUTCHours()).padStart(2, '0');
    const mm = String(sd.getUTCMinutes()).padStart(2, '0');
    setNewDate(`${y}-${mo}-${da}`);
    setNewTime(`${hh}:${mm}`);
    setNewDuration(Number(booking.duration) || 2);
    setShowReschedule(true);
  }
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showCashPayment, setShowCashPayment] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [cashNote, setCashNote] = useState('');
  // Cash correction modal — engineers can edit their own session
  // totals after completion. Goes through audit log + admin alert.
  const [showCashCorrection, setShowCashCorrection] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [showChangeEngineer, setShowChangeEngineer] = useState(false);
  const [selectedEngineer, setSelectedEngineer] = useState(booking.engineer_name || '');

  // --- Completion gate (time + files) ---
  // See lib/booking-completion.ts for the rules. The UI state here only
  // drives the checklist panel; the server enforces the gate on write.
  const [completionCheck, setCompletionCheck] = useState<{
    canComplete: boolean;
    reasons: string[];
    reasonMessages: string[];
    details: {
      status: string | null;
      scheduledEnd: string | null;
      nowIso: string;
      minutesUntilAllowed: number;
      filesCount: number;
      timeGatePassed: boolean;
      filesGatePassed: boolean;
    };
  } | null>(null);
  const [completionLoading, setCompletionLoading] = useState(false);

  // --- Remainder editor (engineer can fix their own session math) ---
  const [showRemainderEdit, setShowRemainderEdit] = useState(false);
  const [remainderEditInput, setRemainderEditInput] = useState('');
  const [remainderEditSaving, setRemainderEditSaving] = useState(false);
  const [showPrep, setShowPrep] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [prepData, setPrepData] = useState<any>(null);
  const [prepLoading, setPrepLoading] = useState(false);

  const remainder = booking.remainder_amount || 0;
  const canCharge = booking.status === 'confirmed' && remainder > 0 && booking.engineer_name;
  const canComplete = booking.status === 'confirmed' && booking.engineer_name;
  const canCancel = ['confirmed', 'pending'].includes(booking.status);

  async function chargeRemainder(customAmount?: number) {
    const amountToCharge = customAmount || remainder;
    if (!confirm(`Charge $${(amountToCharge / 100).toFixed(2)} to ${booking.customer_name}'s card on file?`)) return;
    setCharging(true);
    setChargeError('');
    try {
      const res = await fetch('/api/booking/charge-remainder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, amount: customAmount || undefined }),
      });
      const data = await res.json();
      if (!res.ok && !data.fallback) {
        setChargeError(data.error || 'Failed to charge');
        return;
      }
      if (data.fallback && data.paymentUrl) {
        alert(
          data.emailSent
            ? 'Could not charge saved card (bank requires authentication). A payment link has been automatically emailed to the client.'
            : 'Could not charge saved card. Payment link copied to clipboard — send it to the client.'
        );
        navigator.clipboard.writeText(data.paymentUrl);
        return;
      }
      alert(`Charged ${formatCents(data.amountCharged)} successfully`);
      setShowChargeEdit(false);
      setChargeAmountInput('');
      onUpdate?.();
    } catch {
      setChargeError('Network error');
    } finally {
      setCharging(false);
    }
  }

  async function updateBooking(updates: Record<string, unknown>, label: string) {
    setActionLoading(label);
    try {
      const res = await fetch('/api/booking/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, ...updates }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || `Failed to ${label}`);
        return;
      }
      onUpdate?.();
    } catch {
      alert('Network error');
    } finally {
      setActionLoading(null);
    }
  }

  function handleCancel() {
    if (!confirm(`Cancel ${booking.customer_name}'s session? This cannot be undone.`)) return;
    updateBooking({ status: 'cancelled' }, 'cancel');
  }

  // Replaces the old direct-set of status='completed'. Now goes through
  // /api/booking/complete which enforces the time + files gates server-side.
  // Engineers (non-admin) can't force — only super-admins can bypass via
  // `force: true`. If an engineer tries, the server returns 403.
  async function handleComplete() {
    setActionLoading('complete');
    try {
      const res = await fetch('/api/booking/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, force: false }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onUpdate?.();
      } else if (res.status === 400 && data.canCompleteCheck) {
        const msgs: string[] = data.canCompleteCheck.reasonMessages || [];
        alert(
          `Cannot complete this session yet:\n\n` +
          (msgs.length ? msgs.map((m: string) => `• ${m}`).join('\n') : 'Unknown reason') +
          `\n\nAn admin can force-complete if needed.`
        );
        // Refresh the checklist so the UI reflects the latest state.
        await refreshCompletionCheck();
      } else {
        alert(data.error || 'Failed to complete session');
      }
    } catch {
      alert('Network error');
    } finally {
      setActionLoading(null);
    }
  }

  // Fetch the completion check. Used on mount (for confirmed bookings) and
  // after actions that would change its outcome (file uploads, etc.).
  const refreshCompletionCheck = useCallback(async () => {
    if (!booking.id || completed) return;
    if (!['confirmed', 'pending', 'approved'].includes(booking.status)) return;
    setCompletionLoading(true);
    try {
      const res = await fetch(`/api/booking/can-complete?bookingId=${booking.id}`);
      if (res.ok) {
        const data = await res.json();
        setCompletionCheck(data);
      }
    } catch {
      // transient — silent on the UI, a retry will happen on the next action
    } finally {
      setCompletionLoading(false);
    }
  }, [booking.id, booking.status, completed]);

  useEffect(() => {
    refreshCompletionCheck();
    // Re-check every 60s so the "time to go" countdown advances automatically
    // without a full page refresh.
    if (!['confirmed', 'pending', 'approved'].includes(booking.status)) return;
    const t = setInterval(refreshCompletionCheck, 60_000);
    return () => clearInterval(t);
  }, [refreshCompletionCheck, booking.status]);

  // Save a new remainder via the engineer-or-admin adjust-balance endpoint.
  // Matches the admin-side BalanceEditor semantics: this SETS the remainder
  // (it does not add to it) and confirms large changes.
  async function saveRemainderEdit() {
    const amount = parseFloat(remainderEditInput);
    if (Number.isNaN(amount) || amount < 0) {
      alert('Enter a valid non-negative dollar amount.');
      return;
    }
    const cents = Math.round(amount * 100);
    const currentRemainder = booking.remainder_amount ?? 0;
    const delta = cents - currentRemainder;
    if (Math.abs(delta) >= 100) {
      const ok = confirm(
        `REPLACE remainder with $${(cents / 100).toFixed(2)}?\n\n` +
        `Current remainder: $${(currentRemainder / 100).toFixed(2)}\n` +
        `New remainder:     $${(cents / 100).toFixed(2)}\n` +
        `Change:            ${delta >= 0 ? '+' : ''}$${(delta / 100).toFixed(2)}\n\n` +
        `Note: this SETS the remainder to the exact dollar amount you entered — it does NOT add to it.`
      );
      if (!ok) return;
    }

    setRemainderEditSaving(true);
    try {
      const res = await fetch('/api/booking/adjust-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, newRemainderCents: cents }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to update balance');
        return;
      }
      setShowRemainderEdit(false);
      setRemainderEditInput('');
      onUpdate?.();
    } catch {
      alert('Network error');
    } finally {
      setRemainderEditSaving(false);
    }
  }

  function handleReschedule() {
    if (!newDate || !newTime) {
      alert('Select a date and time');
      return;
    }
    if (!(newDuration > 0)) {
      alert('Duration must be greater than zero');
      return;
    }
    const startTime = `${newDate}T${newTime}:00`;
    const label = formatDuration(newDuration);
    // Detect "this is just a duration change" so the confirm copy reads right
    // for the common engineer-correction case. Compares against the booking's
    // current start_time using the same +00-as-FW-wall-clock convention used
    // for the openTimeEditor() pre-fill.
    const sd = new Date(booking.start_time);
    const currentDate = `${sd.getUTCFullYear()}-${String(sd.getUTCMonth() + 1).padStart(2, '0')}-${String(sd.getUTCDate()).padStart(2, '0')}`;
    const currentTime = `${String(sd.getUTCHours()).padStart(2, '0')}:${String(sd.getUTCMinutes()).padStart(2, '0')}`;
    const onlyDurationChanged =
      newDate === currentDate &&
      newTime === currentTime &&
      Number(booking.duration) !== newDuration;
    const msg = onlyDurationChanged
      ? `Update session length to ${label}? (server will recompute end time)`
      : `Save ${newDate} at ${newTime}, ${label}?`;
    if (!confirm(msg)) return;
    // Changing the session time resolves any pending reschedule request — clear
    // the flag so the booking stops showing "Reschedule Requested" (mirrors the
    // admin BookingManager reschedule path).
    updateBooking({ startTime, duration: newDuration, clearReschedule: true }, 'reschedule');
    setShowReschedule(false);
  }

  async function handleFileUpload() {
    if (uploadFiles.length === 0 || !booking.customer_email) return;
    setUploading(true);

    try {
      for (let i = 0; i < uploadFiles.length; i++) {
        const file = uploadFiles[i];
        setUploadProgress(`Uploading ${i + 1} of ${uploadFiles.length}: ${file.name}`);

        // Step 1: Get signed upload URL
        const urlRes = await fetch('/api/admin/library/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, customerEmail: booking.customer_email }),
        });
        const urlData = await urlRes.json();
        if (!urlRes.ok) { alert(`Failed: ${urlData.error}`); continue; }

        // Step 2: Upload directly to Supabase Storage
        const uploadRes = await fetch(urlData.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!uploadRes.ok) { alert(`Upload failed for ${file.name}`); continue; }

        // Step 3: Create record + send email on last file only
        const isLast = i === uploadFiles.length - 1;
        const formData = new FormData();
        formData.append('user_id', urlData.userId);
        formData.append('file_name', file.name);
        formData.append('file_path', urlData.filePath);
        formData.append('file_size', String(file.size));
        formData.append('file_type', file.type);
        formData.append('display_name', file.name);
        formData.append('description', `From session on ${fmtSessionDate(booking.start_time)}`);
        formData.append('send_email', isLast ? 'true' : 'false');
        formData.append('customer_email', booking.customer_email);
        formData.append('customer_name', booking.customer_name);
        formData.append('booking_room', booking.room || '');
        formData.append('booking_date', fmtSessionDate(booking.start_time, { weekday: 'long', month: 'long', day: 'numeric' }));
        formData.append('skip_upload', 'true');
        await fetch('/api/admin/library/deliverables', { method: 'POST', body: formData });
      }

      setUploadSuccess(true);
      setUploadFiles([]);
      setUploadProgress('');
      // File upload just changed the files-gate outcome — re-check so the
      // checklist + Mark Complete button update without waiting for the
      // 60-second poll.
      refreshCompletionCheck();
    } catch (err) {
      console.error('Upload error:', err);
      alert('Network error — please try again');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }

  async function recordCash() {
    const amount = parseFloat(cashAmount);
    if (isNaN(amount) || amount <= 0) return;
    setActionLoading('cash');
    try {
      const res = await fetch('/api/booking/record-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, amount, method: 'cash', note: cashNote }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Cash payment of $${amount.toFixed(2)} recorded`);
        setShowCashPayment(false);
        setCashAmount('');
        setCashNote('');
        onUpdate?.();
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch {
      alert('Error recording payment');
    } finally {
      setActionLoading(null);
    }
  }

  async function resendEmail(type: 'confirmation' | 'engineer_alert') {
    setNotifying(true);
    try {
      const res = await fetch('/api/booking/renotify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, type }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Email sent to: ${data.to}`);
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch {
      alert('Error sending email');
    } finally {
      setNotifying(false);
    }
  }

  return (
    <div className={`border-2 p-4 sm:p-5 ${unclaimed ? 'border-[#F4C430]/40 bg-[#F4C430]/5' : 'border-black/10'}`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-bold">
            {booking.customer_name}
            {booking.artist_name && <span className="font-normal text-black/60 ml-1">({booking.artist_name})</span>}
          </p>
          {(booking.customer_email || booking.customer_phone) && (
            <p className="font-mono text-xs text-black/70">
              {booking.customer_email}
              {booking.customer_email && booking.customer_phone && ' · '}
              {booking.customer_phone}
            </p>
          )}
          {booking.requested_engineer && (
            <div className="flex items-center gap-2 mt-0.5">
              <p className="font-mono text-[10px] text-amber-600 font-semibold">
                Requested: {booking.requested_engineer}
              </p>
              {booking.priority_expires_at && new Date(booking.priority_expires_at) > new Date() && (
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 px-2 py-0.5 animate-pulse">
                  Priority Window Active
                </span>
              )}
              {booking.priority_expires_at && new Date(booking.priority_expires_at) <= new Date() && (
                <span className="font-mono text-[10px] uppercase tracking-wider bg-black/5 text-black/40 px-2 py-0.5">
                  Priority Expired
                </span>
              )}
            </div>
          )}
          {booking.reschedule_requested && (
            <p className="font-mono text-[10px] text-red-500 font-semibold mt-0.5">
              ⚠ Reschedule Requested
            </p>
          )}
          {booking.status === 'pending_deposit' && booking.deposit_method === 'cash' && (
            <p className="font-mono text-[10px] text-amber-600 font-semibold mt-0.5">
              ⏳ Cash pending — record cash to lock the slot
            </p>
          )}

          {/* Round 4: band-booking workflow badges. We surface three
              orthogonal signals so the engineer reads the row correctly:
                1. 3-day block — badge says "Day X of 3" (group_id).
                2. Free 1-hour setup — adjusts arrival time.
                3. Sweet Spot add-on — extra 2hr filming at the END of
                   the session, with extra crew/cameras to expect. */}
          <BandBookingBadges booking={booking} />

          <p className="font-mono text-xs text-black/60 mt-1">
            {fmtSessionDate(booking.start_time, { weekday: 'short', month: 'short', day: 'numeric' })}
            {' · '}
            {fmtSessionTime(booking.start_time, { hour: 'numeric', minute: '2-digit' })}
            {' · '}
            {formatDuration(Number(booking.duration))}
            {booking.room && ` · ${booking.room === 'studio_a' ? 'Studio A' : 'Studio B'}`}
            {!!booking.setup_minutes_before && booking.setup_minutes_before > 0 && (
              <span className="text-accent font-bold">
                {' '}· arrive {booking.setup_minutes_before}min early for setup
              </span>
            )}
          </p>
        </div>
        <div className="text-right">
          <span className={`font-mono text-xs font-bold uppercase tracking-wider px-2 py-1 inline-block ${
            booking.status === 'completed' ? 'bg-green-100 text-green-700' :
            booking.status === 'confirmed' ? 'bg-accent/20 text-amber-700' :
            booking.status === 'cancelled' ? 'bg-red-100 text-red-600' :
            'bg-black/5 text-black/70'
          }`}>
            {booking.status}
          </span>
          {booking.status === 'completed' && remainder > 0 && (
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-red-600 text-white inline-block mt-1 animate-pulse">
              UNPAID — {formatCents(remainder)}
            </span>
          )}
          <p className="font-mono text-sm font-semibold mt-1">
            {formatCents(booking.total_amount)}
          </p>
          {booking.actual_deposit_paid != null && booking.actual_deposit_paid > 0 && (
            <p className="font-mono text-[10px] text-black/60">
              Deposit: {formatCents(booking.actual_deposit_paid)}
              {remainder > 0 && ` · Remainder: ${formatCents(remainder)}`}
            </p>
          )}
        </div>
      </div>

      {booking.admin_notes && (
        <p className="font-mono text-xs text-black/50 mt-2 border-t border-black/5 pt-2">{booking.admin_notes}</p>
      )}

      {/* Session Prep Info */}
      {booking.status === 'confirmed' && (
        <div className="mt-2 border-t border-black/5 pt-2">
          <button
            onClick={async () => {
              if (!showPrep && !prepData) {
                setPrepLoading(true);
                try {
                  const res = await fetch(`/api/booking/prep?bookingId=${booking.id}`);
                  const data = await res.json();
                  setPrepData(data.prep || null);
                } catch { setPrepData(null); }
                setPrepLoading(false);
              }
              setShowPrep(!showPrep);
            }}
            className="font-mono text-[11px] font-bold text-accent hover:underline flex items-center gap-1"
          >
            🎤 {showPrep ? 'Hide' : 'View'} Session Prep
          </button>
          {showPrep && prepLoading && <p className="font-mono text-[10px] text-black/60 mt-1">Loading...</p>}
          {showPrep && !prepLoading && !prepData && (
            <p className="font-mono text-[10px] text-black/60 mt-1 italic">Client hasn&apos;t filled out their session prep yet.</p>
          )}
          {showPrep && prepData && (
            <div className="mt-2 space-y-1.5 bg-black/[.02] p-3 border border-black/5">
              {prepData.session_type && (
                <p className="font-mono text-[11px]"><span className="text-black/60 uppercase">Type:</span> <span className="font-semibold">{String(prepData.session_type).replace('_', ' + ')}</span></p>
              )}
              {prepData.session_goals && (
                <p className="font-mono text-[11px]"><span className="text-black/60 uppercase">Goals:</span> {String(prepData.session_goals)}</p>
              )}
              {prepData.beat_source && (
                <p className="font-mono text-[11px]"><span className="text-black/60 uppercase">Beat:</span> {String(prepData.beat_source).replace('_', ' ')}{prepData.beat_file_name ? ` — ${prepData.beat_file_name}` : ''}{prepData.beat_link ? ` — ${prepData.beat_link}` : ''}</p>
              )}
              {prepData.beat_notes && (
                <p className="font-mono text-[11px]"><span className="text-black/60 uppercase">Beat Notes:</span> {String(prepData.beat_notes)}</p>
              )}
              {prepData.lyrics_status && (
                <p className="font-mono text-[11px]"><span className="text-black/60 uppercase">Lyrics:</span> {String(prepData.lyrics_status)}</p>
              )}
              {prepData.vocal_style && (
                <p className="font-mono text-[11px]"><span className="text-black/60 uppercase">Style:</span> {String(prepData.vocal_style)}</p>
              )}
              {prepData.num_songs && Number(prepData.num_songs) > 1 && (
                <p className="font-mono text-[11px]"><span className="text-black/60 uppercase">Songs:</span> {String(prepData.num_songs)}+</p>
              )}
              {Array.isArray(prepData.reference_tracks) && prepData.reference_tracks.length > 0 && (
                <div>
                  <p className="font-mono text-[10px] text-black/60 uppercase">References:</p>
                  {prepData.reference_tracks.map((ref: { title?: string; artist?: string; link?: string }, i: number) => (
                    <p key={i} className="font-mono text-[11px] ml-2">
                      • {ref.title || 'Untitled'}{ref.artist ? ` — ${ref.artist}` : ''}
                      {ref.link && <a href={ref.link} target="_blank" rel="noopener noreferrer" className="text-accent ml-1 hover:underline">↗</a>}
                    </p>
                  ))}
                </div>
              )}
              {prepData.special_requests && (
                <p className="font-mono text-[11px]"><span className="text-black/60 uppercase">Requests:</span> {String(prepData.special_requests)}</p>
              )}
              {!prepData.completed && (
                <p className="font-mono text-[10px] text-amber-600 italic mt-1">⚠ Client started prep but hasn&apos;t submitted yet</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Completion checklist — visible on active (non-completed) sessions so
          the engineer knows exactly what blocks completion. Hidden when the
          card is unclaimed (they can't complete something they don't own).
          Failed gates use amber ⚠ (not a subtle empty circle) so the engineer
          spots them at a glance — the pre-compaction version used ○/dim-gray
          which read as "optional" rather than "blocking". */}
      {!completed && !unclaimed && canComplete && (
        <div className="mt-3 pt-3 border-t border-black/10">
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/60 mb-1.5">
            Completion Checklist
          </p>
          <div className="space-y-1">
            {/* Time gate */}
            <div className="flex items-start gap-2">
              <span className={`font-mono text-sm font-bold ${completionCheck?.details.timeGatePassed ? 'text-green-600' : 'text-amber-600'}`}>
                {completionCheck?.details.timeGatePassed ? '✓' : '⚠'}
              </span>
              <div className="flex-1">
                <p className={`font-mono text-xs ${completionCheck?.details.timeGatePassed === false ? 'text-amber-800 font-semibold' : ''}`}>
                  Within 30 min of scheduled end
                </p>
                {completionCheck?.details.scheduledEnd && (
                  <p className="font-mono text-[10px] text-black/50">
                    {/* Stored timestamps in this app are Fort Wayne wall
                        clock tagged with +00 — to avoid a double timezone
                        conversion that was showing end 4h too early (e.g.
                        a 6:30 PM session reading as "Ends 2:30 PM"), we
                        unpack with timeZone: 'UTC' like the rest of the
                        app does. See lib/booking-completion.ts header. */}
                    Ends {fmtSessionDateTime(completionCheck.details.scheduledEnd, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                    {!completionCheck.details.timeGatePassed && completionCheck.details.minutesUntilAllowed > 0 && (
                      <> — about {completionCheck.details.minutesUntilAllowed} min to go</>
                    )}
                  </p>
                )}
              </div>
            </div>
            {/* Files gate */}
            <div className="flex items-start gap-2">
              <span className={`font-mono text-sm font-bold ${completionCheck?.details.filesGatePassed ? 'text-green-600' : 'text-amber-600'}`}>
                {completionCheck?.details.filesGatePassed ? '✓' : '⚠'}
              </span>
              <div className="flex-1">
                <p className={`font-mono text-xs ${completionCheck?.details.filesGatePassed === false ? 'text-amber-800 font-semibold' : ''}`}>
                  At least one session file uploaded
                </p>
                <p className="font-mono text-[10px] text-black/50">
                  {completionCheck?.details.filesCount === 0
                    ? 'Upload a file for the client before completing.'
                    : `${completionCheck?.details.filesCount ?? 0} file(s) uploaded for this client since session start.`}
                </p>
              </div>
            </div>
            {completionLoading && (
              <p className="font-mono text-[10px] text-black/40 italic">Checking…</p>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!completed && (
        <div className="mt-3 pt-3 border-t border-black/10 flex flex-wrap gap-2">
          {unclaimed && onClaim && (() => {
            const isInPriority = booking.requested_engineer && booking.priority_expires_at &&
              new Date(booking.priority_expires_at) > new Date();
            const isRequestedForMe = booking.requested_engineer && userEmail && (
              booking.requested_engineer === userEmail ||
              // Also match by display names from ENGINEERS constant
              true // We'll rely on the API to enforce this
            );

            return (
              <div className="flex items-center gap-2">
                {/* Accept button — always shown */}
                <button
                  onClick={onClaim}
                  disabled={claimLoading}
                  className="font-mono text-xs font-bold uppercase tracking-wider bg-[#F4C430] text-black px-5 py-2.5 hover:bg-[#F4C430]/80 disabled:opacity-50 transition-colors"
                >
                  {claimLoading ? 'Accepting...' : (isInPriority && isRequestedForMe ? '✓ Accept Session' : 'Accept Session')}
                </button>

                {/* Pass button — only for the requested engineer during priority */}
                {isInPriority && onPass && (
                  <button
                    onClick={() => {
                      if (confirm(`Pass on ${booking.customer_name}'s session? It will immediately open to all engineers.`)) {
                        onPass();
                      }
                    }}
                    disabled={claimLoading}
                    className="font-mono text-xs font-bold uppercase tracking-wider border-2 border-black/20 text-black/60 px-5 py-2.5 hover:bg-red-50 hover:border-red-200 hover:text-red-600 disabled:opacity-50 transition-colors"
                  >
                    Pass
                  </button>
                )}

                {/* Priority info */}
                {isInPriority && booking.requested_engineer && (
                  <span className="font-mono text-[10px] text-black/60">
                    Requested: <span className="font-bold text-accent">{booking.requested_engineer}</span>
                    {booking.priority_expires_at && (
                      <> · Priority until {fmtStampDateTime(booking.priority_expires_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>
                    )}
                  </span>
                )}

                {/* Post-priority info */}
                {!isInPriority && booking.requested_engineer && (
                  <span className="font-mono text-[10px] text-red-500/70">
                    {booking.requested_engineer} did not respond · Open to all
                  </span>
                )}
              </div>
            );
          })()}
          {canCharge && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => chargeRemainder()}
                disabled={charging}
                className="font-mono text-xs font-bold uppercase tracking-wider bg-black text-white px-4 py-2 hover:bg-black/80 disabled:opacity-50 transition-colors"
              >
                {charging ? 'Charging...' : `Charge — ${formatCents(remainder)}`}
              </button>
              <button
                onClick={() => { setShowChargeEdit(!showChargeEdit); setChargeAmountInput((remainder / 100).toFixed(2)); }}
                className="font-mono text-[10px] text-black/60 hover:text-black underline"
              >
                Edit
              </button>
            </div>
          )}
          {remainder > 0 && (
            <button
              onClick={() => { setShowCashPayment(!showCashPayment); setCashAmount((remainder / 100).toFixed(2)); setCashNote(''); }}
              title="Record cash paid toward the existing remainder"
              className="font-mono text-xs font-bold uppercase tracking-wider border-2 border-black/20 text-black/60 px-4 py-2 hover:bg-black/5 transition-colors"
            >
              Record Cash
            </button>
          )}
          {remainder === 0 && booking.status !== 'cancelled' && (
            <span className="font-mono text-xs text-green-600 font-bold uppercase px-3 py-2">Paid in Full</span>
          )}
          {/* Engineer (or admin) can set the remainder directly — matches what
              admins do with the BalanceEditor in ClientCRM. Server enforces
              ownership + the `remainder <= total - deposit_paid` invariant. */}
          {canComplete && (
            <button
              onClick={() => {
                setShowRemainderEdit(v => !v);
                setRemainderEditInput(((booking.remainder_amount ?? 0) / 100).toFixed(2));
              }}
              title="Set the remaining balance to a specific dollar amount (does NOT add)"
              className="font-mono text-xs font-bold uppercase tracking-wider border-2 border-black/10 text-black/60 px-3 py-2 hover:bg-black/5 transition-colors"
            >
              Edit Balance
            </button>
          )}
          {canComplete && (() => {
            // Completion gates live in lib/booking-completion.ts and are
            // surfaced via /api/booking/can-complete. When any gate fails
            // we MUST show the reason inline near the button — tooltips
            // alone are invisible on touch devices and fragile on desktop,
            // which is how an engineer ends up staring at "locked" with
            // no actionable feedback. The detailed banner lives as a
            // sibling block below the action row; this button also pops
            // an alert on tap as a last-resort fallback for mobile users
            // who scroll past the banner.
            const gatesReady = completionCheck?.canComplete === true;
            const reasons = completionCheck?.reasonMessages ?? [];
            const isLoading = actionLoading === 'complete';
            const clickableWhenLocked = !isLoading && !gatesReady;
            return (
              <button
                onClick={() => {
                  if (clickableWhenLocked) {
                    const body = reasons.length
                      ? reasons.map(r => `• ${r}`).join('\n')
                      : 'Checking completion requirements — try again in a moment.';
                    alert(`Cannot complete yet:\n\n${body}`);
                    return;
                  }
                  handleComplete();
                }}
                disabled={isLoading}
                title={
                  gatesReady
                    ? 'All completion requirements met.'
                    : reasons.length
                      ? `Blocked:\n${reasons.map(r => `• ${r}`).join('\n')}`
                      : 'Checking completion requirements…'
                }
                className={
                  `font-mono text-xs font-bold uppercase tracking-wider border-2 px-4 py-2 disabled:opacity-50 transition-colors ` +
                  (gatesReady
                    ? 'border-green-600 text-green-700 hover:bg-green-50'
                    : 'border-amber-400 text-amber-700 hover:bg-amber-50')
                }
              >
                {isLoading
                  ? 'Updating...'
                  : gatesReady
                    ? 'Mark Complete'
                    : 'Mark Complete (locked — tap for why)'}
              </button>
            );
          })()}
          {canCancel && (
            <button
              onClick={handleCancel}
              disabled={actionLoading === 'cancel'}
              className="font-mono text-xs font-bold uppercase tracking-wider border-2 border-red-500 text-red-600 px-4 py-2 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              {actionLoading === 'cancel' ? 'Cancelling...' : 'Cancel Session'}
            </button>
          )}
          <button
            onClick={() => (showReschedule ? setShowReschedule(false) : openTimeEditor())}
            className="font-mono text-xs font-bold uppercase tracking-wider border-2 border-black/20 text-black/60 px-4 py-2 hover:bg-black/5 transition-colors"
          >
            Edit Time
          </button>
          <button
            onClick={() => { setShowChangeEngineer(!showChangeEngineer); setSelectedEngineer(booking.engineer_name || ''); }}
            className="font-mono text-xs font-bold uppercase tracking-wider border-2 border-black/20 text-black/60 px-4 py-2 hover:bg-black/5 transition-colors"
          >
            Change Engineer
          </button>
          <button
            onClick={() => resendEmail('confirmation')}
            disabled={notifying}
            className="font-mono text-xs font-bold uppercase tracking-wider border-2 border-black/20 text-black/60 px-4 py-2 hover:bg-black/5 disabled:opacity-50 transition-colors"
          >
            {notifying ? 'Sending...' : 'Resend Email'}
          </button>
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="font-mono text-xs uppercase tracking-wider text-black/60 px-3 py-2 hover:text-black/60 transition-colors"
          >
            {showDebug ? 'Hide Details' : 'Debug'}
          </button>
        </div>
      )}

      {/* Post-completion action row.
          Once a session is `completed` the main action bar above is hidden,
          but engineers still need to correct the recorded time/duration
          after the fact (the actual session may have run longer than the
          original booked window). This slim row exposes Edit Time +
          Change Engineer specifically for that case — kept separate from
          the active-session controls so we don't accidentally re-enable
          Charge/Cancel/Mark Complete on already-completed rows. */}
      {completed && !unclaimed && (
        <div className="mt-3 pt-3 border-t border-black/10 flex flex-wrap gap-2">
          <button
            onClick={() => (showReschedule ? setShowReschedule(false) : openTimeEditor())}
            className="font-mono text-xs font-bold uppercase tracking-wider border-2 border-black/20 text-black/60 px-4 py-2 hover:bg-black/5 transition-colors"
          >
            Edit Time
          </button>
          <button
            onClick={() => { setShowChangeEngineer(!showChangeEngineer); setSelectedEngineer(booking.engineer_name || ''); }}
            className="font-mono text-xs font-bold uppercase tracking-wider border-2 border-black/20 text-black/60 px-4 py-2 hover:bg-black/5 transition-colors"
          >
            Change Engineer
          </button>
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="font-mono text-xs uppercase tracking-wider text-black/60 px-3 py-2 hover:text-black transition-colors"
          >
            {showDebug ? 'Hide Details' : 'Debug'}
          </button>
        </div>
      )}

      {/* Blocked-reasons banner — sibling to the action row. Shown whenever
          the engineer *could* complete (canComplete is true) but at least
          one gate is still failing. Listed item-by-item so the engineer
          sees exactly what's missing without having to tap the locked
          button. Also surfaces a direct "Upload Files" CTA when the files
          gate is the blocker — that's the single most common cause and
          the UI should make fixing it one click away. */}
      {!completed && canComplete && completionCheck && !completionCheck.canComplete && (
        <div className="mt-3 p-3 border-2 border-amber-400 bg-amber-50">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-amber-800">
            Completion locked — {completionCheck.reasonMessages.length === 1 ? '1 issue' : `${completionCheck.reasonMessages.length} issues`} to resolve
          </p>
          <ul className="mt-1.5 space-y-1">
            {completionCheck.reasonMessages.map((msg, idx) => (
              <li key={idx} className="font-mono text-[11px] text-amber-900 flex items-start gap-2">
                <span className="font-bold">⚠</span>
                <span>{msg}</span>
              </li>
            ))}
          </ul>
          {completionCheck.details.filesGatePassed === false && (
            <button
              onClick={() => { setUploadSuccess(false); setShowFileUpload(true); }}
              className="mt-2 font-mono text-xs font-bold uppercase tracking-wider border-2 border-amber-700 text-amber-900 bg-white px-3 py-1.5 hover:bg-amber-100 transition-colors"
            >
              Upload Files →
            </button>
          )}
        </div>
      )}

      {/* Charge edit form */}
      {showChargeEdit && canCharge && (
        <div className="mt-3 p-3 bg-black/5 border border-black/10 space-y-2">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider">Adjust Charge Amount</p>
          <p className="font-mono text-[10px] text-black/70">
            Default remainder is {formatCents(remainder)}. Change the amount if the session was adjusted (e.g. switched studios).
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="font-mono text-[10px] text-black/60 block">Amount ($)</label>
              <input
                type="number"
                step="0.01"
                min="0.50"
                value={chargeAmountInput}
                onChange={(e) => setChargeAmountInput(e.target.value)}
                className="font-mono text-sm border border-black/20 px-3 py-1.5 w-28"
              />
            </div>
            <button
              onClick={() => {
                const cents = Math.round(parseFloat(chargeAmountInput) * 100);
                if (isNaN(cents) || cents < 50) { alert('Minimum charge is $0.50'); return; }
                chargeRemainder(cents);
              }}
              disabled={charging}
              className="font-mono text-xs font-bold uppercase tracking-wider bg-black text-white px-4 py-2 hover:bg-black/80 disabled:opacity-50 transition-colors"
            >
              {charging ? 'Charging...' : `Charge $${chargeAmountInput || '0.00'}`}
            </button>
          </div>
        </div>
      )}

      {/* Remainder-edit form — mirrors the admin BalanceEditor. Shows a
          before → after preview and requires confirmation on large swings. */}
      {showRemainderEdit && (
        <div className="mt-3 p-3 bg-orange-50 border-2 border-orange-200 space-y-2">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider text-orange-800">
            Edit Remaining Balance
          </p>
          <p className="font-mono text-[11px] text-orange-900/80">
            This <span className="font-bold">SETS</span> the remainder to this dollar amount. It does <span className="font-bold">NOT</span> add to it. Use <span className="font-bold">Record Cash</span> if you&apos;re collecting a payment — that&apos;s what adjusts the remainder automatically.
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="font-mono text-[10px] text-black/60 block">Set to ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={remainderEditInput}
                onChange={(e) => setRemainderEditInput(e.target.value)}
                className="font-mono text-sm border border-black/20 px-3 py-1.5 w-28"
              />
            </div>
            {(() => {
              const currentCents = booking.remainder_amount ?? 0;
              const newCents = Math.round((parseFloat(remainderEditInput) || 0) * 100);
              const delta = newCents - currentCents;
              return (
                <div className="font-mono text-[11px] text-black/70">
                  <div>Current: <span className="font-semibold">${(currentCents / 100).toFixed(2)}</span></div>
                  <div>
                    After: <span className="font-semibold">${(newCents / 100).toFixed(2)}</span>
                    {delta !== 0 && (
                      <span className={delta > 0 ? 'text-orange-700 ml-1' : 'text-green-700 ml-1'}>
                        ({delta > 0 ? '+' : ''}${(delta / 100).toFixed(2)})
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}
            <button
              onClick={saveRemainderEdit}
              disabled={remainderEditSaving}
              className="font-mono text-xs font-bold uppercase tracking-wider bg-black text-white px-4 py-2 hover:bg-black/80 disabled:opacity-50 transition-colors"
            >
              {remainderEditSaving ? 'Saving...' : 'Save Balance'}
            </button>
            <button
              onClick={() => { setShowRemainderEdit(false); setRemainderEditInput(''); }}
              className="font-mono text-[10px] text-black/60 underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Cash payment form */}
      {showCashPayment && (
        <div className="mt-3 p-3 bg-black/5 border border-black/10 space-y-2">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider">Record Cash Payment</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="font-mono text-[10px] text-black/60 block">Amount ($)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
                className="font-mono text-sm border border-black/20 px-3 py-1.5 w-28"
              />
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="font-mono text-[10px] text-black/60 block">Note (optional)</label>
              <input
                type="text"
                value={cashNote}
                onChange={(e) => setCashNote(e.target.value)}
                className="font-mono text-xs border border-black/20 px-3 py-1.5 w-full"
                placeholder="e.g. paid at studio"
              />
            </div>
            <button
              onClick={recordCash}
              disabled={actionLoading === 'cash'}
              className="font-mono text-xs font-bold uppercase tracking-wider bg-black text-white px-4 py-2 hover:bg-black/80 disabled:opacity-50 transition-colors"
            >
              {actionLoading === 'cash' ? 'Recording...' : `Record $${cashAmount || '0.00'}`}
            </button>
          </div>
        </div>
      )}

      {/* Edit Time / Duration form
          - Pre-filled by openTimeEditor() so the engineer can bump duration
            without re-entering date/time.
          - Duration accepts quarter-hour granularity (0.25 step) so engineers
            can record "1h 15m", "1h 30m", "2h 45m", etc. The booking flow
            itself still operates on half-hour slots — this just lets us
            record actual elapsed time accurately for analytics + revenue. */}
      {showReschedule && (
        <div className="mt-3 p-3 bg-black/5 border border-black/10 space-y-2">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider">
            Edit Time / Duration
          </p>
          <p className="font-mono text-[10px] text-black/60">
            Pre-filled with this session&apos;s current values. Bump the duration in 15-min steps
            if the session ran long; date + time can be changed for an actual reschedule.
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="font-mono text-[10px] text-black/60 block">Date</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="font-mono text-xs border border-black/20 px-2 py-1.5"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] text-black/60 block">Time</label>
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="font-mono text-xs border border-black/20 px-2 py-1.5"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] text-black/60 block">Duration (hrs)</label>
              <input
                type="number"
                min={0.25}
                max={24}
                step={0.25}
                value={newDuration}
                onChange={(e) => setNewDuration(Number(e.target.value))}
                className="font-mono text-xs border border-black/20 px-2 py-1.5 w-24"
              />
            </div>
            <button
              onClick={handleReschedule}
              disabled={actionLoading === 'reschedule'}
              className="font-mono text-xs font-bold uppercase tracking-wider bg-[#F4C430] text-black px-4 py-2 hover:bg-[#F4C430]/80 disabled:opacity-50 transition-colors"
            >
              {actionLoading === 'reschedule' ? 'Saving...' : 'Confirm'}
            </button>
          </div>
          {newDuration > 0 && (
            <p className="font-mono text-[10px] text-black/50">
              New length: {formatDuration(newDuration)}
            </p>
          )}
        </div>
      )}

      {/* Change Engineer form */}
      {showChangeEngineer && (
        <div className="mt-3 p-3 bg-black/5 border border-black/10 space-y-2">
          <p className="font-mono text-xs font-semibold uppercase tracking-wider">Change Engineer</p>
          <p className="font-mono text-[10px] text-black/70">
            Current: <span className="font-bold">{booking.engineer_name || 'Unassigned'}</span>
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="font-mono text-[10px] text-black/60 block">Engineer</label>
              <select
                value={selectedEngineer}
                onChange={(e) => setSelectedEngineer(e.target.value)}
                className="font-mono text-xs border border-black/20 px-2 py-1.5 min-w-[160px]"
              >
                <option value="">Unassigned</option>
                {ENGINEERS.map((eng) => (
                  <option key={eng.name} value={eng.name}>{eng.displayName} ({eng.name})</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                if (!confirm(`Change engineer to ${selectedEngineer || 'Unassigned'}?`)) return;
                updateBooking({ engineerName: selectedEngineer }, 'change engineer');
                setShowChangeEngineer(false);
              }}
              disabled={actionLoading === 'change engineer'}
              className="font-mono text-xs font-bold uppercase tracking-wider bg-[#F4C430] text-black px-4 py-2 hover:bg-[#F4C430]/80 disabled:opacity-50 transition-colors"
            >
              {actionLoading === 'change engineer' ? 'Saving...' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      {/* Send Files panel — visible both BEFORE and AFTER completion.
          Pre-completion is critical: the files-gate requires at least one
          deliverable exists before Mark Complete is allowed (see
          lib/booking-completion.ts), so hiding this panel until the
          session is completed creates a chicken-and-egg where the
          engineer can neither upload nor complete. Panel stays hidden on
          cancelled/unclaimed sessions where uploads aren't valid. */}
      {!unclaimed && (completed || canComplete) && (
        <div className="mt-3 pt-3 border-t border-black/10">
          {uploadSuccess ? (
            <div className="bg-green-50 border border-green-200 p-4 text-center">
              <p className="font-mono text-xs text-green-700 font-bold">Files sent! Client has been emailed with a download link and review request.</p>
              <button
                onClick={() => { setUploadSuccess(false); setShowFileUpload(true); }}
                className="font-mono text-[10px] text-green-600 hover:underline mt-2"
              >
                Upload another file
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {booking.status === 'completed' && remainder > 0 ? (
                  <span className="font-mono text-[10px] text-red-600 font-bold uppercase px-4 py-2 border border-red-300 bg-red-50 inline-flex items-center">
                    Payment required before sending files — {formatCents(remainder)} owed
                  </span>
                ) : (
                <button
                  onClick={() => setShowFileUpload(!showFileUpload)}
                  className="font-mono text-xs font-bold uppercase tracking-wider bg-black text-white px-4 py-2 hover:bg-black/80 transition-colors"
                >
                  {showFileUpload
                    ? 'Cancel'
                    : completed
                      ? 'Send Files to Client'
                      : 'Upload Session Files'}
                </button>
                )}
                <button
                  onClick={() => setShowDebug(!showDebug)}
                  className="font-mono text-xs uppercase tracking-wider text-black/60 px-3 py-2 hover:text-black/60 transition-colors"
                >
                  {showDebug ? 'Hide Details' : 'Debug'}
                </button>
                {/* Correct Cash — only for cash bookings (no Stripe).
                    Engineers can edit their own session totals after
                    completion. Goes through audit log. */}
                {!booking.stripe_payment_intent_id && (
                  <button
                    onClick={() => setShowCashCorrection(true)}
                    className="font-mono text-xs uppercase tracking-wider text-black/60 px-3 py-2 hover:text-black border border-black/15 hover:border-black inline-flex items-center gap-1"
                    title="Correct cash collected (logged for admin)"
                  >
                    Correct Cash
                  </button>
                )}
              </div>
              {showFileUpload && (
                <div className="mt-3 p-4 bg-black/5 border border-black/10 space-y-3">
                  <p className="font-mono text-xs font-semibold uppercase tracking-wider">Upload Session Files</p>
                  <p className="font-mono text-[10px] text-black/70">
                    Drag and drop files or click to select. Upload all files for {booking.customer_name} — they&apos;ll get one email with a download link.
                  </p>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const files = Array.from(e.dataTransfer.files);
                      setUploadFiles(prev => [...prev, ...files]);
                    }}
                    className={`border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                      isDragging ? 'border-accent bg-accent/10' : 'border-black/20 hover:border-accent'
                    }`}
                  >
                    <label className="cursor-pointer block">
                      <p className="font-mono text-xs font-bold uppercase tracking-wider mb-1">
                        {isDragging ? 'Drop files here' : 'Drag & drop files here'}
                      </p>
                      <p className="font-mono text-[10px] text-black/60">or click to browse — WAV, MP3, FLAC, ZIP</p>
                      <input
                        type="file"
                        accept="audio/*,.wav,.mp3,.flac,.aiff,.m4a,.zip"
                        multiple
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          setUploadFiles(prev => [...prev, ...files]);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                  {uploadFiles.length > 0 && (
                    <div className="space-y-1">
                      {uploadFiles.map((file, i) => (
                        <div key={`${file.name}-${i}`} className="flex items-center justify-between py-1.5 px-2 bg-white border border-black/10">
                          <span className="font-mono text-xs truncate">{file.name}</span>
                          <button
                            onClick={() => setUploadFiles(prev => prev.filter((_, idx) => idx !== i))}
                            className="font-mono text-[10px] text-red-500 hover:underline ml-2 flex-shrink-0"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <p className="font-mono text-[10px] text-black/60">{uploadFiles.length} file{uploadFiles.length > 1 ? 's' : ''} selected</p>
                    </div>
                  )}
                  <button
                    onClick={handleFileUpload}
                    disabled={uploadFiles.length === 0 || uploading || !booking.customer_email}
                    className="bg-[#F4C430] text-black font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-[#F4C430]/80 disabled:opacity-50 transition-colors"
                  >
                    {uploading ? (uploadProgress || 'Uploading...') : `Upload ${uploadFiles.length || ''} File${uploadFiles.length !== 1 ? 's' : ''} & Send to Client`}
                  </button>
                  {!booking.customer_email && (
                    <p className="font-mono text-[10px] text-red-500">No email on file for this client</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Debug info */}
      {showDebug && (
        <div className="mt-3 p-3 bg-black/5 border border-black/10 font-mono text-[10px] text-black/70 space-y-1">
          <p>ID: {booking.id}</p>
          <p>Status: {booking.status}</p>
          <p>Created: {fmtStampDateTime(booking.created_at)}</p>
          <p>Start: {booking.start_time}</p>
          <p>End: {booking.end_time}</p>
          <p>Room: {booking.room || 'none'}</p>
          <p>Engineer: {booking.engineer_name || 'unassigned'}</p>
          <p>Requested: {booking.requested_engineer || 'any'}</p>
          <p>Total: {formatCents(booking.total_amount)} · Deposit: {formatCents(booking.deposit_amount)} · Remainder: {formatCents(remainder)}</p>
          <p>Deposit Paid: {booking.actual_deposit_paid != null ? formatCents(booking.actual_deposit_paid) : 'N/A'}</p>
          <p>Stripe Customer: {booking.stripe_customer_id || 'none'}</p>
          <p>Stripe PI: {booking.stripe_payment_intent_id || 'none'}</p>
        </div>
      )}

      {chargeError && (
        <p className="font-mono text-xs text-red-600 mt-2">{chargeError}</p>
      )}

      {/* Cash correction modal — engineer-side */}
      {showCashCorrection && (
        <CashCorrectionModal
          bookingId={booking.id}
          customerName={booking.customer_name}
          currentTotalCents={booking.total_amount}
          onClose={() => setShowCashCorrection(false)}
          onSaved={() => {
            setShowCashCorrection(false);
            // Refresh the parent so the new total appears.
            onUpdate?.();
          }}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Round 4: badge cluster for band-booking workflow signals.
// Shown right under the customer name on each session card so the
// engineer reads them BEFORE the date/time line. Empty render when
// none of the fields apply, so existing solo + 4hr/8hr band sessions
// look exactly as they did before.
// ──────────────────────────────────────────────────────────────────────
function BandBookingBadges({ booking }: { booking: Booking }) {
  const inGroup = !!booking.booking_group_id;
  const addon = booking.sweet_spot_addon;
  const hasAddon = !!addon?.kind;

  if (!inGroup && !hasAddon) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1">
      {inGroup && (
        <span
          className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-purple-100 text-purple-900 font-bold"
          title="Part of a 3-day band block"
        >
          3-Day Block
        </span>
      )}
      {hasAddon && (
        <span
          className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-accent text-black font-bold"
          title={`Sweet Spot filming at the end of this session (+${addon?.extra_filming_hours ?? 2}hr)`}
        >
          + Sweet Spot Filming
        </span>
      )}
    </div>
  );
}
