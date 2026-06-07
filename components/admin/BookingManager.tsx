'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronDown, DollarSign, X, Check, Clock, Pencil, Mail, Banknote, CreditCard, Send, Upload, Download, FileAudio, Plus, Edit3 } from 'lucide-react';
import { formatCents, formatDuration } from '@/lib/utils';
import { fmtStampDateTime } from '@/lib/studio-time';
import { ENGINEERS, ROOM_LABELS } from '@/lib/constants';
import CashCorrectionModal from '@/components/booking/CashCorrectionModal';
import ReassignCustomerButton from '@/components/booking/ReassignCustomerButton';
import AdminMediaSessionsPanel from '@/components/admin/AdminMediaSessionsPanel';
import { depositCollectedCents } from '@/lib/deposit';
import { bookingStatusLabel } from '@/lib/booking-status';

interface Booking {
  id: string;
  first_name: string;
  last_name: string;
  artist_name: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  start_time: string;
  end_time: string;
  duration: number;
  room: string | null;
  engineer_name: string | null;
  requested_engineer: string | null;
  deposit_amount: number;
  total_amount: number;
  remainder_amount: number;
  actual_deposit_paid: number | null;
  status: string;
  stripe_customer_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  same_day_fee: boolean;
  night_fees_amount: number;
  same_day_fee_amount: number;
  guest_count: number | null;
  guest_fee_amount: number;
  payment_reminder_sent: boolean;
  admin_notes: string | null;
  created_at: string;
  claimed_at: string | null;
  reschedule_requested: boolean;
  deposit_method?: string;
  reschedule_reason: string | null;
  reschedule_requested_at: string | null;
  media_addons: Array<{ type: string; description: string; amount: number; sold_by?: string; filmed_by?: string; edited_by?: string }> | null;
  // Band attribution — null for solo sessions, populated for band bookings.
  // `band_id` comes from the bookings row; `band` is the embedded FK lookup.
  band_id: string | null;
  band: { display_name: string } | null;
}

type StatusFilter = 'all' | 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'rejected';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  pending_approval: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
  rejected: 'bg-red-100 text-red-600',
  deleted: 'bg-gray-100 text-gray-500',
};

export default function BookingManager() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingRemainder, setEditingRemainder] = useState<string | null>(null);
  const [remainderInput, setRemainderInput] = useState('');
  const [editingCharge, setEditingCharge] = useState<string | null>(null);
  const [chargeInput, setChargeInput] = useState('');
  const [editingTime, setEditingTime] = useState<string | null>(null);
  const [timeInput, setTimeInput] = useState('');
  const [dateInput, setDateInput] = useState('');
  const [durationInput, setDurationInput] = useState(2);
  const [showDebug, setShowDebug] = useState<string | null>(null);
  // Cash correction modal — holds the booking we're correcting (id +
  // customer name + current total). null when closed.
  const [cashCorrection, setCashCorrection] = useState<
    { id: string; customer_name: string; total_amount: number } | null
  >(null);
  const [showCashPayment, setShowCashPayment] = useState<string | null>(null);
  const [cashAmount, setCashAmount] = useState('');
  const [cashNote, setCashNote] = useState('');
  const [showPaymentLink, setShowPaymentLink] = useState<string | null>(null);
  const [paymentLinkAmount, setPaymentLinkAmount] = useState('');
  const [paymentLinkSent, setPaymentLinkSent] = useState<string | null>(null);
  const [editingGuests, setEditingGuests] = useState<string | null>(null);
  const [guestInput, setGuestInput] = useState(1);
  const [showFileUpload, setShowFileUpload] = useState<string | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showFiles, setShowFiles] = useState<string | null>(null);
  const [bookingFiles, setBookingFiles] = useState<{ id: string; file_name: string; display_name: string; file_size: number; file_type: string; created_at: string; uploaded_by_name: string | null }[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  async function fetchBookingFiles(customerEmail: string) {
    setLoadingFiles(true);
    try {
      const res = await fetch(`/api/admin/library/deliverables?email=${encodeURIComponent(customerEmail)}`);
      const data = await res.json();
      setBookingFiles(data.deliverables || []);
    } catch {
      setBookingFiles([]);
    }
    setLoadingFiles(false);
  }

  async function downloadFile(fileId: string, fileName: string) {
    try {
      const res = await fetch(`/api/engineer/files/download?id=${fileId}`);
      const data = await res.json();
      if (data.url) {
        const link = document.createElement('a');
        link.href = data.url;
        link.download = fileName;
        link.click();
      } else {
        alert('Could not generate download link');
      }
    } catch {
      alert('Download failed');
    }
  }

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/bookings?status=${filter}&limit=100`);
    const data = await res.json();
    setBookings(data.bookings || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  async function updateStatus(bookingId: string, status: string) {
    // Completion goes through the dedicated /api/booking/complete route so
    // the time + files gates are enforced server-side. See:
    //   app/api/booking/complete/route.ts  (the gate)
    //   lib/booking-completion.ts          (the rules)
    // Bypassing this path (e.g. by hand-crafting a request to the generic
    // /api/admin/bookings/update with updates.status = 'completed') will
    // succeed but is discouraged. If you ever need to, log a ticket first.
    if (status === 'completed') {
      await markComplete(bookingId, false);
      return;
    }
    setUpdatingId(bookingId);
    await fetch('/api/admin/bookings/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId,
        updates: {
          status,
          ...(status === 'cancelled' ? { deleted_at: new Date().toISOString() } : {}),
        },
      }),
    });
    setUpdatingId(null);
    fetchBookings();
  }

  async function markComplete(bookingId: string, force: boolean) {
    setUpdatingId(bookingId);
    try {
      const res = await fetch('/api/booking/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, force }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.forced) {
          alert('Session marked completed (force override logged).');
        }
        fetchBookings();
      } else if (res.status === 400 && data.canCompleteCheck) {
        const msgs: string[] = data.canCompleteCheck.reasonMessages || [];
        const body = msgs.length ? msgs.map((m: string) => `• ${m}`).join('\n') : 'Unknown reason';
        const wantsForce = confirm(
          `Cannot complete session yet:\n\n${body}\n\n` +
          `Force-complete anyway? This is logged as a super-admin override.`
        );
        if (wantsForce) {
          await markComplete(bookingId, true);
          return;
        }
      } else {
        alert(data.error || 'Failed to complete session');
      }
    } catch {
      alert('Error completing session');
    }
    setUpdatingId(null);
  }

  async function updateBooking(bookingId: string, updates: Record<string, unknown>) {
    setUpdatingId(bookingId);
    await fetch('/api/admin/bookings/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, updates }),
    });
    setUpdatingId(null);
    fetchBookings();
  }

  async function handleFileUpload(booking: Booking) {
    if (uploadFiles.length === 0 || !booking.customer_email) return;
    setUploading(true);
    const sessionDate = new Date(booking.start_time);

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
        formData.append('description', `From session on ${sessionDate.toLocaleDateString('en-US', { timeZone: 'UTC' })}`);
        formData.append('send_email', isLast ? 'true' : 'false');
        formData.append('customer_email', booking.customer_email);
        formData.append('customer_name', booking.customer_name);
        formData.append('booking_room', booking.room || '');
        formData.append('booking_date', sessionDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }));
        formData.append('skip_upload', 'true');
        await fetch('/api/admin/library/deliverables', { method: 'POST', body: formData });
      }

      setUploadSuccess(booking.id);
      setUploadFiles([]);
      setUploadProgress('');
      setTimeout(() => setUploadSuccess(null), 5000);
    } catch (err) {
      console.error('Upload error:', err);
      alert('Network error — please try again');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }

  async function chargeRemainder(bookingId: string, amount: number) {
    if (!confirm(`Charge ${formatCents(amount)} to the customer's saved card?`)) return;
    setUpdatingId(bookingId);
    try {
      const res = await fetch('/api/booking/charge-remainder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, amount }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Successfully charged ${formatCents(data.amountCharged)}`);
        fetchBookings();
      } else if (data.fallback && data.paymentUrl) {
        alert(
          data.emailSent
            ? 'Could not charge saved card (bank requires authentication). A payment link has been automatically emailed to the client.'
            : 'Could not charge saved card. Payment link copied to clipboard — send it to the client.'
        );
        navigator.clipboard.writeText(data.paymentUrl);
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch {
      alert('Error charging remainder');
    }
    setUpdatingId(null);
  }

  async function updateNotes(bookingId: string, notes: string) {
    // Skip if another update is in progress to avoid race conditions
    if (updatingId) return;
    await fetch('/api/admin/bookings/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, updates: { admin_notes: notes } }),
    });
  }

  async function transferEngineer(bookingId: string, engineerName: string | null) {
    setUpdatingId(bookingId);
    await fetch('/api/admin/bookings/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingId,
        updates: {
          engineer_name: engineerName,
          ...(engineerName ? { claimed_at: new Date().toISOString() } : { claimed_at: null }),
        },
      }),
    });
    setUpdatingId(null);
    fetchBookings();
  }

  async function renotify(bookingId: string, type: 'confirmation' | 'engineer_alert') {
    setUpdatingId(bookingId);
    try {
      const res = await fetch('/api/booking/renotify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, type }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Email sent to: ${data.to}`);
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch {
      alert('Error sending email');
    }
    setUpdatingId(null);
  }

  async function recordCashPayment(bookingId: string) {
    const amount = parseFloat(cashAmount);
    if (isNaN(amount) || amount <= 0) return;
    setUpdatingId(bookingId);
    try {
      const res = await fetch('/api/booking/record-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, amount, method: 'cash', note: cashNote }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Cash payment of $${amount.toFixed(2)} recorded`);
        setShowCashPayment(null);
        setCashAmount('');
        setCashNote('');
        fetchBookings();
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch {
      alert('Error recording payment');
    }
    setUpdatingId(null);
  }

  async function markPaidInFull(bookingId: string) {
    if (!confirm('Mark this booking as paid in full? This sets the remainder to $0.')) return;
    setUpdatingId(bookingId);
    await fetch('/api/admin/bookings/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, updates: { remainder_amount: 0 } }),
    });
    setUpdatingId(null);
    fetchBookings();
  }

  async function recordStripePaid(bookingId: string) {
    // Find the booking to get its remainder
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking || booking.remainder_amount <= 0) return;
    const amount = booking.remainder_amount / 100;
    setUpdatingId(bookingId);
    try {
      const res = await fetch('/api/booking/record-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, amount, method: 'stripe_manual', note: 'Stripe payment recorded manually' }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Stripe payment of $${amount.toFixed(2)} recorded`);
        fetchBookings();
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch {
      alert('Error recording payment');
    }
    setUpdatingId(null);
  }

  async function sendPaymentLink(bookingId: string) {
    const amount = Math.round(parseFloat(paymentLinkAmount) * 100);
    if (isNaN(amount) || amount <= 0) return;
    if (!confirm(`Send a payment link for $${(amount / 100).toFixed(2)} to the client's email?`)) return;
    setUpdatingId(bookingId);
    try {
      const res = await fetch('/api/booking/send-payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, amount }),
      });
      const data = await res.json();
      if (data.success) {
        setPaymentLinkSent(bookingId);
        setShowPaymentLink(null);
        alert(`Payment link for $${(amount / 100).toFixed(2)} sent to client's email!`);
        setTimeout(() => setPaymentLinkSent(null), 5000);
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch {
      alert('Error sending payment link');
    }
    setUpdatingId(null);
  }

  function saveRemainder(bookingId: string) {
    const cents = Math.round(parseFloat(remainderInput) * 100);
    if (isNaN(cents) || cents < 0) return;
    updateBooking(bookingId, { remainder_amount: cents });
    setEditingRemainder(null);
  }

  function saveKeptDeposit(bookingId: string) {
    const cents = Math.round(parseFloat(remainderInput) * 100);
    if (isNaN(cents) || cents < 0) return;
    updateBooking(bookingId, { actual_deposit_paid: cents });
    setEditingRemainder(null);
  }

  function saveTimeChange(bookingId: string) {
    if (!dateInput || !timeInput) return;
    if (!(durationInput > 0)) return;
    // Compute end_time from start + duration. Supports 15-min increments
    // (durationInput may be 1.25, 1.5, 1.75, etc.) — previously this
    // quantized to half-hour boundaries which would silently drop the
    // quarter-hour fractions admins might enter post-fact. Server-side
    // /api/booking/update derives end_time the same way as a safety net.
    const [h, m] = timeInput.split(':').map(Number);
    const startMins = h * 60 + (m || 0);
    const endMins = startMins + Math.round(durationInput * 60);
    const dayMins = endMins % (24 * 60);
    const endH = Math.floor(dayMins / 60);
    const endMin = dayMins % 60;
    const startDateTime = `${dateInput}T${timeInput}:00`;
    const endDateTime = `${dateInput}T${String(endH).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`;
    updateBooking(bookingId, { start_time: startDateTime, end_time: endDateTime, duration: durationInput, reschedule_requested: false, reschedule_reason: null, reschedule_requested_at: null });
    setEditingTime(null);
  }

  // Stats
  const stats = {
    total: bookings.length,
    active: bookings.filter((b) => ['confirmed', 'pending', 'pending_approval'].includes(b.status)).length,
    completed: bookings.filter((b) => b.status === 'completed').length,
    revenue: bookings.filter((b) => b.status === 'completed').reduce((sum, b) => sum + (b.actual_deposit_paid || b.total_amount), 0),
  };

  return (
    <div>
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Bookings', value: stats.total, icon: CalendarIcon },
          { label: 'Active', value: stats.active, icon: Clock },
          { label: 'Completed', value: stats.completed, icon: Check },
          { label: 'Revenue', value: formatCents(stats.revenue), icon: DollarSign },
        ].map((s) => (
          <div key={s.label} className="border border-black/10 p-4">
            <s.icon className="w-4 h-4 text-accent mb-2" />
            <p className="font-heading text-xl">{s.value}</p>
            <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Media requests & sessions — admin oversight (Phase 6). */}
      <AdminMediaSessionsPanel />

      {/* Filter & Refresh */}
      <div className="flex items-center gap-3 mb-6">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as StatusFilter)}
          className="border-2 border-black px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Awaiting Engineer</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="rejected">Rejected</option>
        </select>
        <button onClick={fetchBookings} className="p-2 border border-black/20 hover:border-black transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <span className="font-mono text-xs text-black/60">{bookings.length} bookings</span>
      </div>

      {/* Bookings List */}
      {loading ? (
        <p className="font-mono text-sm text-black/70">Loading...</p>
      ) : (
        <div className="space-y-2">
          {bookings.map((b) => {
            const isExpanded = expandedId === b.id;
            const date = new Date(b.start_time);
            const roomLabel = ROOM_LABELS[b.room as keyof typeof ROOM_LABELS] || b.room || '—';

            const hasUnpaidBalance = b.status === 'completed' && b.remainder_amount > 0;

            return (
              <div key={b.id} className={`border-2 transition-colors ${hasUnpaidBalance ? 'border-red-400 bg-red-50/30' : 'border-black/10 hover:border-black/20'}`}>
                {/* Summary Row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : b.id)}
                  className="w-full p-4 text-left flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold">{b.customer_name}</span>
                      {b.band && (
                        // Accent chip — band bookings are flat-rate Studio A sessions,
                        // worth flagging prominently so engineers scanning the list
                        // immediately know this is a band session (different workflow,
                        // different room dynamics) vs. a solo artist.
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-accent text-black">
                          Band · {b.band.display_name}
                        </span>
                      )}
                      <span className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ${STATUS_COLORS[b.status] || 'bg-black/5 text-black/70'}`}>
                        {bookingStatusLabel(b.status)}
                      </span>
                      {hasUnpaidBalance && (
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-red-600 text-white animate-pulse">
                          UNPAID — {formatCents(b.remainder_amount)}
                        </span>
                      )}
                      {b.reschedule_requested && (
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-200 text-amber-800 animate-pulse">
                          Reschedule Requested
                        </span>
                      )}
                      {b.status === 'pending_deposit' && b.deposit_method === 'cash' && (
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-amber-100 text-amber-700">
                          Cash Pending
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-xs text-black/70 mt-1">
                      {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })} · {formatDuration(b.duration)} · {roomLabel}
                      {b.engineer_name && <span className="text-accent"> · {b.engineer_name}</span>}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-mono text-sm font-bold">{formatCents(b.total_amount)}</p>
                    {b.remainder_amount === 0 ? (
                      <p className="font-mono text-[10px] text-green-600 font-bold">Paid in Full</p>
                    ) : b.actual_deposit_paid != null && b.actual_deposit_paid > 0 ? (
                      <p className="font-mono text-[10px] text-green-600">Paid: {formatCents(b.actual_deposit_paid)}</p>
                    ) : null}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-black/30 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-black/10 p-4 space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs">
                      <div>
                        <p className="text-black/60 uppercase tracking-wider">Email</p>
                        <p className="font-semibold">{b.customer_email}</p>
                      </div>
                      <div>
                        <p className="text-black/60 uppercase tracking-wider">Phone</p>
                        <p className="font-semibold">{b.customer_phone || '—'}</p>
                      </div>
                      <div>
                        <p className="text-black/60 uppercase tracking-wider">Room</p>
                        <p className="font-semibold">{roomLabel}</p>
                      </div>
                      <div>
                        <p className="text-black/60 uppercase tracking-wider">Duration</p>
                        <p className="font-semibold">{formatDuration(b.duration)}</p>
                      </div>
                    </div>

                    {/* Move session to another customer account (multi-account fix) */}
                    <div className="pt-1">
                      <ReassignCustomerButton bookingId={b.id} currentEmail={b.customer_email} currentName={b.customer_name} onDone={fetchBookings} />
                    </div>

                    {/* Financial Info */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs">
                      <div>
                        <p className="text-black/60 uppercase tracking-wider">Total</p>
                        <p className="font-semibold">{formatCents(b.total_amount)}</p>
                      </div>
                      <div>
                        <p className="text-black/60 uppercase tracking-wider">Deposit Paid</p>
                        <p className="font-semibold">{formatCents(depositCollectedCents(b))}</p>
                      </div>
                      <div>
                        <p className="text-black/60 uppercase tracking-wider">Remainder</p>
                        {editingRemainder === b.id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-black/60">$</span>
                            <input
                              type="number"
                              step="0.01"
                              value={remainderInput}
                              onChange={(e) => setRemainderInput(e.target.value)}
                              className="w-20 border border-black/20 px-1 py-0.5 text-xs font-mono"
                              autoFocus
                            />
                            <button onClick={() => saveRemainder(b.id)} className="text-green-600 font-bold">✓</button>
                            <button onClick={() => setEditingRemainder(null)} className="text-red-500 font-bold">✕</button>
                          </div>
                        ) : (
                          <p className="font-semibold">
                            {formatCents(b.remainder_amount)}
                            <button
                              onClick={() => { setEditingRemainder(b.id); setRemainderInput((b.remainder_amount / 100).toFixed(2)); }}
                              className="ml-1 text-accent hover:underline text-[10px]"
                            >Edit</button>
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-black/60 uppercase tracking-wider">Surcharges</p>
                        <p className="font-semibold">
                          {b.night_fees_amount > 0 && <span>Night: {formatCents(b.night_fees_amount)}</span>}
                          {b.same_day_fee && <span className="block">Same-day: {formatCents(b.same_day_fee_amount)}</span>}
                          {(b.guest_fee_amount || 0) > 0 && <span className="block">Guests ({b.guest_count || 1} people): {formatCents(b.guest_fee_amount)}</span>}
                          {!b.night_fees_amount && !b.same_day_fee && !(b.guest_fee_amount || 0) && '—'}
                        </p>
                        {/* Edit guests */}
                        {editingGuests === b.id ? (
                          <div className="mt-2 flex items-center gap-2">
                            <select value={guestInput} onChange={(e) => setGuestInput(Number(e.target.value))}
                              className="border border-black/20 px-2 py-1 font-mono text-xs">
                              {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                                <option key={n} value={n}>{n} {n === 1 ? 'person' : 'people'}{n > 2 ? ` (+$${(n - 2) * 10}/hr)` : ''}</option>
                              ))}
                            </select>
                            <button
                              onClick={async () => {
                                const res = await fetch('/api/booking/update-guests', {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ bookingId: b.id, guestCount: guestInput }),
                                });
                                const data = await res.json();
                                if (data.success) {
                                  fetchBookings();
                                  setEditingGuests(null);
                                } else {
                                  alert(data.error || 'Failed to update guests');
                                }
                              }}
                              className="font-mono text-[10px] font-bold bg-accent text-black px-2 py-1"
                            >Save</button>
                            <button onClick={() => setEditingGuests(null)} className="font-mono text-[10px] text-black/60 px-2 py-1">Cancel</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingGuests(b.id); setGuestInput(b.guest_count || 1); }}
                            className="font-mono text-[10px] text-accent hover:underline mt-1"
                          >Edit Guests</button>
                        )}
                      </div>
                    </div>

                    {/* Media Add-ons */}
                    {b.media_addons && b.media_addons.length > 0 && (
                      <div className="font-mono text-xs col-span-2 border-t border-black/5 pt-2 mt-1">
                        <p className="text-black/60 uppercase tracking-wider mb-1">Bundled Media Services</p>
                        {b.media_addons.map((addon, i) => (
                          <div key={i} className="flex justify-between items-center py-0.5">
                            <span>{addon.description || addon.type}{addon.sold_by ? ` · ${addon.sold_by}` : ''}</span>
                            <span className="font-semibold text-purple-700">{formatCents(addon.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Engineer Assignment */}
                    <div className="font-mono text-xs">
                      <p className="text-black/60 uppercase tracking-wider mb-1">Engineer</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          value={b.engineer_name || ''}
                          onChange={(e) => transferEngineer(b.id, e.target.value || null)}
                          disabled={updatingId === b.id}
                          className="border border-black/20 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none"
                        >
                          <option value="">Unclaimed</option>
                          {ENGINEERS.map((eng) => (
                            <option key={eng.name} value={eng.name}>{eng.displayName} ({eng.studios.map(s => ROOM_LABELS[s as keyof typeof ROOM_LABELS]).join(', ')})</option>
                          ))}
                          {b.engineer_name && !ENGINEERS.some(e => e.name === b.engineer_name) && (
                            <option value={b.engineer_name}>{b.engineer_name} (profile name)</option>
                          )}
                        </select>
                        {b.requested_engineer && (
                          <span className="text-black/60">Requested: {b.requested_engineer}</span>
                        )}
                      </div>
                    </div>

                    {/* Reschedule Request Banner */}
                    {b.reschedule_requested && (
                      <div className="border-2 border-amber-400 bg-amber-50 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold uppercase tracking-wider text-amber-700">
                            Reschedule Requested
                          </span>
                          <span className="font-mono text-[10px] text-amber-600">
                            {fmtStampDateTime(b.reschedule_requested_at)}
                          </span>
                        </div>
                        <p className="font-mono text-xs text-amber-800">
                          Reason: {b.reschedule_reason || 'No reason given'}
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditingTime(b.id);
                              const d = new Date(b.start_time);
                              setDateInput(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
                              setTimeInput(`${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`);
                              setDurationInput(b.duration || 2);
                            }}
                            className="bg-amber-500 text-white font-mono text-[10px] font-bold uppercase px-3 py-1.5 hover:bg-amber-600"
                          >
                            Edit Time to Reschedule
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm('Dismiss this reschedule request?')) return;
                              await fetch('/api/admin/bookings/update', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ bookingId: b.id, updates: { reschedule_requested: false, reschedule_reason: null, reschedule_requested_at: null } }),
                              });
                              fetchBookings();
                            }}
                            className="border border-amber-400 text-amber-700 font-mono text-[10px] font-bold uppercase px-3 py-1.5 hover:bg-amber-100"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Reschedule / Edit Time */}
                    <div className="font-mono text-xs">
                      <p className="text-black/60 uppercase tracking-wider mb-1">Session Time</p>
                      {editingTime === b.id ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="date"
                            value={dateInput}
                            onChange={(e) => setDateInput(e.target.value)}
                            className="border border-black/20 px-2 py-1.5 font-mono text-xs"
                          />
                          <input
                            type="time"
                            value={timeInput}
                            onChange={(e) => setTimeInput(e.target.value)}
                            className="border border-black/20 px-2 py-1.5 font-mono text-xs"
                          />
                          {/* Admin duration editor — quarter-hour granularity to match
                              the engineer side. The booking creation flow itself stays on
                              integer hours; this is for post-fact corrections. */}
                          <input
                            type="number"
                            min={0.25}
                            max={24}
                            step={0.25}
                            value={durationInput}
                            onChange={(e) => setDurationInput(Number(e.target.value))}
                            className="border border-black/20 px-2 py-1.5 font-mono text-xs w-24"
                            title="Hours (15-min increments)"
                          />
                          <button
                            onClick={() => saveTimeChange(b.id)}
                            className="bg-accent text-black font-bold text-[10px] uppercase px-2 py-1.5"
                          >Save</button>
                          <button
                            onClick={() => setEditingTime(null)}
                            className="border border-black/20 text-black/60 font-bold text-[10px] uppercase px-2 py-1.5"
                          >Cancel</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">
                            {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}
                          </span>
                          <button
                            onClick={() => {
                              setEditingTime(b.id);
                              // Pre-fill with current values
                              const d = new Date(b.start_time);
                              setDateInput(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
                              setTimeInput(`${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`);
                              setDurationInput(b.duration || 2);
                            }}
                            className="text-accent hover:underline inline-flex items-center gap-0.5"
                          >
                            <Pencil className="w-3 h-3" /> Edit
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Admin Notes */}
                    <div>
                      <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1">Admin Notes</label>
                      <textarea
                        defaultValue={b.admin_notes || ''}
                        onBlur={(e) => updateNotes(b.id, e.target.value)}
                        rows={2}
                        className="w-full border border-black/10 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none resize-vertical"
                        placeholder="Internal notes..."
                      />
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2">
                      {b.status === 'pending' && (
                        // Paid but unclaimed. Confirmation happens ONLY when an engineer
                        // claims it (DB enforces confirmed ⇒ engineer set), so there is no
                        // admin "Confirm" shortcut — show the state instead.
                        <span className="bg-yellow-100 text-yellow-800 font-mono text-[11px] font-bold uppercase px-3 py-2 inline-flex items-center gap-1">
                          ⏳ Awaiting engineer claim
                        </span>
                      )}
                      {b.status === 'confirmed' && (
                        <button onClick={() => updateStatus(b.id, 'completed')} disabled={updatingId === b.id}
                          className="bg-accent text-black font-mono text-xs font-bold uppercase px-3 py-2 hover:bg-accent/80 disabled:opacity-50 inline-flex items-center gap-1">
                          <Check className="w-3 h-3" /> Complete
                        </button>
                      )}
                      {!['cancelled', 'completed', 'rejected'].includes(b.status) && (
                        <button onClick={() => updateStatus(b.id, 'cancelled')} disabled={updatingId === b.id}
                          className="border border-red-300 text-red-600 font-mono text-xs font-bold uppercase px-3 py-2 hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1">
                          <X className="w-3 h-3" /> Cancel
                        </button>
                      )}
                      {b.remainder_amount > 0 && b.stripe_customer_id && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => chargeRemainder(b.id, editingCharge === b.id ? Math.round(parseFloat(chargeInput) * 100) : b.remainder_amount)}
                            disabled={updatingId === b.id}
                            className="border border-green-600 text-green-700 font-mono text-xs font-bold uppercase px-3 py-2 hover:bg-green-50 disabled:opacity-50 inline-flex items-center gap-1">
                            <DollarSign className="w-3 h-3" /> Charge {editingCharge === b.id ? `$${chargeInput}` : formatCents(b.remainder_amount)}
                          </button>
                          {editingCharge === b.id ? (
                            <div className="flex items-center gap-1">
                              <span className="font-mono text-xs">$</span>
                              <input
                                type="number"
                                step="0.01"
                                value={chargeInput}
                                onChange={(e) => setChargeInput(e.target.value)}
                                className="w-20 border border-black/20 px-1 py-0.5 text-xs font-mono"
                                autoFocus
                              />
                              <button onClick={() => setEditingCharge(null)} className="text-black/60 font-mono text-[10px]">Done</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setEditingCharge(b.id); setChargeInput((b.remainder_amount / 100).toFixed(2)); }}
                              className="font-mono text-[10px] text-accent hover:underline"
                            >Edit</button>
                          )}
                        </div>
                      )}
                      {b.remainder_amount > 0 && (
                        <button
                          onClick={() => { setShowCashPayment(showCashPayment === b.id ? null : b.id); setShowPaymentLink(null); setCashAmount((b.remainder_amount / 100).toFixed(2)); setCashNote(''); }}
                          disabled={updatingId === b.id}
                          title="Records cash received toward the outstanding balance. Does NOT change the session total."
                          className="border border-black/30 text-black/70 font-mono text-xs font-bold uppercase px-3 py-2 hover:bg-black/5 disabled:opacity-50 inline-flex items-center gap-1">
                          <Banknote className="w-3 h-3" /> Record Cash <span className="text-[9px] text-black/50 normal-case font-normal">(pays remainder)</span>
                        </button>
                      )}
                      {b.remainder_amount > 0 && (
                        <button
                          onClick={() => {
                            if (!confirm(`Record ${formatCents(b.remainder_amount)} as paid via Stripe?`)) return;
                            recordStripePaid(b.id);
                          }}
                          disabled={updatingId === b.id}
                          className="border border-blue-400 text-blue-600 font-mono text-xs font-bold uppercase px-3 py-2 hover:bg-blue-50 disabled:opacity-50 inline-flex items-center gap-1">
                          <CreditCard className="w-3 h-3" /> Record Stripe
                        </button>
                      )}
                      {b.remainder_amount > 0 && b.customer_email && (
                        <button
                          onClick={() => { setShowPaymentLink(showPaymentLink === b.id ? null : b.id); setShowCashPayment(null); setPaymentLinkAmount((b.remainder_amount / 100).toFixed(2)); }}
                          disabled={updatingId === b.id}
                          className="border border-blue-400 text-blue-600 font-mono text-xs font-bold uppercase px-3 py-2 hover:bg-blue-50 disabled:opacity-50 inline-flex items-center gap-1">
                          <Send className="w-3 h-3" /> Send Payment Link
                        </button>
                      )}
                      {paymentLinkSent === b.id && (
                        <span className="font-mono text-xs text-green-600 font-bold inline-flex items-center gap-1">
                          <Check className="w-3 h-3" /> Link Sent!
                        </span>
                      )}
                      {b.remainder_amount > 0 && (
                        <button
                          onClick={() => markPaidInFull(b.id)}
                          disabled={updatingId === b.id}
                          className="bg-green-600 text-white font-mono text-xs font-bold uppercase px-3 py-2 hover:bg-green-700 disabled:opacity-50 inline-flex items-center gap-1">
                          <Check className="w-3 h-3" /> Mark Paid in Full
                        </button>
                      )}
                      {b.remainder_amount === 0 && (
                        <span className="font-mono text-xs text-green-600 font-bold uppercase px-3 py-2 inline-flex items-center gap-1">
                          <Check className="w-3 h-3" /> Paid in Full
                        </span>
                      )}
                      {/* Extend Session — RAISES total_amount. Visually distinct (orange) to prevent confusion with "Record Cash" which only pays down remainder. */}
                      <button
                        onClick={() => { setShowCashPayment(showCashPayment === `add-${b.id}` ? null : `add-${b.id}`); setShowPaymentLink(null); setCashAmount(''); setCashNote(''); }}
                        title="Use when client added time/services DURING the session. Increases the session total AND records the cash received for that extra time."
                        className="border-2 border-orange-500 text-orange-700 bg-orange-50 font-mono text-xs font-bold uppercase px-3 py-2 hover:bg-orange-100 inline-flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Extend Session +$ <span className="text-[9px] text-orange-600/80 normal-case font-normal">(raises total)</span>
                      </button>
                    </div>

                    {/* Extend Session Form — increases total_amount by the entered amount AND records cash received.
                         Visually distinct from "Record Cash" to prevent the duplicate-cash bug (Bloodika 2026-04-20). */}
                    {showCashPayment === `add-${b.id}` && (() => {
                      const amt = parseFloat(cashAmount) || 0;
                      const amtCents = Math.round(amt * 100);
                      const newTotal = (b.total_amount || 0) + amtCents;
                      return (
                      <div className="border-2 border-orange-500 bg-orange-50 p-3 space-y-2">
                        <p className="font-mono text-[10px] text-orange-700 uppercase tracking-wider font-bold">⚠ Extend Session — raises the charged total</p>
                        <p className="font-mono text-[11px] text-orange-900 leading-snug">
                          Use this ONLY if the client added time or services <em>during</em> the session.
                          This will <b>increase the session total by $X</b> AND record $X cash received.
                          If you&apos;re just recording cash toward the existing balance, use <b>Record Cash</b> instead.
                        </p>
                        <div className="flex gap-2 items-end">
                          <div className="relative flex-1">
                            <label className="font-mono text-[9px] text-orange-700 uppercase tracking-wider">Amount client paid for the extension</label>
                            <div className="relative">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-sm text-black/60">$</span>
                              <input type="text" inputMode="decimal" value={cashAmount} onChange={e => setCashAmount(e.target.value)}
                                className="w-full border border-orange-400 pl-6 pr-3 py-1.5 font-mono text-sm focus:border-orange-600 focus:outline-none"
                                placeholder="0.00" />
                            </div>
                          </div>
                        </div>
                        {amt > 0 && (
                          <div className="border border-orange-300 bg-white p-2 font-mono text-[11px] space-y-0.5">
                            <div className="flex justify-between"><span className="text-black/60">Session total before:</span><span>{formatCents(b.total_amount)}</span></div>
                            <div className="flex justify-between text-orange-700"><span>+ Extension:</span><span>+${amt.toFixed(2)}</span></div>
                            <div className="flex justify-between font-bold border-t border-orange-200 pt-0.5"><span>Session total after:</span><span>{formatCents(newTotal)}</span></div>
                            <div className="flex justify-between text-green-700 pt-1"><span>Cash received (added to ledger):</span><span>${amt.toFixed(2)}</span></div>
                          </div>
                        )}
                        <input type="text" value={cashNote}
                          onChange={e => setCashNote(e.target.value)}
                          className="w-full border border-orange-300 px-3 py-1.5 font-mono text-xs focus:border-orange-600 focus:outline-none"
                          placeholder="Note (e.g., 'Added 1 hour at $50')" />
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              if (!amt || amt <= 0) { alert('Enter a valid amount'); return; }
                              if (!confirm(`Extend this session?\n\nSession total: ${formatCents(b.total_amount)} → ${formatCents(newTotal)}\nCash received: $${amt.toFixed(2)}\n\nProceed?`)) return;
                              setUpdatingId(b.id);
                              const note = cashNote || `Extended session by $${amt.toFixed(2)}`;
                              // Single API call: increases total AND records cash in one atomic operation
                              await fetch('/api/booking/record-payment', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ bookingId: b.id, amount: amt, method: 'cash', note, addToTotal: true }),
                              });
                              setShowCashPayment(null);
                              setCashAmount('');
                              setCashNote('');
                              setUpdatingId(null);
                              fetchBookings();
                            }}
                            disabled={updatingId === b.id || !amt}
                            className="bg-orange-600 text-white font-mono text-xs font-bold uppercase px-4 py-2 hover:bg-orange-700 disabled:opacity-50">
                            {updatingId === b.id ? 'Extending...' : 'Extend Session'}
                          </button>
                          <button
                            onClick={() => { setShowCashPayment(null); setCashAmount(''); setCashNote(''); }}
                            className="font-mono text-xs text-black/60 hover:text-black px-3 py-2">
                            Cancel
                          </button>
                        </div>
                      </div>
                      );
                    })()}

                    {/* Cancelled — Record Kept Deposit */}
                    {b.status === 'cancelled' && (
                      <div className="border border-red-200 bg-red-50/50 p-3 space-y-2">
                        <p className="font-mono text-[10px] text-red-600 uppercase tracking-wider font-bold">Cancelled Session — Deposit Tracking</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 font-mono text-xs">
                          <div>
                            <p className="text-black/60">Original Total</p>
                            <p className="font-semibold">{formatCents(b.total_amount)}</p>
                          </div>
                          <div>
                            <p className="text-black/60">Deposit on Card</p>
                            <p className="font-semibold">{b.actual_deposit_paid ? formatCents(b.actual_deposit_paid) : '$0.00'}</p>
                          </div>
                          <div>
                            <p className="text-black/60">Deposit Kept</p>
                            {editingRemainder === `kept-${b.id}` ? (
                              <div className="flex items-center gap-1">
                                <span className="font-mono text-xs">$</span>
                                <input type="text" inputMode="decimal" value={remainderInput}
                                  onChange={e => setRemainderInput(e.target.value)}
                                  className="w-20 border border-black/20 px-2 py-1 font-mono text-xs"
                                  onKeyDown={e => { if (e.key === 'Enter') saveKeptDeposit(b.id); }} />
                                <button onClick={() => saveKeptDeposit(b.id)} className="text-[10px] text-green-600 font-bold">Save</button>
                                <button onClick={() => setEditingRemainder(null)} className="text-[10px] text-black/60">Cancel</button>
                              </div>
                            ) : (
                              <>
                                <p className="font-semibold text-red-600">{formatCents(b.actual_deposit_paid || 0)}</p>
                                <button
                                  onClick={() => { setEditingRemainder(`kept-${b.id}`); setRemainderInput(((b.actual_deposit_paid || 0) / 100).toFixed(2)); }}
                                  className="text-[10px] text-accent hover:underline"
                                >Edit kept amount</button>
                              </>
                            )}
                          </div>
                        </div>
                        {!b.actual_deposit_paid && (b.deposit_amount === 0 || b.deposit_method === 'cash') && (
                          <div className="flex items-center gap-2 flex-wrap mt-1">
                            <p className="font-mono text-[10px] text-black/60">Record cash deposit kept:</p>
                            <div className="flex items-center gap-1">
                              <span className="font-mono text-xs">$</span>
                              <input
                                type="number"
                                step="0.01"
                                value={cashAmount}
                                onChange={(e) => setCashAmount(e.target.value)}
                                className="w-24 border border-black/20 px-2 py-1.5 font-mono text-xs"
                                placeholder="Amount"
                              />
                            </div>
                            <button
                              onClick={async () => {
                                const amt = Math.round(parseFloat(cashAmount) * 100);
                                if (!amt || amt <= 0) return;
                                await fetch('/api/booking/record-payment', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ bookingId: b.id, amount: parseFloat(cashAmount), method: 'cash', note: 'Kept deposit from cancelled session' }),
                                });
                                updateBooking(b.id, { deposit_amount: amt, actual_deposit_paid: amt });
                                setCashAmount('');
                              }}
                              className="bg-black text-white font-mono text-[10px] font-bold uppercase px-3 py-1.5"
                            >Save</button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Record Cash Payment Form */}
                    {showCashPayment === b.id && (
                      <div className="border border-black/10 p-3 space-y-2">
                        <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Record Cash Payment</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-sm">$</span>
                            <input
                              type="number"
                              step="0.01"
                              value={cashAmount}
                              onChange={(e) => setCashAmount(e.target.value)}
                              className="w-24 border border-black/20 px-2 py-1.5 font-mono text-xs"
                              placeholder="Amount"
                            />
                          </div>
                          <input
                            type="text"
                            value={cashNote}
                            onChange={(e) => setCashNote(e.target.value)}
                            className="flex-1 min-w-[120px] border border-black/20 px-2 py-1.5 font-mono text-xs"
                            placeholder="Note (optional)"
                          />
                          <button
                            onClick={() => recordCashPayment(b.id)}
                            disabled={updatingId === b.id}
                            className="bg-black text-white font-mono text-[10px] font-bold uppercase px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1"
                          ><Banknote className="w-3 h-3" /> Record</button>
                          <button
                            onClick={() => setShowCashPayment(null)}
                            className="border border-black/20 font-mono text-[10px] text-black/60 uppercase px-3 py-1.5"
                          >Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* Send Payment Link Form */}
                    {showPaymentLink === b.id && (
                      <div className="border border-blue-200 bg-blue-50/30 p-3 space-y-2">
                        <p className="font-mono text-[10px] text-blue-600 uppercase tracking-wider font-bold">Send Stripe Payment Link</p>
                        <p className="font-mono text-[10px] text-black/70">Creates a Stripe checkout link and emails it to {b.customer_email}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-sm">$</span>
                            <input
                              type="number"
                              step="0.01"
                              value={paymentLinkAmount}
                              onChange={(e) => setPaymentLinkAmount(e.target.value)}
                              className="w-24 border border-blue-300 px-2 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none"
                              placeholder="Amount"
                            />
                          </div>
                          <button
                            onClick={() => sendPaymentLink(b.id)}
                            disabled={updatingId === b.id}
                            className="bg-blue-600 text-white font-mono text-[10px] font-bold uppercase px-4 py-1.5 hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
                          ><Send className="w-3 h-3" /> Send Link</button>
                          <button
                            onClick={() => setShowPaymentLink(null)}
                            className="border border-black/20 font-mono text-[10px] text-black/60 uppercase px-3 py-1.5"
                          >Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* File Upload */}
                    <div className="flex flex-wrap gap-2 items-center">
                      {hasUnpaidBalance && (
                        <span className="font-mono text-[10px] text-red-600 font-bold uppercase px-3 py-2 border border-red-300 bg-red-50 inline-flex items-center gap-1">
                          Payment required before file delivery
                        </span>
                      )}
                      <button
                        onClick={() => { if (hasUnpaidBalance) return; setShowFileUpload(showFileUpload === b.id ? null : b.id); setUploadFiles([]); setUploadSuccess(null); }}
                        disabled={hasUnpaidBalance}
                        className={`border font-mono text-[10px] font-bold uppercase px-3 py-2 inline-flex items-center gap-1 ${hasUnpaidBalance ? 'border-black/10 text-black/20 cursor-not-allowed' : 'border-black/20 text-black/60 hover:bg-black/5'}`}
                      >
                        <Upload className="w-3 h-3" /> Upload Files
                      </button>
                      {uploadSuccess === b.id && (
                        <span className="font-mono text-xs text-green-600 font-bold inline-flex items-center gap-1">
                          <Check className="w-3 h-3" /> Files Delivered!
                        </span>
                      )}
                    </div>
                    {showFileUpload === b.id && (
                      <div className="border border-black/10 p-3 space-y-3">
                        <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider font-bold">Upload Session Files for {b.customer_name}</p>
                        {b.customer_email ? (
                          <>
                            <div
                              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                              onDragLeave={() => setIsDragging(false)}
                              onDrop={(e) => {
                                e.preventDefault();
                                setIsDragging(false);
                                const files = Array.from(e.dataTransfer.files);
                                setUploadFiles(prev => [...prev, ...files]);
                              }}
                              className={`border-2 border-dashed p-4 text-center cursor-pointer transition-colors ${isDragging ? 'border-accent bg-accent/5' : 'border-black/15 hover:border-accent/50'}`}
                              onClick={() => {
                                const input = document.createElement('input');
                                input.type = 'file';
                                input.multiple = true;
                                input.onchange = () => {
                                  if (input.files) setUploadFiles(prev => [...prev, ...Array.from(input.files!)]);
                                };
                                input.click();
                              }}
                            >
                              <p className="font-mono text-xs text-black/70">
                                {isDragging ? 'Drop files here' : 'Click or drag files to upload'}
                              </p>
                            </div>
                            {uploadFiles.length > 0 && (
                              <div className="space-y-1">
                                {uploadFiles.map((file, idx) => (
                                  <div key={idx} className="flex items-center justify-between bg-black/[0.02] px-2 py-1 font-mono text-xs">
                                    <span className="truncate">{file.name}</span>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="text-black/40">{(file.size / 1024 / 1024).toFixed(1)}MB</span>
                                      <button onClick={() => setUploadFiles(prev => prev.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-700">
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {uploadProgress && (
                              <p className="font-mono text-[10px] text-accent">{uploadProgress}</p>
                            )}
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleFileUpload(b)}
                                disabled={uploading || uploadFiles.length === 0}
                                className="bg-black text-white font-mono text-[10px] font-bold uppercase px-4 py-2 hover:bg-black/80 disabled:opacity-50 inline-flex items-center gap-1"
                              >
                                <Upload className="w-3 h-3" /> {uploading ? 'Uploading...' : `Upload ${uploadFiles.length} File${uploadFiles.length !== 1 ? 's' : ''} & Notify`}
                              </button>
                              <button
                                onClick={() => { setShowFileUpload(null); setUploadFiles([]); }}
                                className="border border-black/20 font-mono text-[10px] text-black/60 uppercase px-3 py-2"
                              >Cancel</button>
                            </div>
                          </>
                        ) : (
                          <p className="font-mono text-xs text-red-500">No customer email on this booking — cannot upload files.</p>
                        )}
                      </div>
                    )}

                    {/* View Delivered Files */}
                    <div className="flex flex-wrap gap-2 items-center">
                      <button
                        onClick={() => {
                          if (showFiles === b.id) { setShowFiles(null); return; }
                          setShowFiles(b.id);
                          if (b.customer_email) fetchBookingFiles(b.customer_email);
                        }}
                        className="border border-black/20 text-black/60 font-mono text-[10px] font-bold uppercase px-3 py-2 hover:bg-black/5 inline-flex items-center gap-1"
                      >
                        <FileAudio className="w-3 h-3" /> {showFiles === b.id ? 'Hide' : 'View'} Files
                      </button>
                    </div>
                    {showFiles === b.id && (
                      <div className="border border-black/10 p-3 space-y-2">
                        <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider font-bold">Delivered Files for {b.customer_name}</p>
                        {loadingFiles ? (
                          <p className="font-mono text-xs text-black/40">Loading...</p>
                        ) : bookingFiles.length === 0 ? (
                          <p className="font-mono text-xs text-black/60">No files delivered yet</p>
                        ) : (
                          <div className="space-y-1">
                            {bookingFiles.map(f => (
                              <div key={f.id} className="flex items-center justify-between bg-black/[0.02] px-2 py-1.5 font-mono text-xs hover:bg-black/[0.04]">
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileAudio className="w-3 h-3 text-black/30 flex-shrink-0" />
                                  <span className="truncate font-semibold">{f.display_name || f.file_name}</span>
                                  <span className="text-black/30 flex-shrink-0">{(f.file_size / 1024 / 1024).toFixed(1)}MB</span>
                                  {f.uploaded_by_name && <span className="text-black/30 flex-shrink-0">by {f.uploaded_by_name}</span>}
                                </div>
                                <button
                                  onClick={() => downloadFile(f.id, f.file_name)}
                                  className="text-accent hover:text-accent/80 flex-shrink-0 ml-2 inline-flex items-center gap-1"
                                >
                                  <Download className="w-3 h-3" /> Download
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Email Actions */}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => renotify(b.id, 'confirmation')}
                        disabled={updatingId === b.id}
                        className="border border-black/20 text-black/60 font-mono text-[10px] font-bold uppercase px-3 py-2 hover:bg-black/5 disabled:opacity-50 inline-flex items-center gap-1">
                        <Mail className="w-3 h-3" /> Resend Confirmation
                      </button>
                      {!b.engineer_name && (
                        <button
                          onClick={() => renotify(b.id, 'engineer_alert')}
                          disabled={updatingId === b.id}
                          className="border border-black/20 text-black/60 font-mono text-[10px] font-bold uppercase px-3 py-2 hover:bg-black/5 disabled:opacity-50 inline-flex items-center gap-1">
                          <Mail className="w-3 h-3" /> Re-alert Engineers
                        </button>
                      )}
                      {/* Correct Cash — only for cash bookings (no Stripe
                          payment intent OR session). Stripe-paid sessions
                          must use the Stripe refund flow, not this. */}
                      {!b.stripe_payment_intent_id && !b.stripe_checkout_session_id && (
                        <button
                          onClick={() => setCashCorrection({
                            id: b.id,
                            customer_name: b.customer_name,
                            total_amount: b.total_amount,
                          })}
                          className="border border-black/20 text-black/60 font-mono text-[10px] font-bold uppercase px-3 py-2 hover:bg-black/5 inline-flex items-center gap-1"
                          title="Correct the cash collected amount (logged to audit)"
                        >
                          <Edit3 className="w-3 h-3" /> Correct Cash
                        </button>
                      )}
                    </div>

                    {/* Debug Toggle */}
                    <div>
                      <button
                        onClick={() => setShowDebug(showDebug === b.id ? null : b.id)}
                        className="font-mono text-[10px] text-black/30 hover:text-black/60 uppercase tracking-wider"
                      >
                        {showDebug === b.id ? 'Hide' : 'Show'} Debug Info
                      </button>
                      {showDebug === b.id && (
                        <div className="mt-2 bg-black/[0.02] border border-black/5 p-3 font-mono text-[10px] text-black/50 space-y-1">
                          <p>ID: {b.id}</p>
                          <p>Status: {b.status}</p>
                          <p>Created: {new Date(b.created_at).toLocaleString('en-US', { timeZone: 'UTC' })}</p>
                          <p>Start: {b.start_time}</p>
                          <p>End: {b.end_time}</p>
                          <p>Room: {b.room || '—'}</p>
                          <p>Engineer: {b.engineer_name || '—'}</p>
                          <p>Requested: {b.requested_engineer || '—'}</p>
                          {b.claimed_at && <p>Claimed: {new Date(b.claimed_at).toLocaleString('en-US', { timeZone: 'UTC' })}</p>}
                          <p>Total: {formatCents(b.total_amount)} · Deposit: {formatCents(b.deposit_amount)} · Remainder: {formatCents(b.remainder_amount)}</p>
                          <p>Deposit Paid: {formatCents(b.actual_deposit_paid || 0)}</p>
                          <p>Stripe Customer: {b.stripe_customer_id || '—'}</p>
                          <p>Stripe PI: {b.stripe_payment_intent_id || '—'}</p>
                          {b.stripe_checkout_session_id && <p>Stripe Session: {b.stripe_checkout_session_id}</p>}
                          <p>Night Fees: {formatCents(b.night_fees_amount || 0)}</p>
                          <p>Same Day: {b.same_day_fee ? `Yes (${formatCents(b.same_day_fee_amount || 0)})` : 'No'}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Cash correction modal — admin-side */}
      {cashCorrection && (
        <CashCorrectionModal
          bookingId={cashCorrection.id}
          customerName={cashCorrection.customer_name}
          currentTotalCents={cashCorrection.total_amount}
          onClose={() => setCashCorrection(null)}
          onSaved={() => {
            setCashCorrection(null);
            // Refresh the bookings list so the corrected total renders.
            fetchBookings();
          }}
        />
      )}
    </div>
  );
}

function CalendarIcon(props: React.SVGProps<SVGSVGElement> & { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>
    </svg>
  );
}
