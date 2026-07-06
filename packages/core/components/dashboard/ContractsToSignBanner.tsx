// components/dashboard/ContractsToSignBanner.tsx
//
// Presentational banner listing media contracts awaiting THIS user's signature.
// Rendered on BOTH the main /dashboard (server component) and the Artist Hub
// overview (client component) from ONE source so the two surfaces can never
// drift. Each row links to the order page where the artist reviews, signs, and
// pays. Renders null when there's nothing to sign.

import Link from 'next/link';
import { FileSignature, ArrowRight } from 'lucide-react';
import { formatCents } from '@/lib/utils';

export interface AwaitingContract {
  id: string;
  offering_id: string;
  offering_title: string;
  final_price_cents: number;
}

export default function ContractsToSignBanner({
  contracts,
}: {
  contracts: AwaitingContract[];
}) {
  if (!contracts || contracts.length === 0) return null;
  return (
    <div className="border-2 border-accent bg-accent/10 p-5 mb-6">
      <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 mb-3">
        <FileSignature className="w-4 h-4 text-accent" />
        {contracts.length === 1
          ? 'You have a contract to sign'
          : `You have ${contracts.length} contracts to sign`}
      </h3>
      <div className="space-y-2">
        {contracts.map((c) => (
          <Link
            key={c.id}
            href={`/dashboard/media/orders/${c.id}`}
            className="flex items-center justify-between gap-3 border-2 border-black/10 bg-white p-3 hover:border-accent transition-colors no-underline text-black group"
          >
            <div className="min-w-0">
              <p className="font-mono text-sm font-bold truncate">{c.offering_title}</p>
              <p className="font-mono text-[11px] text-black/50">
                {c.final_price_cents > 0 ? formatCents(c.final_price_cents) : 'No payment yet'}
                {' · Awaiting your signature'}
              </p>
            </div>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider bg-accent text-black px-3 py-1.5 inline-flex items-center gap-1 shrink-0">
              Review &amp; sign
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-200" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
