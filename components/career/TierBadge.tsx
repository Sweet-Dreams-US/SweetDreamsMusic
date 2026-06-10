// components/career/TierBadge.tsx — the listener-tier certification chip.
// Numeric naming only ("50K Club"). Renders next to artist names anywhere
// (public profile, hub, and DreamSuite Charts when that surface ships).

import { Headphones } from 'lucide-react';
import { tierLabel } from '@/lib/career';

export default function TierBadge({ tier, size = 'sm' }: { tier: number | null | undefined; size?: 'sm' | 'md' }) {
  if (!tier) return null;
  const big = tier >= 1_000_000;
  return (
    <span className={`inline-flex items-center gap-1 font-mono font-bold uppercase tracking-wider px-2 ${
      size === 'md' ? 'text-xs py-1' : 'text-[10px] py-0.5'
    } ${big ? 'bg-accent text-black' : 'bg-accent/15 text-accent border border-accent/40'}`}
      title={`Verified ${tier.toLocaleString()}+ monthly listeners — permanent certification`}>
      <Headphones className={size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
      {tierLabel(tier)}
    </span>
  );
}
