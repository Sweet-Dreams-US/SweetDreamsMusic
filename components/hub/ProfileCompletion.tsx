'use client';

// components/hub/ProfileCompletion.tsx
//
// The visible "Complete your profile" workflow for the Artist Hub. Self-fetches
// GET /api/hub/profile-completion (which calls computeProfileCompletion in
// lib/profile-completion.ts — the single source of truth) and renders:
//   • a progress bar + percent,
//   • each required item as a checklist row with done/not state and a one-click
//     action to fix it (deep-link to the profile editor / platform connections),
//   • the carrot up top: "Complete your profile -> 1 free studio hour",
//   • a celebratory done state once every item is satisfied.
//
// Items map to two fix destinations:
//   • social_links -> the Metrics tab (where "Connect Platforms" lives), via the
//     onNavigate callback the Hub passes down.
//   • everything else (display name, photos, bio, genres) -> /dashboard/profile,
//     the ProfileEditor.
//
// The component renders nothing until it has data, and (by default) collapses
// itself once the profile is complete so a finished artist isn't nagged — pass
// `showWhenComplete` to keep the celebratory state visible (used on Perks).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  CheckCircle2,
  Circle,
  ArrowRight,
  Gift,
} from 'lucide-react';
import type { ProfileCompletionResult } from '@/lib/profile-completion';

interface ProfileCompletionProps {
  /** Navigate to a Hub tab (used to deep-link social links -> Metrics). */
  onNavigate?: (tab: string) => void;
  /**
   * When true, keep rendering the celebratory done state after completion.
   * Default false: the card removes itself once complete (Overview mount, so a
   * finished artist isn't nagged).
   */
  showWhenComplete?: boolean;
}

// Which items are fixed where. social_links lives on the Metrics tab; all the
// rest live in the profile editor.
const SOCIAL_LINKS_KEY = 'social_links';

export default function ProfileCompletion({
  onNavigate,
  showWhenComplete = false,
}: ProfileCompletionProps) {
  const [data, setData] = useState<ProfileCompletionResult | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/hub/profile-completion', { cache: 'no-store' });
        if (!res.ok) {
          if (active) setError(true);
          return;
        }
        const body = (await res.json()) as ProfileCompletionResult;
        if (active) setData(body);
      } catch {
        if (active) setError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Render nothing on error or before data — this is an additive nudge, never a
  // blocker, so a failed/loading fetch should just be invisible.
  if (error || !data) return null;

  // Complete + caller doesn't want the done state => collapse entirely.
  if (data.complete && !showWhenComplete) return null;

  // ── Celebratory done state ──
  if (data.complete) {
    return (
      <div className="border-2 border-accent bg-accent/5 p-5">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-accent" /> Profile Complete
        </h3>
        <p className="font-mono text-sm font-bold mb-1">
          Your free hour is on the way — pending approval.
        </p>
        <p className="font-mono text-xs text-black/60">
          Nice work — every part of your profile is filled in. Look for your
          free studio hour in Perks once it&apos;s approved.
        </p>
      </div>
    );
  }

  // ── Incomplete: carrot + progress + checklist ──
  return (
    <div className="border-2 border-accent p-5">
      {/* Carrot */}
      <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 mb-1">
        <Gift className="w-4 h-4 text-accent" /> Complete your profile
        <span className="text-accent">→ 1 free studio hour</span>
      </h3>
      <p className="font-mono text-xs text-black/60 mb-4">
        Finish every item below to earn a free studio hour (pending approval).
      </p>

      {/* Progress */}
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-black/40">
          {data.requiredDone} of {data.requiredTotal} complete
        </span>
        <span className="font-mono text-[10px] font-bold text-accent">
          {data.percent}%
        </span>
      </div>
      <div className="h-2 bg-black/10 mb-4 overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-500"
          style={{ width: `${data.percent}%` }}
        />
      </div>

      {/* Checklist */}
      <ul className="space-y-2">
        {data.items.map((item) => {
          const goesToMetrics = item.key === SOCIAL_LINKS_KEY;
          const actionLabel = item.done ? 'Edit' : 'Fix';

          // Done rows still get a (muted) action so the artist can revisit.
          const action = goesToMetrics ? (
            <button
              type="button"
              onClick={() => onNavigate?.('metrics')}
              className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent inline-flex items-center gap-1 hover:underline transition-colors duration-200 shrink-0"
            >
              {actionLabel} <ArrowRight className="w-3 h-3" />
            </button>
          ) : (
            <Link
              href="/dashboard/profile"
              className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent inline-flex items-center gap-1 hover:underline transition-colors duration-200 shrink-0"
            >
              {actionLabel} <ArrowRight className="w-3 h-3" />
            </Link>
          );

          return (
            <li key={item.key} className="flex items-center gap-2">
              {item.done ? (
                <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-black/20 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p
                  className={`font-mono text-sm font-semibold truncate ${
                    item.done ? 'text-black/40 line-through' : ''
                  }`}
                >
                  {item.label}
                </p>
                {!item.done && (
                  <p className="font-mono text-[10px] text-black/40 truncate">
                    {item.requirementText}
                  </p>
                )}
              </div>
              {action}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
