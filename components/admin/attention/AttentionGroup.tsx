'use client';

import { useState } from 'react';
import type { AttentionGroupData, AttentionCategoryData, AdminTab } from './types';
import AttentionRow from './AttentionRow';

/** How many rows of a category show before the "show all" expander. */
const VISIBLE_LIMIT = 5;

function CategoryBlock({
  category,
  onNavigate,
}: {
  category: AttentionCategoryData;
  onNavigate: (tab: AdminTab) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? category.items : category.items.slice(0, VISIBLE_LIMIT);
  const hidden = category.items.length - visible.length;

  return (
    <div className="py-1">
      <div className="flex items-baseline gap-2 px-4 pt-2 pb-1">
        <span className="font-mono text-xs font-bold uppercase tracking-wider text-black/70">
          {category.label}
        </span>
        <span className="font-mono text-[10px] text-black/40">{category.total}</span>
      </div>
      <div className="divide-y divide-black/5">
        {visible.map((item) => (
          <AttentionRow key={item.id} item={item} onClick={() => onNavigate(category.tab)} />
        ))}
      </div>
      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="font-mono text-[11px] uppercase tracking-wider text-black/45 hover:text-black px-4 py-2 transition-colors"
        >
          Show all {category.items.length} &rarr;
        </button>
      )}
    </div>
  );
}

/** One bucket — header + per-category sub-lists, or an "all clear" line. */
export default function AttentionGroup({
  group,
  onNavigate,
}: {
  group: AttentionGroupData;
  onNavigate: (tab: AdminTab) => void;
}) {
  if (group.categories.length === 0) {
    return (
      <div className="border-2 border-black/10 px-4 py-3 flex items-center gap-3">
        <span className="font-mono text-sm font-bold uppercase tracking-wider text-black/40">
          {group.label}
        </span>
        <span className="font-mono text-xs text-green-700">&#10003; all clear</span>
      </div>
    );
  }

  return (
    <div className="border-2 border-black/10">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-black/[0.02] border-b-2 border-black/10">
        <span className="font-mono text-sm font-bold uppercase tracking-wider">{group.label}</span>
        <span className="font-mono text-xs text-black/40">({group.count})</span>
      </div>
      <div className="divide-y-2 divide-black/5">
        {group.categories.map((c) => (
          <CategoryBlock key={c.key} category={c} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}
