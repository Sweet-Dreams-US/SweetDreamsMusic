// components/dashboard/ActiveProjectsPanel.tsx
//
// Presentational panel listing the artist's SIGNED, in-progress media projects.
// Sibling to ContractsToSignBanner: that one surfaces contracts still awaiting a
// signature (accent border, loudest); this one keeps a signed/active project
// EASY TO FIND afterward — once signed it drops off the "to sign" banner and was
// previously only reachable by digging through the media orders list. Each card
// links to the order page to review the contract and pay any balance. Uses a
// neutral border (vs the sign-banner's accent border) so the "to sign" prompt
// still stands out most. Renders null when there's nothing to show.

import Link from 'next/link';
import { FolderOpen, ArrowRight, CheckCircle2 } from 'lucide-react';
import { formatCents } from '@/lib/utils';

export interface ActiveProject {
  id: string;
  offering_title: string;
  status: string;
  total_cents: number;
  paid_cents: number;
  remaining_cents: number;
}

function statusLabel(status: string): string {
  return status
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export default function ActiveProjectsPanel({
  projects,
}: {
  projects: ActiveProject[];
}) {
  if (!projects || projects.length === 0) return null;
  return (
    <div className="border-2 border-black/10 bg-white p-5 mb-6">
      <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 mb-3">
        <FolderOpen className="w-4 h-4 text-accent" />
        Your media projects
      </h3>
      <div className="space-y-2">
        {projects.map((p) => {
          const hasBalance = p.remaining_cents > 0;
          return (
            <Link
              key={p.id}
              href={`/dashboard/media/orders/${p.id}`}
              className="flex items-center justify-between gap-3 border-2 border-black/10 bg-white p-3 hover:border-accent transition-colors no-underline text-black group"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="font-mono text-sm font-bold truncate">{p.offering_title}</p>
                  <span className="font-mono text-[9px] font-bold uppercase tracking-wider bg-black/5 text-black/60 px-1.5 py-0.5 shrink-0">
                    {statusLabel(p.status)}
                  </span>
                </div>
                <p className="font-mono text-[11px] text-black/50 mt-0.5 inline-flex items-center gap-1">
                  {hasBalance ? (
                    <>Balance: {formatCents(p.remaining_cents)}</>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-accent" />
                      Paid in full
                    </>
                  )}
                </p>
              </div>
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider bg-black text-white px-3 py-1.5 inline-flex items-center gap-1 shrink-0 group-hover:bg-accent group-hover:text-black transition-colors">
                {hasBalance ? 'View contract & pay' : 'View project'}
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-200" />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
