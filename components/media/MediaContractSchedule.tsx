'use client';

// components/media/MediaContractSchedule.tsx
//
// Artist-facing contract + installment payment schedule for a Media Project.
// Rendered on /dashboard/media/orders/[id] ONLY when the booking has a plan
// and/or contract terms — legacy (no-plan, no-terms) bookings never mount
// this, so they keep their existing balance/sessions/deliverables view.
//
// Two surfaces:
//   1. Contract — shows contract_terms; a prominent "I agree" button when not
//      yet agreed (POST /api/media/bookings/[id]/agree, then refresh). Once
//      agreed, shows "Agreed on <date>".
//   2. Payment schedule — a row per stint (label · amount · due · status) with
//      "Pay now" (an <a> to the Stripe link) for link_sent + unpaid stints.
//      Pending stints show "Awaiting payment link from the studio"; paid
//      stints show a ✓ with method/date. Pay-now is GATED: until the contract
//      is agreed, the button is disabled and points the artist at "I agree".
//
// The server passes already-loaded data in; the only mutation here is the
// agree POST. After it succeeds we router.refresh() so the server re-reads
// the booking (agreement stamp + any unlocked links).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, FileText, CreditCard, Clock, Loader2, AlertCircle } from 'lucide-react';
import { formatCents } from '@/lib/utils';
import { fmtStampDate } from '@/lib/studio-time';

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

export default function MediaContractSchedule({
  bookingId,
  contractTerms,
  contractAgreedAt,
  installments,
  totalCents,
}: {
  bookingId: string;
  contractTerms: string | null;
  contractAgreedAt: string | null;
  installments: ArtistInstallment[];
  totalCents: number;
}) {
  const router = useRouter();
  const [agreeing, setAgreeing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agreed = !!contractAgreedAt;
  const hasPlan = installments.length > 0;
  const paidCents = installments
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + i.amount_cents, 0);

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
      {/* Contract */}
      {contractTerms && (
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-3 inline-flex items-center gap-1.5">
            <FileText className="w-3 h-3" />
            Contract
          </p>
          <div
            className={`border-2 p-5 ${
              agreed ? 'border-green-300 bg-green-50' : 'border-accent bg-accent/10'
            }`}
          >
            <p className="text-sm whitespace-pre-wrap text-black/85">{contractTerms}</p>
            <div className="mt-4 pt-4 border-t border-black/10">
              {agreed ? (
                <p className="font-mono text-xs text-green-800 inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  Agreed on {fmtStampDate(contractAgreedAt!, { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="font-mono text-[11px] text-black/60">
                    You must agree to these terms before making any payment.
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
                        I agree
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
              Paid <span className="font-bold text-green-700 tabular-nums">{formatCents(paidCents)}</span>
              {' / '}
              <span className="tabular-nums">{formatCents(totalCents)}</span>
            </p>
          </div>

          {/* Contract-not-agreed banner — payments are gated. */}
          {contractTerms && !agreed && (
            <div className="border-2 border-amber-300 bg-amber-50 p-4 mb-3">
              <p className="font-mono text-xs text-amber-900">
                Agree to the contract above to unlock payment. Each installment can be paid
                individually once the studio sends its link.
              </p>
            </div>
          )}

          <ul className="border-2 border-black/10 divide-y divide-black/10">
            {installments.map((inst) => {
              const isPaid = inst.status === 'paid';
              const canPay =
                inst.status === 'link_sent' &&
                !!inst.stripe_payment_link_url &&
                (!contractTerms || agreed);
              return (
                <li key={inst.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm truncate">{inst.label}</span>
                      <span
                        className={`font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 ${
                          isPaid
                            ? 'bg-green-100 text-green-900'
                            : inst.status === 'link_sent'
                            ? 'bg-blue-100 text-blue-900'
                            : 'bg-black/10 text-black/60'
                        }`}
                      >
                        {isPaid ? 'paid' : inst.status === 'link_sent' ? 'ready to pay' : 'pending'}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-black/55 mt-0.5">
                      {inst.due_date && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          due {fmtStampDate(inst.due_date, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      )}
                      {isPaid && inst.paid_at && (
                        <span className={inst.due_date ? 'ml-2' : ''}>
                          ✓ paid {fmtStampDate(inst.paid_at, { month: 'short', day: 'numeric' })}
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
                    <span className="font-bold text-sm tabular-nums">{formatCents(inst.amount_cents)}</span>
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
                      // Link exists but contract not yet agreed — gated.
                      <span
                        className="font-mono text-[10px] uppercase tracking-wider px-3 py-2 border border-black/15 text-black/40"
                        title="Agree to the contract above to pay"
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
