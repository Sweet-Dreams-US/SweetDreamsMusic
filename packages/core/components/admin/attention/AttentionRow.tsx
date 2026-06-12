'use client';

import { ChevronRight } from 'lucide-react';
import type { AttentionItem } from './types';

/** One actionable row. The whole row is a button that deep-links to a tab. */
export default function AttentionRow({
  item,
  onClick,
}: {
  item: AttentionItem;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center justify-between gap-3 px-4 py-3 border-l-2 transition-colors hover:bg-black/[0.03] ${
        item.flagged ? 'border-red-500 bg-red-50/50' : 'border-transparent'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm font-semibold truncate">{item.primary}</p>
        {item.secondary && (
          <p className="font-mono text-xs text-black/45 truncate">{item.secondary}</p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-black/30 shrink-0" />
    </button>
  );
}
