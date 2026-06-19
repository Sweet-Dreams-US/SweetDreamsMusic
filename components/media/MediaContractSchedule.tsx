'use client';

// components/media/MediaContractSchedule.tsx
//
// Artist-facing CONTRACT VIEW + signature + installment payment schedule for a
// Media Project. Rendered on /dashboard/media/orders/[id] ONLY when the booking
// has a plan and/or contract terms — legacy (no-plan, no-terms) bookings never
// mount this, so they keep their existing balance/sessions/deliverables view.
//
// This is the artist's full contract surface, top to bottom:
//   1. Dual-signature status banner — manager-signed badge + the artist's own
//      sign state. Once BOTH signatures land, a green "finalized — your booking
//      is on the calendar" confirmation.
//   2. Production logistics — the planned_shoots the manager penciled in
//      (date / time / duration / location / engineer). Read-only; these become
//      real calendar sessions at finalize.
//   3. Deliverables — the package line items (loaded client-side), with free
//      add-ons clearly marked, and the line-item total.
//   4. Total investment — the contract total.
//   5. Contract terms — free-text terms; the prominent "I agree & sign" action
//      lives here (POST /api/media/bookings/[id]/agree, then refresh).
//   6. Payment schedule — a row per stint (label / amount / due / status) with
//      "Pay now" (an <a> to the Stripe link) for link_sent + unpaid stints.
//      Pay-now is GATED until the contract is agreed.
//
// The server passes already-loaded contract/installment/shoot data in; the
// package line items are fetched client-side (same endpoint PackageReview uses).
// The only mutation here is the agree POST. After it succeeds we
// router.refresh() so the server re-reads the booking (both stamps + any
// unlocked links + finalized state).

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  FileText,
  CreditCard,
  Clock,
  Loader2,
  AlertCircle,
  MapPin,
  Video,
  CalendarCheck,
  Package as PackageIcon,
  Gift,
} from 'lucide-react';
import { formatCents } from '@/lib/utils';
import { fmtStampDate } from '@/lib/studio-time';
import {
  type LineItem,
  type Package,
  type LineItemKind,
  LINE_ITEM_KIND_LABELS,
} from '@/lib/media-packages';
import { SESSION_KIND_LABELS, type MediaSessionKind } from '@/lib/media-scheduling';

// Mirrors the server-side MediaInstallment (client-safe subset).
export interface ArtistInstallment {
  id: string;
  sort_order: number;
  label: string;
  amount_cents: number;
  due_date: string | null;
  status: 'pending' | 'link_sent' | 'paid' | 'void';
  stripe_payment_link_url: string | null;
  paid_at: string | null;
  paid_method: string | null;
}

// Client-safe subset of lib/media-contract-finalize PlannedShoot. The server
// reads these off project_details.planned_shoots and passes them straight
// through — display only, no scheduling happens here.
export interface ArtistPlannedShoot {
  date: string;
  start_time: string;
  duration_hours: number;
  location: 'studio' | 'external';
  external_location_text?: string | null;
  engineer_name?: string | null;
  session_kind?: string | null;
}

export default function MediaContractSchedule({
  bookingId,
  contractTerms,
  contractAgreedAt,
  managerAgreedAt,
  contractFinalizedAt,
  plannedShoots,
  installments,
  totalCents,
}: {
  bookingId: string;
  contractTerms: string | null;
  contractAgreedAt: string | null;
  managerAgreedAt: string | null;
  contractFinalizedAt: string | null;
  plannedShoots: ArtistPlannedShoot[];
  installments: ArtistInstallment[];
  totalCents: number;
}) {
  const router = useRouter();
  const [agreeing, setAgreeing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deliverables (package line items) — loaded client-side, same endpoint the
  // PackageReview surface uses. Read-only here; the artist approves individual
  // items in PackageReview. We only summarize the contracted scope.
  const [pkg, setPkg] = useState<Package | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  const loadPackage = useCallback(async () => {
    try {
      const res = await fetch(`/api/media/bookings/${bookingId}/package`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setPkg(data.package ?? null);
      setLineItems((data.line_items as LineItem[]) ?? []);
    } catch {
      /* deliverables block just hides if it can't load */
    }
  }, [bookingId]);

  useEffect(() => {
    loadPackage();
  }, [loadPackage]);

  const artistSigned = !!contractAgreedAt;
  const managerSigned = !!managerAgreedAt;
  const finalized = !!contractFinalizedAt;
  const bothSigned = artistSigned && managerSigned;
  const hasPlan = installments.length > 0;
  const paidCents = installments
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + i.amount_cents, 0);

  // Show deliverables only once the package has been proposed (sent/approved).
  const showDeliverables = !!pkg && pkg.status !== 'draft' && lineItems.length > 0;
  const deliverablesTotal = lineItems.reduce((sum, i) => sum + i.total_cents, 0);

  async function agree() {
    setAgreeing(true);
    setError(null);
    try {
      const res = await fetch(`/api/media/bookings/${bookingId}/agree`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not record your agreement.');
        return;
      }
      router.refresh();
    } catch (e) {
      console.error('[contract-schedule] agree error:', e);
      setError('Network error — please try again.');
    } finally {
      setAgreeing(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Dual-signature status */}
      {contractTerms && (
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-3 inline-flex items-center gap-1.5">
            <FileText className="w-3 h-3" />
            Signatures
          </p>

          {finalized ? (
            <div className="border-2 border-green-300 bg-green-50 p-5">
              <p className="font-mono text-sm font-bold text-green-900 inline-flex items-center gap-2">
                <CalendarCheck className="w-5 h-5" />
                Contract finalized — your booking is on the calendar
              </p>
              <p className="font-mono text-xs text-green-800/80 mt-2">
                Both you and the Sweet Dreams team have signed. Any planned shoots
                are now scheduled below — check &ldquo;Scheduled sessions&rdquo; for
                the locked-in dates.
              </p>
            </div>
          ) : (
            <div className="border-2 border-black/10 grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-black/10">
              <SignatureCell
                role="Sweet Dreams"
                signed={managerSigned}
                signedAt={managerAgreedAt}
                pendingLabel="Awaiting studio signature"
              />
              <SignatureCell
                role="You"
                signed={artistSigned}
                signedAt={contractAgreedAt}
                pendingLabel="Not signed yet"
              />
            </div>
          )}

          {bothSigned && !finalized && (
            <p className="font-mono text-[11px] text-black/50 mt-2">
              Both parties have signed — finalizing your booking now.
            </p>
          )}
        </div>
      )}

      {/* Production logistics (planned shoots) */}
      {plannedShoots.length > 0 && (
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-3 inline-flex items-center gap-1.5">
            <Video className="w-3 h-3" />
            Production logistics
          </p>
          <ul className="border-2 border-black/10 divide-y divide-black/10">
            {plannedShoots.map((shoot, i) => {
              const kindLabel =
                shoot.session_kind &&
                SESSION_KIND_LABELS[shoot.session_kind as MediaSessionKind]
                  ? SESSION_KIND_LABELS[shoot.session_kind as MediaSessionKind]
                  : 'Video shoot';
              return (
                <li key={i} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-sm">{kindLabel}</h3>
                    <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-black/10 text-black/60">
                      {shoot.location === 'studio' ? 'studio' : 'external'}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-black/60 space-y-0.5">
                    <p className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatShootWhen(shoot)}
                    </p>
                    <p className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {shoot.location === 'studio'
                        ? 'Sweet Dreams Studio'
                        : shoot.external_location_text || 'External location (TBD)'}
                    </p>
                    {shoot.engineer_name && <p>Engineer: {shoot.engineer_name}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          {!finalized && (
            <p className="font-mono text-[11px] text-black/40 mt-2">
              These shoots become locked-in calendar sessions once both parties
              sign the contract.
            </p>
          )}
        </div>
      )}

      {/* Deliverables breakdown */}
      {showDeliverables && (
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-3 inline-flex items-center gap-1.5">
            <PackageIcon className="w-3 h-3" />
            Deliverables
          </p>
          <ul className="border-2 border-black/10 divide-y divide-black/10">
            {lineItems.map((it) => {
              const isFree = it.total_cents === 0;
              return (
                <li
                  key={it.id}
                  className="px-4 py-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-bold text-sm">{it.label}</span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-black/50">
                        {LINE_ITEM_KIND_LABELS[it.kind as LineItemKind] ?? it.kind}
                      </span>
                      {it.qty > 1 && (
                        <span className="font-mono text-[10px] text-black/50">
                          ×{it.qty}
                        </span>
                      )}
                      {isFree && (
                        <span className="font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-accent/20 text-black/70 inline-flex items-center gap-1">
                          <Gift className="w-3 h-3" />
                          free add-on
                        </span>
                      )}
                    </div>
                    {it.notes && (
                      <p className="text-xs text-black/60 mt-0.5">{it.notes}</p>
                    )}
                  </div>
                  <span className="font-bold text-sm tabular-nums shrink-0">
                    {isFree ? 'Free' : formatCents(it.total_cents)}
                  </span>
                </li>
              );
            })}
            <li className="px-4 py-3 flex items-center justify-between bg-black/[0.03]">
              <span className="font-mono text-[11px] uppercase tracking-wider text-black/60">
                Deliverables total
              </span>
              <span className="font-bold text-sm tabular-nums">
                {formatCents(deliverablesTotal)}
              </span>
            </li>
          </ul>
          <p className="font-mono text-[11px] text-black/40 mt-2">
            Approve each line item in the &ldquo;Proposed package&rdquo; section
            below.
          </p>
        </div>
      )}

      {/* Total investment */}
      <div>
        <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-3">
          Total investment
        </p>
        <div className="border-2 border-black bg-black text-white px-5 py-4 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wider text-white/60">
            Project total
          </span>
          <span className="font-mono text-2xl font-bold tabular-nums">
            {formatCents(totalCents)}
          </span>
        </div>
      </div>

      {/* Contract terms + sign action */}
      {contractTerms && (
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-3 inline-flex items-center gap-1.5">
            <FileText className="w-3 h-3" />
            Contract terms
          </p>
          <div
            className={`border-2 p-5 ${
              artistSigned ? 'border-green-300 bg-green-50' : 'border-accent bg-accent/10'
            }`}
          >
            <p className="text-sm whitespace-pre-wrap text-black/85">
              {contractTerms}
            </p>
            <div className="mt-4 pt-4 border-t border-black/10">
              {artistSigned ? (
                <p className="font-mono text-xs text-green-800 inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  You signed on{' '}
                  {fmtStampDate(contractAgreedAt!, {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="font-mono text-[11px] text-black/60">
                    By signing you agree to the deliverables, schedule, and total
                    above. You must sign before making any payment.
                  </p>
                  <button
                    type="button"
                    onClick={agree}
                    disabled={agreeing}
                    className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-accent hover:text-black transition-colors disabled:opacity-40 inline-flex items-center gap-2"
                  >
                    {agreeing ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Recording…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        I agree &amp; sign
                      </>
                    )}
                  </button>
                  {error && (
                    <p className="font-mono text-xs text-red-700 inline-flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {error}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment schedule */}
      {hasPlan && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 inline-flex items-center gap-1.5">
              <CreditCard className="w-3 h-3" />
              Payment schedule
            </p>
            <p className="font-mono text-[11px] text-black/60">
              Paid{' '}
              <span className="font-bold text-green-700 tabular-nums">
                {formatCents(paidCents)}
              </span>
              {' / '}
              <span className="tabular-nums">{formatCents(totalCents)}</span>
            </p>
          </div>

          {/* Contract-not-agreed banner — payments are gated. */}
          {contractTerms && !artistSigned && (
            <div className="border-2 border-amber-300 bg-amber-50 p-4 mb-3">
              <p className="font-mono text-xs text-amber-900">
                Sign the contract above to unlock payment. Each installment can be
                paid individually once the studio sends its link.
              </p>
            </div>
          )}

          <ul className="border-2 border-black/10 divide-y divide-black/10">
            {installments.map((inst) => {
              const isPaid = inst.status === 'paid';
              const canPay =
                inst.status === 'link_sent' &&
                !!inst.stripe_payment_link_url &&
                (!contractTerms || artistSigned);
              return (
                <li
                  key={inst.id}
                  className="px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm truncate">
                        {inst.label}
                      </span>
                      <span
                        className={`font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 ${
                          isPaid
                            ? 'bg-green-100 text-green-900'
                            : inst.status === 'link_sent'
                            ? 'bg-blue-100 text-blue-900'
                            : 'bg-black/10 text-black/60'
                        }`}
                      >
                        {isPaid
                          ? 'paid'
                          : inst.status === 'link_sent'
                          ? 'ready to pay'
                          : 'pending'}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-black/55 mt-0.5">
                      {inst.due_date && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          due{' '}
                          {fmtStampDate(inst.due_date, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      )}
                      {isPaid && inst.paid_at && (
                        <span className={inst.due_date ? 'ml-2' : ''}>
                          ✓ paid{' '}
                          {fmtStampDate(inst.paid_at, {
                            month: 'short',
                            day: 'numeric',
                          })}
                          {inst.paid_method && ` · ${inst.paid_method}`}
                        </span>
                      )}
                      {!isPaid && inst.status === 'pending' && (
                        <span className={inst.due_date ? 'ml-2' : ''}>
                          Awaiting payment link from the studio
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-bold text-sm tabular-nums">
                      {formatCents(inst.amount_cents)}
                    </span>
                    {isPaid ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : canPay ? (
                      <a
                        href={inst.stripe_payment_link_url!}
                        className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-accent hover:text-black transition-colors no-underline inline-flex items-center gap-1.5"
                      >
                        <CreditCard className="w-3 h-3" />
                        Pay now
                      </a>
                    ) : inst.status === 'link_sent' ? (
                      // Link exists but contract not yet signed — gated.
                      <span
                        className="font-mono text-[10px] uppercase tracking-wider px-3 py-2 border border-black/15 text-black/40"
                        title="Sign the contract above to pay"
                      >
                        Locked
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// One side of the dual-signature panel: a role + signed/pending state.
function SignatureCell({
  role,
  signed,
  signedAt,
  pendingLabel,
}: {
  role: string;
  signed: boolean;
  signedAt: string | null;
  pendingLabel: string;
}) {
  return (
    <div className="p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
        {role}
      </p>
      {signed ? (
        <p className="font-mono text-xs text-green-800 inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" />
          Signed
          {signedAt && (
            <span className="text-green-700/80">
              {' '}
              {fmtStampDate(signedAt, { month: 'short', day: 'numeric' })}
            </span>
          )}
        </p>
      ) : (
        <p className="font-mono text-xs text-black/45 inline-flex items-center gap-1.5">
          <Clock className="w-4 h-4" />
          {pendingLabel}
        </p>
      )}
    </div>
  );
}

// planned_shoots carry an Eastern calendar date + wall-clock start_time as
// plain strings (NOT instants). Render them directly so the artist sees the
// exact Eastern date/time the manager penciled in, with the computed end
// time appended.
function formatShootWhen(shoot: ArtistPlannedShoot): string {
  const datePart = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(shoot.date || '');
    if (!m) return shoot.date || 'Date TBD';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  })();

  const start = to12h(shoot.start_time);
  const end = addHours12h(shoot.start_time, shoot.duration_hours);
  const timePart = start && end ? `${start} – ${end}` : start || '';
  const durPart = `${shoot.duration_hours} hr${shoot.duration_hours === 1 ? '' : 's'}`;

  return [datePart, timePart, `(${durPart})`].filter(Boolean).join(' · ');
}

function to12h(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return '';
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

function addHours12h(hhmm: string | null | undefined, hours: number): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m || !Number.isFinite(hours)) return '';
  const totalMin = Number(m[1]) * 60 + Number(m[2]) + Math.round(hours * 60);
  const endH = Math.floor((totalMin % (24 * 60)) / 60);
  const endMin = totalMin % 60;
  const hh = String(endH).padStart(2, '0');
  const mm = String(endMin).padStart(2, '0');
  return to12h(`${hh}:${mm}`);
}
