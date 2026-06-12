'use client';

// components/admin/CashCorrectionsLog.tsx
//
// Admin-side audit log viewer. Lists every post-completion cash
// correction made via /api/booking/[id]/correct-cash. Surfaced inside
// the Accounting tab so when admin reviews the books, suspicious
// corrections are visible alongside the actual numbers.
//
// What admin looks for:
//   • Negative deltas (revenue going DOWN) — could be legit (early
//     leave) or revenue being skimmed
//   • Pattern of one engineer correcting downward repeatedly
//   • Vague reasons like "fix" or "wrong" without context
//
// Each row shows: customer + session date + engineer who collected +
// who corrected + before/after amounts + reason.

import { useEffect, useState, useCallback } from 'react';
import { Loader2, AlertCircle, ArrowDown, ArrowUp, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { fmtSessionDateTime, fmtStampDateTime } from '@/lib/studio-time';

interface Correction {
  id: string;
  booking_id: string;
  previous_total_cents: number;
  new_total_cents: number;
  previous_cash_ledger_amount_cents: number | null;
  new_cash_ledger_amount_cents: number | null;
  delta_cents: number;
  reason: string;
  corrected_by_email: string;
  corrected_by_role: 'admin' | 'engineer';
  created_at: string;
  booking_customer_name: string | null;
  booking_customer_email: string | null;
  booking_room: string | null;
  booking_start_time: string | null;
  booking_engineer: string | null;
  booking_status: string | null;
}

function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

// booking_start_time = wall-clock-as-UTC → fmtSessionDateTime
// created_at (correction timestamp) = true-UTC → fmtStampDateTime

export default function CashCorrectionsLog() {
  const [corrections, setCorrections] = useState<Correction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/cash-corrections', { cache: 'no-store' });
      if (!res.ok) {
        setError('Could not load cash corrections.');
        return;
      }
      const body = await res.json();
      setCorrections((body.corrections ?? []) as Correction[]);
    } catch {
      setError('Network error.');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (error) {
    return (
      <div className="border-2 border-red-300 bg-red-50 p-3 inline-flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-red-700" />
        <p className="font-mono text-sm text-red-900">{error}</p>
      </div>
    );
  }

  if (corrections === null) {
    return (
      <div className="text-center py-8">
        <Loader2 className="w-5 h-5 animate-spin mx-auto text-black/40" />
      </div>
    );
  }

  // Hide entirely when empty — no point burning vertical space.
  if (corrections.length === 0) return null;

  // Surface flags: downward corrections (revenue went DOWN) get
  // visual weight so admin scans them first.
  const downwardCount = corrections.filter((c) => c.delta_cents < 0).length;
  const downwardTotal = corrections
    .filter((c) => c.delta_cents < 0)
    .reduce((s, c) => s + c.delta_cents, 0);

  return (
    <section className="border-2 border-orange-300 bg-orange-50/40 p-4 mt-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="inline-flex items-center gap-2">
          <FileText className="w-4 h-4 text-orange-700" />
          <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-orange-900">
            Cash Corrections Log
          </h3>
          <span className="font-mono text-xs text-black/55">
            ({corrections.length} total{downwardCount > 0 && `, ${downwardCount} downward = ${formatCents(downwardTotal)}`})
          </span>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="font-mono text-[11px] uppercase tracking-wider text-black/60 hover:text-black inline-flex items-center gap-1"
        >
          {collapsed ? (<><ChevronDown className="w-3 h-3" /> Show</>) : (<><ChevronUp className="w-3 h-3" /> Hide</>)}
        </button>
      </div>

      {!collapsed && (
        <ul className="space-y-2">
          {corrections.map((c) => {
            const isDown = c.delta_cents < 0;
            return (
              <li key={c.id} className={`border-2 p-3 bg-white ${isDown ? 'border-orange-400' : 'border-black/15'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-bold text-sm">
                        {c.booking_customer_name || '(deleted booking)'}
                      </span>
                      {c.booking_room && (
                        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-black/20">
                          {c.booking_room}
                        </span>
                      )}
                      {c.booking_engineer && (
                        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-black/20">
                          {c.booking_engineer}
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-[11px] text-black/60">
                      Session: {fmtSessionDateTime(c.booking_start_time, { year: 'numeric', minute: '2-digit' })}
                    </p>
                    <p className="font-mono text-[11px] text-black/55 mt-0.5">
                      Corrected by <strong className="text-black">{c.corrected_by_email}</strong>
                      {' '}({c.corrected_by_role}) on {fmtStampDateTime(c.created_at, { year: 'numeric', minute: '2-digit' })}
                    </p>
                    <div className="bg-black/[0.03] border-l-2 border-black/30 px-2.5 py-1.5 mt-2">
                      <p className="font-mono text-[11px] text-black/70 whitespace-pre-wrap">
                        <span className="text-black/45 uppercase text-[9px] tracking-wider mr-1">Reason:</span>
                        {c.reason}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="font-mono text-[10px] text-black/55">
                      {formatCents(c.previous_total_cents)} → <strong className="text-black">{formatCents(c.new_total_cents)}</strong>
                    </div>
                    <div className={`font-mono text-sm font-bold inline-flex items-center gap-1 mt-1 ${isDown ? 'text-orange-700' : 'text-green-700'}`}>
                      {isDown ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
                      {formatCents(Math.abs(c.delta_cents))}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
