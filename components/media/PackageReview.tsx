'use client';

// components/media/PackageReview.tsx
//
// Round 8c: buyer-side view of the proposed package. Shown on
// /dashboard/media/orders/[id] when a package exists in 'sent' or
// 'approved' state. Hidden during 'draft' (admin still building).
//
// Per-line "Approve" buttons; clicking one fires
//   POST /api/media/bookings/[id]/package/line-items/[lineId]/approve
// When all line items are approved the parent package flips to
// 'approved' on the server + the booking moves deposited → scheduled.
// "Suggest changes" just routes the buyer to the chat thread (no
// dedicated endpoint — the chat is the negotiation surface per Cole's
// spec).

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, MessageCircle, Download, PackageCheck } from 'lucide-react';
import { formatCents } from '@/lib/utils';
import { fmtStampDate } from '@/lib/studio-time';
import {
  type LineItem,
  type Package,
  LINE_ITEM_KIND_LABELS,
  type LineItemKind,
} from '@/lib/media-packages';
import SessionScheduler from './SessionScheduler';

interface Props {
  bookingId: string;
}

export default function PackageReview({ bookingId }: Props) {
  const [pkg, setPkg] = useState<Package | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/media/bookings/${bookingId}/package`, { cache: 'no-store' });
      if (!res.ok) {
        setLoading(false);
        return;
      }
      const data = await res.json();
      setPkg(data.package);
      setItems(data.line_items as LineItem[]);
    } catch { /* hide on error — buyer doesn't need to see this surface */ }
    finally { setLoading(false); }
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);

  const approve = async (lineId: string) => {
    setApproving(lineId);
    setError(null);
    try {
      const res = await fetch(
        `/api/media/bookings/${bookingId}/package/line-items/${lineId}/approve`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Approval failed.');
      } else {
        await load();
      }
    } catch {
      setError('Network error approving.');
    } finally {
      setApproving(null);
    }
  };

  // Hide entirely if no package or still in draft
  if (loading) return null;
  if (!pkg) return null;
  if (pkg.status === 'draft') return null;

  const approvedCount = items.filter((it) => it.approval_status === 'approved').length;
  const isFullyApproved = pkg.status === 'approved';

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-3">
        Proposed package
      </p>
      <div className="border-2 border-black bg-white">
        <div className="bg-black text-white px-4 py-3 flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-white/60">
              {isFullyApproved ? 'Approved on ' : 'Sent on '}
              {fmtStampDate(pkg.approved_at ?? pkg.proposed_at)}
            </p>
            <p className="font-mono text-base font-bold mt-0.5">
              {isFullyApproved ? '✓ Package locked — production unblocked' : `${approvedCount} of ${items.length} approved`}
            </p>
          </div>
          <p className="font-mono text-xl font-bold tabular-nums">
            {formatCents(pkg.total_cents)}
          </p>
        </div>

        {pkg.notes && (
          <div className="bg-black/[0.03] border-b border-black/10 p-4">
            <p className="text-sm whitespace-pre-wrap text-black/85">{pkg.notes}</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border-b border-red-200 text-red-900 font-mono text-xs px-4 py-2">
            {error}
          </div>
        )}

        <ul className="divide-y divide-black/10">
          {items.map((it) => {
            const isApproved = it.approval_status === 'approved';
            return (
              <li key={it.id} className="px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="font-bold text-sm">{it.label}</p>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-black/50">
                        {LINE_ITEM_KIND_LABELS[it.kind as LineItemKind] ?? it.kind}
                      </span>
                      {it.qty > 1 && (
                        <span className="font-mono text-[10px] text-black/50">×{it.qty}</span>
                      )}
                    </div>
                    {it.notes && (
                      <p className="text-xs text-black/65 mt-0.5">{it.notes}</p>
                    )}
                    <p className="font-mono text-xs text-black/60 mt-1">
                      {formatCents(it.total_cents)}
                    </p>
                    {/* Round 8e: production status + Drive download */}
                    {it.completed && (
                      <div className="mt-2 inline-flex flex-wrap items-center gap-2 bg-green-50 border border-green-200 px-2 py-1">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-green-900 font-bold inline-flex items-center gap-1">
                          <PackageCheck className="w-3 h-3" />
                          Delivered
                          {it.completed_at && (
                            <span className="font-normal text-green-700">
                              {' '}· {fmtStampDate(it.completed_at, { year: undefined })}
                            </span>
                          )}
                        </span>
                        {it.drive_url && (
                          <a
                            href={it.drive_url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[10px] uppercase tracking-wider text-accent hover:underline inline-flex items-center gap-0.5"
                          >
                            <Download className="w-3 h-3" />
                            download
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    {isApproved ? (
                      <span className="font-mono text-[11px] uppercase tracking-wider text-green-700 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Approved
                      </span>
                    ) : (
                      <button
                        onClick={() => approve(it.id)}
                        disabled={approving === it.id || isFullyApproved}
                        className="bg-black text-white font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 hover:bg-accent hover:text-black transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        {approving === it.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3" />
                        )}
                        Approve
                      </button>
                    )}
                  </div>
                </div>
                {/* Round 8d: per-line-item scheduling. Buyer can propose
                    dates here; admin approves or counter-proposes via the
                    same component on their side. */}
                <SessionScheduler
                  bookingId={bookingId}
                  lineId={it.id}
                  lineLabel={it.label}
                  defaultKind={defaultSessionKindFor(it.kind as LineItemKind)}
                />
              </li>
            );
          })}
        </ul>

        {!isFullyApproved && (
          <div className="border-t-2 border-black/10 p-4 bg-black/[0.02] flex items-center gap-2 text-sm">
            <MessageCircle className="w-4 h-4 text-black/50 shrink-0" />
            <p className="text-black/65">
              Need changes on a line item?{' '}
              <a href="#conversation" className="font-bold underline hover:text-accent">
                Use the conversation below
              </a>{' '}
              — Cole or Jay will revise and re-send.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Map LineItemKind → default session_kind suggestion in the SessionScheduler
// proposal form. Saves a click in the common case.
function defaultSessionKindFor(kind: LineItemKind): string {
  switch (kind) {
    case 'planning_call': return 'planning_call';
    case 'cover_art': return 'design_meeting';
    case 'shorts': return 'filming_external';
    case 'music_video': return 'filming_external';
    case 'photo_session': return 'photo_shoot';
    case 'filming_external': return 'filming_external';
    case 'mixing_session': return 'mixing_session';
    case 'design_meeting': return 'design_meeting';
    case 'recording_session': return 'recording_session';
    default: return 'other';
  }
}
