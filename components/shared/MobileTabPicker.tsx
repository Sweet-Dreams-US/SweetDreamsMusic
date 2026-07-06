'use client';

// components/shared/MobileTabPicker.tsx — compact mobile tab switcher.
//
// Replaces the old mobile pattern (a flex-wrap grid of 12–19 chip buttons that
// ate half the screen before any content showed). Collapsed it is ONE row: the
// current tab + a "N more" hint. Tapping opens a 2-column panel of every tab.
// Desktop keeps its sidebars — this renders only where the caller mounts it
// (inside an lg:hidden wrapper).

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

export interface MobileTab {
  key: string;
  label: string;
  icon: LucideIcon;
}

export default function MobileTabPicker({
  tabs,
  value,
  onChange,
}: {
  tabs: MobileTab[];
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside tap so the panel never traps the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const current = tabs.find((t) => t.key === value) ?? tabs[0];
  if (!current) return null;
  const CurrentIcon = current.icon;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full flex items-center justify-between gap-2 bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 rounded"
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <CurrentIcon className="w-4 h-4 shrink-0" />
          <span className="truncate">{current.label}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-white/50 font-medium normal-case tracking-normal shrink-0">
          {tabs.length - 1} more
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 inset-x-0 bg-white border-2 border-black shadow-xl p-1.5 grid grid-cols-2 gap-1 max-h-[60vh] overflow-y-auto"
        >
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = t.key === value;
            return (
              <button
                key={t.key}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChange(t.key); setOpen(false); }}
                className={`text-left font-mono text-[11px] font-bold uppercase tracking-wider px-3 py-2.5 rounded inline-flex items-center gap-2 ${
                  active ? 'bg-black text-white' : 'text-black/60 hover:bg-black/5'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
