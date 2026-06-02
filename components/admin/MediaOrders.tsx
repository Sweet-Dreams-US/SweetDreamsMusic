'use client';

// components/admin/MediaOrders.tsx
//
// Admin operations on the Media Hub. Three things on one screen:
//   1. List of media_bookings with status + buyer + offering + sessions count
//   2. Inline "edit" panel for each booking — change status, paste
//      deliverables JSON, see all sessions
//   3. Per-session "mark complete + payout" action (admin sets dollar
//      amount; the system snapshots split_breakdown if provided)
//
// Why one consolidated panel instead of separate routes per booking: most
// admin work on a media order is "look at the order, mark a session done,
// paste a deliverable URL, move on." A nested-route flow would force
// 3 page loads per touch. Inline edits keep the operator moving.
//
// We refetch the whole list after any mutation. With 200-row cap and one
// admin doing ops, this is fine — no need for optimistic updates yet.

import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Save,
  CheckCircle2,
  Clock,
  Plus,
  Trash2,
  Link as LinkIcon,
  AlertCircle,
  CreditCard,
  Banknote,
  DollarSign,
  PackageCheck,
  Phone,
  TestTube2,
  History,
  Send,
} from 'lucide-react';
import { formatCents } from '@/lib/utils';
import { fmtStampDate, fmtStampDateTime, fmtStampTime } from '@/lib/studio-time';
import MessageThread from '@/components/media/MessageThread';
import PackageBuilder from '@/components/media/PackageBuilder';
import {
  type MediaSessionBooking,
  type MediaSessionKind,
  SESSION_KIND_LABELS,
} from '@/lib/media-scheduling';

// Per-slot completion record we read from media_bookings.component_status.
// Matches the shape the component-complete API writes.
interface SlotStatus {
  completed?: boolean;
  completed_at?: string | null;
  completed_by?: string | null;
  drive_url?: string | null;
  notified_at?: string | null;
}

interface BookingRow {
  id: string;
  offering_id: string;
  user_id: string;
  band_id: string | null;
  status: string;
  configured_components: unknown | null;
  project_details: unknown | null;
  final_price_cents: number;
  deposit_cents: number | null;
  actual_deposit_paid: number | null;
  final_paid_at: string | null;
  deposit_paid_at: string | null;
  stripe_payment_intent_id: string | null;
  stripe_session_id: string | null;
  deliverables: { items?: DeliverableItem[] } | null;
  component_status: Record<string, SlotStatus> | null;
  notes_to_us: string | null;
  customer_phone: string | null;
  is_test: boolean | null;
  created_by: string | null;
  created_at: string;
  updated_at?: string;
}

interface OfferingRow {
  id: string;
  title: string;
  slug: string;
  components: {
    slots?: Array<{ key: string; label: string; kind?: string }>;
  } | null;
}

interface ProfileRow {
  user_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
}

interface BandRow {
  id: string;
  display_name: string;
}

interface DeliverableItem {
  label: string;
  url: string;
  kind?: 'video' | 'image' | 'audio' | 'file' | 'link';
  added_at?: string;
}

const STATUS_OPTIONS = [
  'inquiry',
  'deposited',
  'scheduled',
  'in_production',
  'delivered',
  'cancelled',
];

export default function MediaOrders() {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [offerings, setOfferings] = useState<OfferingRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [bands, setBands] = useState<BandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showManualModal, setShowManualModal] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/media/bookings', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        setBookings(data.bookings || []);
        setOfferings(data.offerings || []);
        setProfiles(data.profiles || []);
        setBands(data.bands || []);
      }
    } catch (e) {
      console.error('[admin-media-orders] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const offeringMap = new Map(offerings.map((o) => [o.id, o]));
  const profileMap = new Map(profiles.map((p) => [p.user_id, p]));
  const bandMap = new Map(bands.map((b) => [b.id, b]));

  const filtered =
    filterStatus === 'all'
      ? bookings
      : bookings.filter((b) => b.status === filterStatus);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold mb-1">Media Orders</h2>
          <p className="font-mono text-xs text-black/50">
            Sessions, deliverables, and order-level admin. Edits land instantly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowManualModal(true)}
            className="font-mono text-xs uppercase tracking-wider px-3 py-2 bg-black text-white hover:bg-accent hover:text-black inline-flex items-center gap-1.5"
            title="Create a media booking manually (cash collected, or send a payment link)"
          >
            <Plus className="w-3 h-3" />
            New booking
          </button>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="font-mono text-xs uppercase tracking-wider px-3 py-2 border border-black/15 bg-white"
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {showManualModal && (
        <ManualBookingModal
          onClose={() => setShowManualModal(false)}
          onSuccess={() => {
            setShowManualModal(false);
            refresh();
          }}
        />
      )}

      {loading ? (
        <p className="font-mono text-sm text-black/50">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="font-mono text-sm text-black/50">
          No media orders match this filter.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((b) => {
            const offering = offeringMap.get(b.offering_id);
            const buyer = profileMap.get(b.user_id);
            const buyerName =
              buyer?.display_name || buyer?.email || 'Unknown buyer';
            const bandName = b.band_id ? bandMap.get(b.band_id)?.display_name : null;
            const isExpanded = expandedId === b.id;

            return (
              <li key={b.id} className="border-2 border-black/10">
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : b.id)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-black/[0.02] text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-black/40 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-black/40 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-bold truncate">
                        {offering?.title || 'Unknown offering'}{' '}
                        <span className="font-mono text-xs text-black/50">
                          · {buyerName}
                          {bandName && <> for {bandName}</>}
                        </span>
                      </p>
                      <p className="font-mono text-[11px] text-black/50">
                        {fmtStampDate(b.created_at, { year: 'numeric' })}
                        {' · '}
                        {b.final_price_cents > 0
                          ? formatCents(b.final_price_cents)
                          : 'Inquiry'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {b.is_test && (
                      <span
                        className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-purple-100 text-purple-900 inline-flex items-center gap-1"
                        title="Test booking — no Stripe charge ran"
                      >
                        <TestTube2 className="w-3 h-3" />
                        test
                      </span>
                    )}
                    <span
                      className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 ${
                        statusBadgeCls(b.status)
                      }`}
                    >
                      {b.status}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <BookingPanel
                    booking={b}
                    offering={offering}
                    buyer={buyer}
                    onChange={refresh}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function statusBadgeCls(status: string): string {
  switch (status) {
    case 'delivered':
      return 'bg-green-100 text-green-900';
    case 'in_production':
      return 'bg-purple-100 text-purple-900';
    case 'scheduled':
      return 'bg-blue-100 text-blue-900';
    case 'deposited':
      return 'bg-accent/20 text-black';
    case 'inquiry':
      return 'bg-black/10 text-black/70';
    case 'cancelled':
      return 'bg-red-100 text-red-900';
    default:
      return 'bg-black/10 text-black/70';
  }
}

// ============================================================
// Per-booking panel — sessions list + deliverables editor + status switch
// ============================================================

function BookingPanel({
  booking,
  offering,
  buyer,
  onChange,
}: {
  booking: BookingRow;
  offering: OfferingRow | undefined;
  buyer: ProfileRow | undefined;
  onChange: () => void;
}) {
  const [sessions, setSessions] = useState<MediaSessionBooking[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [status, setStatus] = useState(booking.status);
  const [savingStatus, setSavingStatus] = useState(false);
  const [deliverables, setDeliverables] = useState<DeliverableItem[]>(
    booking.deliverables?.items ?? [],
  );
  const [savingDeliverables, setSavingDeliverables] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New deliverable form state
  const [newLabel, setNewLabel] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newKind, setNewKind] = useState<DeliverableItem['kind']>('video');

  // Modals: only one open at a time. Set the active modal by key.
  const [activeModal, setActiveModal] = useState<
    | null
    | 'chargeRemainder'
    | 'recordPayment'
    | 'adjustPrice'
    | 'resendLink'
    | 'addItem'
    | 'cancelOrder'
  >(null);

  async function loadSessions() {
    setLoadingSessions(true);
    try {
      const res = await fetch(
        `/api/media/sessions?parent_booking_id=${booking.id}`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (res.ok) setSessions(data.sessions || []);
    } catch (e) {
      console.error('[admin-media-orders] sessions fetch error:', e);
    } finally {
      setLoadingSessions(false);
    }
  }

  useEffect(() => {
    // Inline the fetch so the effect's only dependency is booking.id —
    // loadSessions captured via closure would invalidate the dep array
    // unnecessarily. We re-sync local state if the parent refresh swapped
    // in a different booking row (status / deliverables) at the same id.
    let cancelled = false;
    (async () => {
      setLoadingSessions(true);
      try {
        const res = await fetch(
          `/api/media/sessions?parent_booking_id=${booking.id}`,
          { cache: 'no-store' },
        );
        const data = await res.json();
        if (!cancelled && res.ok) setSessions(data.sessions || []);
      } catch (e) {
        console.error('[admin-media-orders] sessions fetch error:', e);
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    })();
    setStatus(booking.status);
    setDeliverables(booking.deliverables?.items ?? []);
    return () => {
      cancelled = true;
    };
  }, [booking.id, booking.status, booking.deliverables]);

  async function saveStatus() {
    if (status === booking.status) return;
    setSavingStatus(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/media/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Could not save status');
      } else {
        onChange();
      }
    } catch (e) {
      console.error('[admin-media-orders] save status error:', e);
      setError('Network error');
    } finally {
      setSavingStatus(false);
    }
  }

  async function saveDeliverables(next: DeliverableItem[]) {
    setSavingDeliverables(true);
    setError(null);
    try {
      const payload = next.length === 0 ? null : { items: next };
      const res = await fetch(`/api/admin/media/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverables: payload }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Could not save deliverables');
        return;
      }
      setDeliverables(next);
      onChange();
    } catch (e) {
      console.error('[admin-media-orders] deliverables save error:', e);
      setError('Network error');
    } finally {
      setSavingDeliverables(false);
    }
  }

  function addDeliverable() {
    if (!newLabel.trim() || !newUrl.trim()) {
      setError('Deliverable needs a label and URL.');
      return;
    }
    const next = [
      ...deliverables,
      {
        label: newLabel.trim(),
        url: newUrl.trim(),
        kind: newKind,
        added_at: new Date().toISOString(),
      },
    ];
    setNewLabel('');
    setNewUrl('');
    saveDeliverables(next);
  }

  function removeDeliverable(idx: number) {
    const next = deliverables.filter((_, i) => i !== idx);
    saveDeliverables(next);
  }

  // Money math — derive the same way the buyer-facing page does so the two
  // views can never drift. `actual_deposit_paid` is the authoritative
  // "money received" figure; `deposit_cents` is the original target amount
  // (before admin record-payment / charge-remainder mutations land).
  const total = booking.final_price_cents ?? 0;
  const paid = booking.actual_deposit_paid ?? 0;
  const remainder = Math.max(0, total - paid);
  const fullyPaid = !!booking.final_paid_at || (total > 0 && remainder === 0);

  // Fast contact line for admin in case they need to call/text the buyer.
  const buyerEmail = buyer?.email ?? null;
  const buyerPhone = booking.customer_phone || buyer?.phone || null;

  // Component slots come from the offering schema; per-slot completion
  // is stored as JSONB on the booking. Merge them at render time so the
  // UI always reflects the latest API shape — no derived state.
  const slots = offering?.components?.slots ?? [];
  const slotStatusMap = (booking.component_status ?? {}) as Record<string, SlotStatus>;

  return (
    <div className="border-t border-black/10 p-5 bg-black/[0.02] space-y-5">
      {/* Header: buyer contact + payment summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">Buyer</p>
          <p className="text-sm font-bold">{buyer?.display_name || '—'}</p>
          {buyerEmail && (
            <a href={`mailto:${buyerEmail}`} className="block font-mono text-[11px] text-black/60 hover:text-accent truncate">
              {buyerEmail}
            </a>
          )}
          {buyerPhone && (
            <a href={`tel:${buyerPhone}`} className="block font-mono text-[11px] text-black/60 hover:text-accent inline-flex items-center gap-1">
              <Phone className="w-3 h-3" />
              {buyerPhone}
            </a>
          )}
          {booking.created_by && (
            <p className="font-mono text-[10px] text-black/40 mt-1">created by {booking.created_by}</p>
          )}
        </div>
        <div className="md:col-span-2 grid grid-cols-3 gap-3">
          <div className="bg-white border border-black/10 p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">Total</p>
            <p className="text-lg font-bold tabular-nums">{formatCents(total)}</p>
          </div>
          <div className="bg-white border border-black/10 p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">Paid</p>
            <p className="text-lg font-bold tabular-nums text-green-700">{formatCents(paid)}</p>
            {booking.deposit_paid_at && (
              <p className="font-mono text-[9px] text-black/40">
                deposit {fmtStampDate(booking.deposit_paid_at)}
              </p>
            )}
          </div>
          <div className={`border p-3 ${remainder > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">Owed</p>
            <p className={`text-lg font-bold tabular-nums ${remainder > 0 ? 'text-amber-900' : 'text-green-700'}`}>
              {formatCents(remainder)}
            </p>
            {fullyPaid && (
              <p className="font-mono text-[9px] text-green-700 uppercase tracking-wider">paid in full</p>
            )}
          </div>
        </div>
      </div>

      {/* Action row: charge / resend / record / adjust / add-item / cancel */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveModal('chargeRemainder')}
          disabled={booking.is_test === true || fullyPaid}
          className="font-mono text-xs px-3 py-1.5 bg-black text-white hover:bg-accent hover:text-black disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          title={
            booking.is_test
              ? 'Test bookings cannot run real charges'
              : fullyPaid
              ? 'Already paid in full'
              : 'Charge the saved card or send a payment link'
          }
        >
          <CreditCard className="w-3 h-3" />
          Charge remainder
        </button>
        <button
          type="button"
          onClick={() => setActiveModal('resendLink')}
          disabled={booking.is_test === true || fullyPaid}
          className="font-mono text-xs px-3 py-1.5 border border-black/30 hover:bg-black hover:text-white disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          title={
            booking.is_test
              ? 'Test bookings cannot send real payment links'
              : fullyPaid
              ? 'Already paid in full'
              : 'Email a fresh Stripe payment link to the buyer'
          }
        >
          <Send className="w-3 h-3" />
          Resend link
        </button>
        <button
          type="button"
          onClick={() => setActiveModal('recordPayment')}
          disabled={booking.is_test === true}
          className="font-mono text-xs px-3 py-1.5 border border-black/30 hover:bg-black hover:text-white disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          title={booking.is_test ? 'Test bookings cannot record real payments' : 'Record cash, Venmo, check, or other'}
        >
          <Banknote className="w-3 h-3" />
          Record payment
        </button>
        <button
          type="button"
          onClick={() => setActiveModal('adjustPrice')}
          className="font-mono text-xs px-3 py-1.5 border border-black/15 text-black/60 hover:bg-black/5 inline-flex items-center gap-1.5"
        >
          <DollarSign className="w-3 h-3" />
          Adjust price
        </button>
        <button
          type="button"
          onClick={() => setActiveModal('addItem')}
          className="font-mono text-xs px-3 py-1.5 border border-black/15 text-black/60 hover:bg-black/5 inline-flex items-center gap-1.5"
          title="Add another offering for this buyer (separate booking row, same buyer)"
        >
          <Plus className="w-3 h-3" />
          Add item for buyer
        </button>
        {booking.status !== 'cancelled' && (
          <button
            type="button"
            onClick={() => setActiveModal('cancelOrder')}
            className="font-mono text-xs px-3 py-1.5 border border-red-300 text-red-700 hover:bg-red-700 hover:text-white inline-flex items-center gap-1.5 ml-auto"
            title="Mark this order cancelled. Refunds (if any) must be issued via Stripe directly."
          >
            <Trash2 className="w-3 h-3" />
            Cancel order
          </button>
        )}
        {booking.is_test && (
          <span className="font-mono text-[10px] text-purple-700 uppercase tracking-wider">
            test booking — money actions disabled
          </span>
        )}
      </div>

      {/* Status switcher */}
      <div className="flex items-center gap-3">
        <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60">
          Status
        </p>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="font-mono text-xs px-2 py-1 border border-black/15 bg-white"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={saveStatus}
          disabled={savingStatus || status === booking.status}
          className="font-mono text-xs px-3 py-1 bg-black text-white hover:bg-accent hover:text-black disabled:opacity-30 inline-flex items-center gap-1"
        >
          <Save className="w-3 h-3" />
          {savingStatus ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Per-component completion checkboxes */}
      {slots.length > 0 && (
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-2 inline-flex items-center gap-1.5">
            <PackageCheck className="w-3 h-3" />
            Components ({slots.filter((s) => slotStatusMap[s.key]?.completed).length}/{slots.length} done)
          </p>
          <ul className="space-y-2">
            {slots.map((slot) => (
              <ComponentSlotRow
                key={slot.key}
                bookingId={booking.id}
                slot={slot}
                state={slotStatusMap[slot.key] ?? {}}
                onChange={onChange}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Sessions */}
      <div>
        <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-2">
          Sessions
        </p>
        {loadingSessions ? (
          <p className="font-mono text-xs text-black/50">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="font-mono text-xs text-black/50">
            No sessions scheduled yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                onChange={() => {
                  loadSessions();
                  onChange();
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Deliverables */}
      <div>
        <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-2">
          Deliverables ({deliverables.length})
        </p>
        {deliverables.length > 0 && (
          <ul className="space-y-1.5 mb-3">
            {deliverables.map((d, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 px-3 py-2 bg-white border border-black/10"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <LinkIcon className="w-3 h-3 text-black/40 shrink-0" />
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-bold truncate hover:text-accent"
                  >
                    {d.label}
                  </a>
                  {d.kind && (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-black/40 shrink-0">
                      {d.kind}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeDeliverable(i)}
                  disabled={savingDeliverables}
                  className="text-black/40 hover:text-red-700 disabled:opacity-30"
                  aria-label="Remove deliverable"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (e.g. Final cut)"
            className="flex-1 px-3 py-1.5 border border-black/15 bg-white text-sm"
          />
          <input
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://…"
            className="flex-1 px-3 py-1.5 border border-black/15 bg-white text-sm"
          />
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as DeliverableItem['kind'])}
            className="px-2 py-1.5 border border-black/15 bg-white text-xs font-mono"
          >
            <option value="video">video</option>
            <option value="image">image</option>
            <option value="audio">audio</option>
            <option value="file">file</option>
            <option value="link">link</option>
          </select>
          <button
            type="button"
            onClick={addDeliverable}
            disabled={savingDeliverables}
            className="font-mono text-xs px-3 py-1.5 bg-black text-white hover:bg-accent hover:text-black disabled:opacity-30 inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 text-red-800 font-mono text-xs">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Final package — Round 8c. Admin builds + sends to buyer.
          Pre-fills from offering's configurator slots; auto-injects a
          planning_call line item when music_video or shorts>2. */}
      <PackageBuilder
        bookingId={booking.id}
        offering={offering ? {
          id: offering.id,
          title: offering.title,
          slug: offering.slug,
          price_cents: null,
          components: offering.components,
        } : null}
        configuredComponents={booking.configured_components as { selections?: Record<string, unknown> } | null}
        onChange={onChange}
      />

      {/* Conversation — Round 8b. Buyer ↔ admin ↔ engineer thread.
          Same component the buyer sees on /dashboard/media/orders/[id];
          admin role is auto-detected from the session. */}
      <MessageThread bookingId={booking.id} />

      {/* Audit history — collapsible. Loads only when opened so a 200-row
          list view doesn't refire 200 audit-log queries. */}
      <AuditHistoryPanel bookingId={booking.id} />

      {/* Modals */}
      {activeModal === 'chargeRemainder' && (
        <ChargeRemainderModal
          bookingId={booking.id}
          remainder={remainder}
          total={total}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            onChange();
          }}
        />
      )}
      {activeModal === 'recordPayment' && (
        <RecordPaymentModal
          bookingId={booking.id}
          remainder={remainder}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            onChange();
          }}
        />
      )}
      {activeModal === 'adjustPrice' && (
        <AdjustPriceModal
          bookingId={booking.id}
          currentTotal={total}
          paidSoFar={paid}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            onChange();
          }}
        />
      )}
      {activeModal === 'resendLink' && (
        <ResendLinkModal
          bookingId={booking.id}
          remainder={remainder}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            onChange();
          }}
        />
      )}
      {activeModal === 'addItem' && (
        <ManualBookingModal
          prefillUserId={booking.user_id}
          prefillUserLabel={
            buyer
              ? `${buyer.display_name || '(no name)'} · ${buyer.email || '(no email)'}`
              : null
          }
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            onChange();
          }}
        />
      )}
      {activeModal === 'cancelOrder' && (
        <CancelOrderModal
          bookingId={booking.id}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            onChange();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Per-slot component completion row
// ============================================================
//
// Renders a checkbox + Drive URL field per offering slot. On flip-to-done
// with a Drive URL present, the API emails the buyer "your X is ready".
// The first POST locks `notified_at`; subsequent re-clicks are no-ops on
// the email side. Admin can edit a Drive URL after the fact (the API
// re-saves it but won't re-send the email — the API stamps notified_at
// the first time only).

function ComponentSlotRow({
  bookingId,
  slot,
  state,
  onChange,
}: {
  bookingId: string;
  slot: { key: string; label: string; kind?: string };
  state: SlotStatus;
  onChange: () => void;
}) {
  const [completed, setCompleted] = useState(!!state.completed);
  const [driveUrl, setDriveUrl] = useState(state.drive_url ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Resync local state if parent refresh swapped in newer data.
  useEffect(() => {
    setCompleted(!!state.completed);
    setDriveUrl(state.drive_url ?? '');
    setDirty(false);
  }, [state.completed, state.drive_url]);

  async function save(opts?: { silent?: boolean }) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/media/bookings/${bookingId}/component-complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slot_key: slot.key,
            completed,
            drive_url: driveUrl.trim() || undefined,
            notify_buyer: !opts?.silent,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Could not save');
        return;
      }
      setDirty(false);
      onChange();
    } catch (e) {
      console.error('[component-slot] save error:', e);
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className="px-3 py-2 bg-white border border-black/10">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={completed}
            onChange={(e) => {
              setCompleted(e.target.checked);
              setDirty(true);
            }}
            className="w-4 h-4"
          />
          <span className="text-sm font-bold">{slot.label}</span>
          {slot.kind && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-black/40">
              {slot.kind}
            </span>
          )}
        </label>
        <input
          type="url"
          value={driveUrl}
          onChange={(e) => {
            setDriveUrl(e.target.value);
            setDirty(true);
          }}
          placeholder="Google Drive URL (optional)"
          className="flex-1 px-2 py-1 border border-black/15 bg-white text-sm"
        />
        <button
          type="button"
          onClick={() => save()}
          disabled={submitting || !dirty}
          className="font-mono text-xs px-3 py-1 bg-black text-white hover:bg-accent hover:text-black disabled:opacity-30 inline-flex items-center gap-1 shrink-0"
          title={
            completed && driveUrl.trim() && !state.notified_at
              ? 'Saves + emails buyer "your X is ready"'
              : 'Save changes'
          }
        >
          <Save className="w-3 h-3" />
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div className="flex items-center gap-3 mt-1">
        {state.completed && state.completed_at && (
          <span className="font-mono text-[10px] text-green-700 uppercase tracking-wider">
            ✓ {fmtStampDate(state.completed_at)}
            {state.completed_by && ` by ${state.completed_by}`}
          </span>
        )}
        {state.notified_at && (
          <span className="font-mono text-[10px] text-blue-700">
            buyer emailed {fmtStampDate(state.notified_at)}
          </span>
        )}
        {state.drive_url && (
          <a
            href={state.drive_url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] text-black/60 hover:text-accent inline-flex items-center gap-1"
          >
            <LinkIcon className="w-2.5 h-2.5" />
            saved link
          </a>
        )}
        {error && <span className="font-mono text-[10px] text-red-700">{error}</span>}
      </div>
    </li>
  );
}

// ============================================================
// Modals: charge remainder / record payment / adjust price
// ============================================================
//
// Pattern: each modal is a simple controlled overlay. Click the backdrop
// or hit Cancel to close. They post to the dedicated API routes and call
// onSuccess() which the parent uses to refresh + close.

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border-2 border-black w-full max-w-md p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold text-base mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ChargeRemainderModal({
  bookingId,
  remainder,
  total,
  onClose,
  onSuccess,
}: {
  bookingId: string;
  remainder: number;
  total: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [method, setMethod] = useState<'auto' | 'card' | 'link'>('auto');
  const [amountDollars, setAmountDollars] = useState((remainder / 100).toFixed(2));
  const [adjustTotal, setAdjustTotal] = useState(false);
  const [newTotalDollars, setNewTotalDollars] = useState((total / 100).toFixed(2));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit() {
    const cents = Math.round((Number(amountDollars) || 0) * 100);
    if (cents <= 0) {
      setError('Amount must be > 0');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { amount: cents };
      if (method !== 'auto') body.method = method;
      if (adjustTotal) {
        const newCents = Math.round((Number(newTotalDollars) || 0) * 100);
        if (newCents < 0) {
          setError('Total must be ≥ 0');
          setSubmitting(false);
          return;
        }
        body.changeTotalTo = newCents;
      }
      const res = await fetch(`/api/admin/media/bookings/${bookingId}/charge-remainder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not charge remainder');
        setSubmitting(false);
        return;
      }
      // For 'link', show the URL so admin can copy it. For 'card', success
      // is enough — the auditor entry on the booking proves it.
      if (data.method === 'link' && data.paymentUrl) {
        setResult(`Payment link sent. URL: ${data.paymentUrl}`);
      } else {
        onSuccess();
      }
    } catch (e) {
      console.error('[charge-remainder modal] error:', e);
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Charge remainder" onClose={onClose}>
      {result ? (
        <div className="space-y-3">
          <p className="text-sm">{result}</p>
          <button
            type="button"
            onClick={onSuccess}
            className="font-mono text-xs px-3 py-1.5 bg-black text-white"
          >
            Done
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
              Method
            </p>
            <div className="flex gap-2">
              {(['auto', 'card', 'link'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`font-mono text-xs px-3 py-1.5 border ${
                    method === m
                      ? 'bg-black text-white border-black'
                      : 'border-black/20 hover:bg-black/5'
                  }`}
                >
                  {m === 'auto' ? 'Auto-pick' : m === 'card' ? 'Saved card' : 'Email link'}
                </button>
              ))}
            </div>
            <p className="font-mono text-[10px] text-black/50 mt-1">
              {method === 'auto'
                ? 'Card if a card is saved, otherwise emails a payment link.'
                : method === 'card'
                ? 'Off-session charge against the saved Stripe card.'
                : 'Generates a Stripe payment link and emails the buyer.'}
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
              Amount ($)
            </p>
            <input
              type="number"
              min={0.01}
              step="0.01"
              value={amountDollars}
              onChange={(e) => setAmountDollars(e.target.value)}
              className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm"
            />
            <p className="font-mono text-[10px] text-black/50 mt-1">
              Outstanding: {formatCents(remainder)}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={adjustTotal}
              onChange={(e) => setAdjustTotal(e.target.checked)}
              className="w-4 h-4"
            />
            <span>Also adjust the project total</span>
          </label>
          {adjustTotal && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
                New total ($)
              </p>
              <input
                type="number"
                min={0}
                step="0.01"
                value={newTotalDollars}
                onChange={(e) => setNewTotalDollars(e.target.value)}
                className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm"
              />
            </div>
          )}
          {error && (
            <p className="font-mono text-xs text-red-700 inline-flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </p>
          )}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="font-mono text-xs px-4 py-2 bg-black text-white hover:bg-accent hover:text-black disabled:opacity-30"
            >
              {submitting ? 'Charging…' : 'Charge'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-xs px-3 py-2 text-black/50 hover:text-black"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function RecordPaymentModal({
  bookingId,
  remainder,
  onClose,
  onSuccess,
}: {
  bookingId: string;
  remainder: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [method, setMethod] = useState<'cash' | 'venmo' | 'check' | 'other'>('cash');
  const [amountDollars, setAmountDollars] = useState((remainder / 100).toFixed(2));
  const [collectedBy, setCollectedBy] = useState('');
  const [note, setNote] = useState('');
  const [addToTotal, setAddToTotal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const cents = Math.round((Number(amountDollars) || 0) * 100);
    if (cents <= 0) {
      setError('Amount must be > 0');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/media/bookings/${bookingId}/record-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: cents,
          method,
          collected_by: collectedBy.trim() || undefined,
          note: note.trim() || undefined,
          addToTotal,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not record payment');
        setSubmitting(false);
        return;
      }
      onSuccess();
    } catch (e) {
      console.error('[record-payment modal] error:', e);
      setError('Network error');
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Record payment" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
            Method
          </p>
          <div className="flex gap-2 flex-wrap">
            {(['cash', 'venmo', 'check', 'other'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`font-mono text-xs px-3 py-1.5 border ${
                  method === m
                    ? 'bg-black text-white border-black'
                    : 'border-black/20 hover:bg-black/5'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
            Amount ($)
          </p>
          <input
            type="number"
            min={0.01}
            step="0.01"
            value={amountDollars}
            onChange={(e) => setAmountDollars(e.target.value)}
            className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm"
          />
          <p className="font-mono text-[10px] text-black/50 mt-1">
            Outstanding: {formatCents(remainder)}
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
            Who collected (optional — defaults to you)
          </p>
          <input
            type="text"
            value={collectedBy}
            onChange={(e) => setCollectedBy(e.target.value)}
            placeholder="Cole, Jay, an engineer name…"
            className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm"
          />
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
            Note (optional)
          </p>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Got cash on shoot day"
            className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={addToTotal}
            onChange={(e) => setAddToTotal(e.target.checked)}
            className="w-4 h-4"
          />
          <span>Also bump project total by this amount (scope creep)</span>
        </label>
        {method === 'cash' && (
          <p className="font-mono text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1.5">
            Cash gets logged in the cash ledger as &quot;owed to business&quot; until deposited.
          </p>
        )}
        {error && (
          <p className="font-mono text-xs text-red-700 inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {error}
          </p>
        )}
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="font-mono text-xs px-4 py-2 bg-black text-white hover:bg-accent hover:text-black disabled:opacity-30"
          >
            {submitting ? 'Recording…' : 'Record'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs px-3 py-2 text-black/50 hover:text-black"
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function AdjustPriceModal({
  bookingId,
  currentTotal,
  paidSoFar,
  onClose,
  onSuccess,
}: {
  bookingId: string;
  currentTotal: number;
  paidSoFar: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [newTotalDollars, setNewTotalDollars] = useState((currentTotal / 100).toFixed(2));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const cents = Math.round((Number(newTotalDollars) || 0) * 100);
    if (cents < 0 || !Number.isInteger(cents)) {
      setError('Total must be ≥ 0');
      return;
    }
    if (cents < paidSoFar) {
      setError(`Total can't be less than already-paid (${formatCents(paidSoFar)})`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // We piggy-back on the charge-remainder endpoint with amount=0 (the
      // server short-circuits when remainder hits 0 after adjustment) OR
      // the PATCH endpoint. Use PATCH — it's the simplest path that won't
      // try to charge anything.
      const res = await fetch(`/api/admin/media/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ final_price_cents: cents }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not adjust price');
        setSubmitting(false);
        return;
      }
      onSuccess();
    } catch (e) {
      console.error('[adjust-price modal] error:', e);
      setError('Network error');
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Adjust project total" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm">
          Current total: <span className="font-bold">{formatCents(currentTotal)}</span>
          <br />
          Already paid: <span className="font-bold text-green-700">{formatCents(paidSoFar)}</span>
        </p>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
            New total ($)
          </p>
          <input
            type="number"
            min={0}
            step="0.01"
            value={newTotalDollars}
            onChange={(e) => setNewTotalDollars(e.target.value)}
            className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm"
          />
        </div>
        <p className="font-mono text-[10px] text-black/50">
          This only changes the dollar amount — no charges or refunds run. Use Charge remainder
          afterward if you want to collect the difference.
        </p>
        {error && (
          <p className="font-mono text-xs text-red-700 inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {error}
          </p>
        )}
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="font-mono text-xs px-4 py-2 bg-black text-white hover:bg-accent hover:text-black disabled:opacity-30"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs px-3 py-2 text-black/50 hover:text-black"
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function CancelOrderModal({
  bookingId,
  onClose,
  onSuccess,
}: {
  bookingId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');

  // Type-to-confirm because cancellation is high-stakes — admin has to
  // type "cancel" before the button enables. Stripe refunds (if any)
  // must be issued separately via the Stripe dashboard; cancelling
  // here only flips the row's status.
  const enabled = confirm.trim().toLowerCase() === 'cancel';

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/media/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not cancel');
        setSubmitting(false);
        return;
      }
      onSuccess();
    } catch (e) {
      console.error('[cancel-order modal] error:', e);
      setError('Network error');
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Cancel order" onClose={onClose}>
      <div className="space-y-3">
        <div className="bg-red-50 border border-red-200 px-3 py-2 text-red-900 text-sm">
          <p className="font-bold mb-1">This is destructive.</p>
          <p>
            The order moves to <span className="font-mono">cancelled</span>. The audit
            log keeps the row, but the buyer order page will show it as cancelled.
          </p>
          <p className="mt-2">
            <strong>Refunds</strong> are NOT handled here — issue them via the Stripe
            dashboard if money has already moved.
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
            Type <span className="font-bold">cancel</span> to confirm
          </p>
          <input
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm font-mono"
          />
        </div>
        {error && (
          <p className="font-mono text-xs text-red-700 inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {error}
          </p>
        )}
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !enabled}
            className="font-mono text-xs px-4 py-2 bg-red-700 text-white hover:bg-red-800 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {submitting ? 'Cancelling…' : 'Cancel order'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs px-3 py-2 text-black/50 hover:text-black"
          >
            Keep order
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ResendLinkModal({
  bookingId,
  remainder,
  onClose,
  onSuccess,
}: {
  bookingId: string;
  remainder: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amountDollars, setAmountDollars] = useState((remainder / 100).toFixed(2));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit() {
    const cents = Math.round((Number(amountDollars) || 0) * 100);
    if (cents <= 0) {
      setError('Amount must be > 0');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/media/bookings/${bookingId}/resend-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: cents }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not resend link');
        setSubmitting(false);
        return;
      }
      setResult(`Fresh link emailed to the buyer. URL: ${data.paymentUrl}`);
    } catch (e) {
      console.error('[resend-link modal] error:', e);
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Resend payment link" onClose={onClose}>
      {result ? (
        <div className="space-y-3">
          <p className="text-sm">{result}</p>
          <button
            type="button"
            onClick={onSuccess}
            className="font-mono text-xs px-3 py-1.5 bg-black text-white"
          >
            Done
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            Generates a brand-new Stripe payment link and emails it to the buyer. The
            previous link stays valid in Stripe — but the new one is the canonical
            current one.
          </p>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
              Amount ($)
            </p>
            <input
              type="number"
              min={0.01}
              step="0.01"
              value={amountDollars}
              onChange={(e) => setAmountDollars(e.target.value)}
              className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm"
            />
            <p className="font-mono text-[10px] text-black/50 mt-1">
              Outstanding: {formatCents(remainder)} (defaults here)
            </p>
          </div>
          {error && (
            <p className="font-mono text-xs text-red-700 inline-flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </p>
          )}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="font-mono text-xs px-4 py-2 bg-black text-white hover:bg-accent hover:text-black disabled:opacity-30"
            >
              {submitting ? 'Sending…' : 'Send fresh link'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-xs px-3 py-2 text-black/50 hover:text-black"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ============================================================
// Manual booking creation modal
// ============================================================
//
// Two-mode form mirroring /api/booking/invite (studio):
//   • Offline (cash/venmo/check/other): records the booking as fully
//     paid. Cash gets a ledger entry. Audit log captures it.
//   • Link: creates a Stripe Payment Link and emails it to the buyer.
//     Webhook handles completion via metadata.booking_id.
//
// We fetch the customer library + offering catalog when the modal opens
// (not on parent mount) so the data is always fresh — admin may have
// just created a buyer profile and we don't want stale options.

interface CustomerOption {
  user_id: string;
  display_name: string | null;
  email: string | null;
}
interface OfferingOption {
  id: string;
  title: string;
  slug: string;
  price_cents: number | null;
  active: boolean;
}

function ManualBookingModal({
  onClose,
  onSuccess,
  prefillUserId,
  prefillUserLabel,
}: {
  onClose: () => void;
  onSuccess: () => void;
  // When the modal is opened from "Add item for buyer" on an existing
  // booking, we lock the customer to the parent's buyer so admin can't
  // accidentally add an item to a different customer.
  prefillUserId?: string;
  prefillUserLabel?: string | null;
}) {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [offeringOpts, setOfferingOpts] = useState<OfferingOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  // Form state
  const [userId, setUserId] = useState(prefillUserId || '');
  const [offeringId, setOfferingId] = useState('');
  const [priceDollars, setPriceDollars] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<
    'cash' | 'venmo' | 'check' | 'other' | 'link'
  >('cash');
  const [collectedBy, setCollectedBy] = useState('');
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [clientsRes, offeringsRes] = await Promise.all([
          fetch('/api/admin/library/clients?detailed=false', { cache: 'no-store' }),
          fetch('/api/admin/media/offerings', { cache: 'no-store' }),
        ]);
        const clientsData = await clientsRes.json();
        const offeringsData = await offeringsRes.json();
        if (cancelled) return;
        const clients = (clientsData.clients || clientsData.profiles || []) as Array<{
          user_id: string;
          display_name: string | null;
          email: string | null;
        }>;
        setCustomers(
          clients
            .filter((c) => c.user_id)
            .sort((a, b) =>
              (a.display_name || a.email || '').localeCompare(b.display_name || b.email || ''),
            ),
        );
        setOfferingOpts(
          (offeringsData.offerings || []).filter((o: { active?: boolean }) => o.active !== false),
        );
      } catch (e) {
        console.error('[manual-booking modal] load options error:', e);
        if (!cancelled) setError('Could not load customers or offerings.');
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-fill price when offering changes
  useEffect(() => {
    if (!offeringId) return;
    const o = offeringOpts.find((x) => x.id === offeringId);
    if (o?.price_cents != null) {
      setPriceDollars((o.price_cents / 100).toFixed(2));
    }
  }, [offeringId, offeringOpts]);

  const filteredCustomers = customers.filter((c) => {
    if (!customerSearch.trim()) return true;
    const needle = customerSearch.trim().toLowerCase();
    return (
      (c.display_name || '').toLowerCase().includes(needle) ||
      (c.email || '').toLowerCase().includes(needle)
    );
  });

  async function submit() {
    setError(null);
    if (!userId) return setError('Pick a customer.');
    if (!offeringId) return setError('Pick an offering.');
    const cents = Math.round((Number(priceDollars) || 0) * 100);
    if (!Number.isInteger(cents) || cents < 0) return setError('Price must be a non-negative integer.');

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/media/bookings/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          offering_id: offeringId,
          final_price_cents: cents,
          paymentMethod,
          collected_by: collectedBy.trim() || undefined,
          note: note.trim() || undefined,
          customer_phone: phone.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not create booking');
        setSubmitting(false);
        return;
      }
      if (data.mode === 'link' && data.paymentUrl) {
        setResult(`Booking created. Payment link sent to buyer: ${data.paymentUrl}`);
      } else {
        onSuccess();
      }
    } catch (e) {
      console.error('[manual-booking modal] submit error:', e);
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="New manual media booking" onClose={onClose}>
      {result ? (
        <div className="space-y-3">
          <p className="text-sm">{result}</p>
          <button
            type="button"
            onClick={onSuccess}
            className="font-mono text-xs px-3 py-1.5 bg-black text-white"
          >
            Done
          </button>
        </div>
      ) : loadingOptions ? (
        <p className="font-mono text-sm text-black/50">Loading customers + offerings…</p>
      ) : (
        <div className="space-y-3">
          {prefillUserId ? (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
                Customer (locked)
              </p>
              <p className="px-3 py-1.5 border border-black/15 bg-black/5 text-sm font-mono">
                {prefillUserLabel || '(prefilled)'}
              </p>
            </div>
          ) : (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
                Customer
              </p>
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm mb-1"
              />
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm font-mono"
              >
                <option value="">— Pick a customer —</option>
                {filteredCustomers.map((c) => (
                  <option key={c.user_id} value={c.user_id}>
                    {c.display_name || '(no name)'} · {c.email || '(no email)'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
              Offering
            </p>
            <select
              value={offeringId}
              onChange={(e) => setOfferingId(e.target.value)}
              className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm font-mono"
            >
              <option value="">— Pick an offering —</option>
              {offeringOpts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title} {o.price_cents != null ? `· ${formatCents(o.price_cents)}` : '· (inquiry)'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
              Price ($)
            </p>
            <input
              type="number"
              min={0}
              step="0.01"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
              className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm"
            />
            <p className="font-mono text-[10px] text-black/50 mt-1">
              Defaults to the offering&apos;s catalog price; override for custom quotes.
            </p>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
              Payment method
            </p>
            <div className="flex flex-wrap gap-2">
              {/* Email link is the primary card-payment path for manual
                  bookings — admin creates the booking + Stripe emails the
                  buyer a payment link. Venmo was dropped per Cole; cash /
                  check / other cover offline collection. */}
              {(['cash', 'check', 'other', 'link'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`font-mono text-xs px-3 py-1.5 border ${
                    paymentMethod === m
                      ? 'bg-black text-white border-black'
                      : 'border-black/20 hover:bg-black/5'
                  }`}
                >
                  {m === 'link' ? 'Email link' : m}
                </button>
              ))}
            </div>
            <p className="font-mono text-[10px] text-black/50 mt-1">
              {paymentMethod === 'link'
                ? 'Creates a Stripe Payment Link, emails buyer, marks booking as inquiry until paid.'
                : 'Marks booking fully paid; cash flows through the cash ledger.'}
            </p>
          </div>

          {paymentMethod !== 'link' && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
                Who collected (optional)
              </p>
              <input
                type="text"
                value={collectedBy}
                onChange={(e) => setCollectedBy(e.target.value)}
                placeholder="Cole, Jay, an engineer…"
                className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm"
              />
            </div>
          )}

          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
              Note (optional)
            </p>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was this for?"
              className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm"
            />
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
              Customer phone (optional)
            </p>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="555-555-5555"
              className="w-full px-3 py-1.5 border border-black/20 bg-white text-sm"
            />
          </div>

          {error && (
            <p className="font-mono text-xs text-red-700 inline-flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="font-mono text-xs px-4 py-2 bg-black text-white hover:bg-accent hover:text-black disabled:opacity-30"
            >
              {submitting ? 'Creating…' : paymentMethod === 'link' ? 'Create + email link' : 'Create booking'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-xs px-3 py-2 text-black/50 hover:text-black"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ============================================================
// Audit history panel — full action log for one booking
// ============================================================
//
// Lazy: doesn't fetch until the admin clicks open. Avoids 200 separate
// audit-log queries firing when the orders list first loads. The
// chronological feed gives admin a single-pane view of every charge,
// completion, payment, price adjustment, and email that ever fired
// against a booking — invaluable when reconciling money disputes.

interface AuditEntry {
  id: string;
  action: string;
  performed_by: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

function AuditHistoryPanel({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/media/bookings/${bookingId}/audit-log`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not load history');
        return;
      }
      setEntries(data.entries || []);
      setLoaded(true);
    } catch (e) {
      console.error('[audit-history] load error:', e);
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) load();
  }

  return (
    <div className="border border-black/10 bg-white">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-black/[0.02] text-left"
      >
        <div className="inline-flex items-center gap-2">
          <History className="w-3.5 h-3.5 text-black/50" />
          <span className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60">
            Order history {loaded ? `(${entries.length})` : ''}
          </span>
        </div>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-black/40" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-black/40" />
        )}
      </button>
      {open && (
        <div className="border-t border-black/10 px-3 py-2">
          {loading ? (
            <p className="font-mono text-xs text-black/50">Loading…</p>
          ) : error ? (
            <p className="font-mono text-xs text-red-700 inline-flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </p>
          ) : entries.length === 0 ? (
            <p className="font-mono text-xs text-black/50">No audit entries yet.</p>
          ) : (
            <ol className="space-y-1.5">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="font-mono text-[11px] py-1.5 border-b border-black/5 last:border-b-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">{formatAuditAction(e.action)}</span>
                    <span className="text-black/40 shrink-0">
                      {fmtStampDateTime(e.created_at, { minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="text-black/60 truncate">
                    by {e.performed_by} · {summarizeAuditDetails(e)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

// Action snake_case → human-readable label.
function formatAuditAction(action: string): string {
  switch (action) {
    case 'cash_payment': return 'Cash payment recorded';
    case 'venmo_payment': return 'Venmo payment recorded';
    case 'check_payment': return 'Check payment recorded';
    case 'other_payment': return 'Other payment recorded';
    case 'remainder_charged_card': return 'Remainder charged (card)';
    case 'remainder_link_sent': return 'Payment link emailed';
    case 'remainder_link_resent': return 'Payment link RE-sent';
    case 'component_completed': return 'Component completed';
    case 'component_uncompleted': return 'Component reopened';
    case 'total_adjusted': return 'Project total adjusted';
    case 'manual_created_cash': return 'Manual booking — cash';
    case 'manual_created_venmo': return 'Manual booking — Venmo';
    case 'manual_created_check': return 'Manual booking — check';
    case 'manual_created_other': return 'Manual booking — other';
    case 'manual_created_link': return 'Manual booking — Stripe link';
    case 'cart_item_added': return 'Cart item added';
    case 'cart_item_removed': return 'Cart item removed';
    default: return action;
  }
}

// Pull the most useful 1-2 fields out of the JSONB details bag.
function summarizeAuditDetails(e: AuditEntry): string {
  const d = e.details;
  if (!d) return '—';
  const parts: string[] = [];
  if (typeof d.amount_cents === 'number') {
    parts.push(`$${(d.amount_cents / 100).toFixed(2)}`);
  }
  if (typeof d.method === 'string') parts.push(String(d.method));
  if (typeof d.previous_total === 'number' && typeof d.new_total === 'number') {
    parts.push(`$${(d.previous_total / 100).toFixed(2)} → $${(d.new_total / 100).toFixed(2)}`);
  }
  if (typeof d.slot_label === 'string') parts.push(String(d.slot_label));
  if (typeof d.drive_url === 'string' && d.drive_url) parts.push('Drive link saved');
  if (typeof d.collected_by === 'string') parts.push(`by ${d.collected_by}`);
  if (typeof d.note === 'string' && d.note) parts.push(`note: ${d.note}`);
  return parts.length ? parts.join(' · ') : '—';
}

// ============================================================
// Session row — mark complete + payout entry
// ============================================================

function SessionRow({
  session,
  onChange,
}: {
  session: MediaSessionBooking;
  onChange: () => void;
}) {
  // Two distinct edit modes:
  //   - 'payout'  → mark a scheduled session complete + record payout dollars
  //   - 'details' → edit time/location/notes on a scheduled session (Phase E)
  const [editMode, setEditMode] = useState<null | 'payout' | 'details'>(null);
  const [payoutDollars, setPayoutDollars] = useState(
    session.engineer_payout_cents != null
      ? String(session.engineer_payout_cents / 100)
      : '',
  );

  // Detail-edit form state. Convert ISO timestamps to the browser's local
  // datetime-local format for the picker. Local-tz quirks: the input value
  // must be `YYYY-MM-DDTHH:MM` with NO seconds/timezone suffix.
  const toLocalInput = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [editStarts, setEditStarts] = useState(toLocalInput(session.starts_at));
  const [editEnds, setEditEnds] = useState(toLocalInput(session.ends_at));
  const [editLocation, setEditLocation] = useState<'studio' | 'external'>(session.location);
  const [editExternalText, setEditExternalText] = useState(session.external_location_text ?? '');
  const [editNotes, setEditNotes] = useState(session.notes ?? '');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setEditMode(null);
    setError(null);
    // Reset detail form to current row state in case user toggled back open
    setEditStarts(toLocalInput(session.starts_at));
    setEditEnds(toLocalInput(session.ends_at));
    setEditLocation(session.location);
    setEditExternalText(session.external_location_text ?? '');
    setEditNotes(session.notes ?? '');
  }

  async function complete() {
    const cents = Math.round((Number(payoutDollars) || 0) * 100);
    if (cents < 0) {
      setError('Payout must be ≥ 0');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/media/sessions/${session.id}/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engineer_payout_cents: cents }),
        },
      );
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Could not mark complete');
        setSubmitting(false);
        return;
      }
      setEditMode(null);
      onChange();
    } catch (e) {
      console.error('[admin-media-orders] complete error:', e);
      setError('Network error');
      setSubmitting(false);
    }
  }

  async function saveDetails() {
    if (editLocation === 'external' && editExternalText.trim().length < 3) {
      setError('External shoots need a location description');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // datetime-local inputs return browser-local strings without TZ.
      // Construct Dates and ship ISO so the server stores UTC consistently.
      const startsIso = new Date(editStarts).toISOString();
      const endsIso = new Date(editEnds).toISOString();
      const res = await fetch(`/api/admin/media/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          starts_at: startsIso,
          ends_at: endsIso,
          location: editLocation,
          external_location_text:
            editLocation === 'external' ? editExternalText.trim() : null,
          notes: editNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Could not save changes');
        setSubmitting(false);
        return;
      }
      setEditMode(null);
      onChange();
    } catch (e) {
      console.error('[admin-media-orders] save details error:', e);
      setError('Network error');
      setSubmitting(false);
    }
  }

  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2 bg-white border border-black/10">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-bold text-sm">
            {SESSION_KIND_LABELS[session.session_kind as MediaSessionKind]}
          </span>
          <span
            className={`font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 ${
              session.status === 'completed'
                ? 'bg-green-100 text-green-900'
                : session.status === 'cancelled'
                ? 'bg-red-100 text-red-900'
                : 'bg-blue-100 text-blue-900'
            }`}
          >
            {session.status}
          </span>
          {session.engineer_payout_cents != null && (
            <span className="font-mono text-[10px] text-black/50">
              · payout {formatCents(session.engineer_payout_cents)}
            </span>
          )}
        </div>
        <p className="font-mono text-[11px] text-black/50">
          <Clock className="w-3 h-3 inline mr-1" />
          {fmtStampDateTime(session.starts_at, { minute: '2-digit' })}
          {' – '}
          {fmtStampTime(session.ends_at, { minute: '2-digit' })}
          {' · '}
          {session.location === 'studio'
            ? 'Studio'
            : session.external_location_text || 'External'}
        </p>
        {editMode === 'payout' && (
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-[11px] text-black/60">Payout $</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={payoutDollars}
              onChange={(e) => setPayoutDollars(e.target.value)}
              className="w-24 px-2 py-1 border border-black/15 bg-white text-sm"
            />
            <button
              type="button"
              onClick={complete}
              disabled={submitting}
              className="font-mono text-xs px-3 py-1 bg-black text-white hover:bg-accent hover:text-black disabled:opacity-30 inline-flex items-center gap-1"
            >
              <CheckCircle2 className="w-3 h-3" />
              {submitting ? 'Saving…' : 'Mark complete'}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="font-mono text-xs text-black/50 hover:text-black"
            >
              Cancel
            </button>
          </div>
        )}
        {editMode === 'details' && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 p-3 bg-black/[0.03] border border-black/10">
            <label className="text-xs">
              <span className="block font-mono text-[10px] uppercase text-black/50 mb-0.5">Starts</span>
              <input
                type="datetime-local"
                value={editStarts}
                onChange={(e) => setEditStarts(e.target.value)}
                className="w-full px-2 py-1 border border-black/15 bg-white text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block font-mono text-[10px] uppercase text-black/50 mb-0.5">Ends</span>
              <input
                type="datetime-local"
                value={editEnds}
                onChange={(e) => setEditEnds(e.target.value)}
                className="w-full px-2 py-1 border border-black/15 bg-white text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block font-mono text-[10px] uppercase text-black/50 mb-0.5">Location</span>
              <select
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value as 'studio' | 'external')}
                className="w-full px-2 py-1 border border-black/15 bg-white text-sm"
              >
                <option value="studio">studio</option>
                <option value="external">external</option>
              </select>
            </label>
            {editLocation === 'external' && (
              <label className="text-xs">
                <span className="block font-mono text-[10px] uppercase text-black/50 mb-0.5">Where</span>
                <input
                  type="text"
                  value={editExternalText}
                  onChange={(e) => setEditExternalText(e.target.value)}
                  className="w-full px-2 py-1 border border-black/15 bg-white text-sm"
                />
              </label>
            )}
            <label className="text-xs md:col-span-2">
              <span className="block font-mono text-[10px] uppercase text-black/50 mb-0.5">Notes</span>
              <textarea
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="w-full px-2 py-1 border border-black/15 bg-white text-sm resize-y"
              />
            </label>
            <div className="md:col-span-2 flex items-center gap-2">
              <button
                type="button"
                onClick={saveDetails}
                disabled={submitting}
                className="font-mono text-xs px-3 py-1 bg-black text-white hover:bg-accent hover:text-black disabled:opacity-30 inline-flex items-center gap-1"
              >
                <Save className="w-3 h-3" />
                {submitting ? 'Saving…' : 'Save details'}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="font-mono text-xs text-black/50 hover:text-black"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="font-mono text-[11px] text-red-700 mt-1">{error}</p>
        )}
      </div>
      {editMode === null && session.status === 'scheduled' && (
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setEditMode('details')}
            className="font-mono text-[11px] text-black/60 hover:text-black inline-flex items-center gap-1"
            title="Edit time/location/notes"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setEditMode('payout')}
            className="font-mono text-[11px] text-black/60 hover:text-black inline-flex items-center gap-1"
          >
            <CheckCircle2 className="w-3 h-3" />
            Complete
          </button>
        </div>
      )}
      {editMode === null && session.status === 'completed' && (
        <button
          type="button"
          onClick={() => setEditMode('payout')}
          className="font-mono text-[11px] text-black/40 hover:text-black inline-flex items-center gap-1 shrink-0"
          title="Edit payout"
        >
          <Pencil className="w-3 h-3" />
          Edit payout
        </button>
      )}
    </li>
  );
}

