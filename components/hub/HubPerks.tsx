'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

// components/hub/HubPerks.tsx
//
// Customer-facing "Perks / Rewards" surface for the Artist Hub. Self-fetches
// GET /api/hub/rewards and renders the customer's progress toward the reward
// ladders (lib/rewards REWARD_RULES) plus the rewards they've already earned.
//
// Two flavors of progress are shown:
//   • Studio loyalty — by completed studio hours this calendar year. Horizontal
//     progress bar toward the NEXT unreached rung, then the full rung list with
//     reached/locked state.
//   • Spend loyalty — by $ spent this calendar year. Shows the current standing
//     discount tier and the next tier threshold.
// Then a "Your rewards" list of earned grants (pending / ready / used). Bands
// the user belongs to get their own mirrored progress + grants section.
//
// All values are intentionally VISIBLE — the whole point is showing customers
// how close they are to the next reward.

import { useEffect, useState } from 'react';
import {
  Loader2,
  Gift,
  Clock,
  DollarSign,
  Trophy,
  Lock,
  CheckCircle2,
  Users,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { REWARD_RULES, type RewardRule } from '@/lib/rewards';

// ───────────────────────── types (mirror the API shape) ─────────────────────────

interface Counters {
  studio_hours: number;
  dollars_spent: number; // CENTS
}

interface Grant {
  id: string;
  rule_key: string;
  track: string;
  counter: string;
  period_key: string;
  reward_type: string;
  reward_value: number;
  value_cents: number;
  status: string;
  counter_value: number;
  threshold: number;
  expires_at: string | null;
  owner_user_id: string | null;
  owner_band_id: string | null;
  metadata: any;
}

interface BandCounters {
  band_hours: number;
  band_spend: number; // CENTS
}

interface Band {
  id: string;
  name: string;
  counters: BandCounters;
}

interface RewardsPayload {
  counters: Counters;
  grants: Grant[];
  bands: Band[];
  bandGrants: Grant[];
}

// ───────────────────────── helpers ─────────────────────────

const fmtCents = (c: number) => `$${(c / 100).toFixed(0)}`;

/** Short date for expiries: "Jul 4, 2026". */
function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const HOUR_RULES = REWARD_RULES
  .filter((r) => r.track === 'customer' && r.counter === 'studio_hours')
  .sort((a, b) => a.threshold - b.threshold);

const SPEND_RULES = REWARD_RULES
  .filter((r) => r.track === 'customer' && r.counter === 'dollars_spent')
  .sort((a, b) => a.threshold - b.threshold);

const BAND_HOUR_RULES = REWARD_RULES
  .filter((r) => r.track === 'band' && r.counter === 'band_hours')
  .sort((a, b) => a.threshold - b.threshold);

const BAND_SPEND_RULES = REWARD_RULES
  .filter((r) => r.track === 'band' && r.counter === 'band_spend')
  .sort((a, b) => a.threshold - b.threshold);

// ───────────────────────── progress bar ─────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 bg-black/10 overflow-hidden">
      <div
        className={`h-full ${clamped >= 100 ? 'bg-black/40' : 'bg-accent'}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// ───────────────────────── studio-hours loyalty card ─────────────────────────

function HoursCard({
  hours,
  rules,
  title,
  subtitle,
}: {
  hours: number;
  rules: RewardRule[];
  title: string;
  subtitle: string;
}) {
  if (rules.length === 0) return null;

  // Next rung not yet reached (threshold strictly greater than current hours).
  const next = rules.find((r) => r.threshold > hours) ?? null;
  const prevThreshold = next
    ? [...rules].filter((r) => r.threshold <= hours).reduce((m, r) => Math.max(m, r.threshold), 0)
    : 0;
  const span = next ? next.threshold - prevThreshold : 0;
  const pct = next
    ? span > 0
      ? Math.round(((hours - prevThreshold) / span) * 100)
      : 0
    : 100;

  return (
    <div className="border-2 border-black/10 p-5">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-accent" />
        <p className="font-mono text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
          {title}
        </p>
      </div>

      <p className="font-mono text-3xl font-bold mb-1">
        {hours.toFixed(1)} <span className="text-base font-bold text-black/50">hrs this year</span>
      </p>
      <p className="font-mono text-xs text-black/60 mb-4">{subtitle}</p>

      {/* Progress to the next rung */}
      {next ? (
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="font-mono text-[11px] text-black/60 truncate">Next: {next.label}</span>
            <span className="font-mono text-[10px] font-bold text-black/45 shrink-0">
              {hours.toFixed(1)}/{next.threshold} hrs
            </span>
          </div>
          <ProgressBar pct={pct} />
        </div>
      ) : (
        <div className="mb-4 inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-accent">
          <Sparkles className="w-3.5 h-3.5" />
          Top tier reached
        </div>
      )}

      {/* Rung list */}
      <ul className="space-y-1.5 pt-3 border-t border-black/10">
        {rules.map((r) => {
          const reached = hours >= r.threshold;
          return (
            <li key={r.rule_key} className="flex items-start justify-between gap-2">
              <div className="inline-flex items-start gap-1.5 min-w-0">
                {reached ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-black/30 shrink-0 mt-0.5" />
                )}
                <span
                  className={`font-mono text-[11px] leading-tight ${
                    reached ? 'text-black' : 'text-black/45'
                  }`}
                >
                  {r.label}
                </span>
              </div>
              <span className="font-mono text-[10px] font-bold text-black/40 shrink-0">
                {r.threshold}h
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ───────────────────────── spend loyalty card ─────────────────────────

function SpendCard({
  spentCents,
  rules,
  title,
  subtitle,
}: {
  spentCents: number;
  rules: RewardRule[];
  title: string;
  subtitle: string;
}) {
  if (rules.length === 0) return null;

  // Current tier = highest reached rule; next tier = first unreached.
  const reachedRules = rules.filter((r) => spentCents >= r.threshold);
  const current = reachedRules.length ? reachedRules[reachedRules.length - 1] : null;
  const next = rules.find((r) => r.threshold > spentCents) ?? null;

  const prevThreshold = current ? current.threshold : 0;
  const span = next ? next.threshold - prevThreshold : 0;
  const pct = next ? (span > 0 ? Math.round(((spentCents - prevThreshold) / span) * 100) : 0) : 100;

  return (
    <div className="border-2 border-black/10 p-5">
      <div className="flex items-center gap-2 mb-2">
        <DollarSign className="w-4 h-4 text-accent" />
        <p className="font-mono text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
          {title}
        </p>
      </div>

      <p className="font-mono text-3xl font-bold mb-1">
        {fmtCents(spentCents)}{' '}
        <span className="text-base font-bold text-black/50">this year</span>
      </p>
      <p className="font-mono text-xs text-black/60 mb-4">{subtitle}</p>

      {/* Current standing discount */}
      <div className="flex items-center gap-2 mb-4">
        {current ? (
          <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 bg-accent text-black font-bold inline-flex items-center gap-1">
            <Trophy className="w-3 h-3" />
            {current.reward_value}% off — current tier
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 border border-black/20 text-black/50 font-bold">
            No tier yet
          </span>
        )}
      </div>

      {/* Progress to next tier */}
      {next ? (
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="font-mono text-[11px] text-black/60 truncate">
              Next: {next.reward_value}% off at {fmtCents(next.threshold)}
            </span>
            <span className="font-mono text-[10px] font-bold text-black/45 shrink-0">
              {fmtCents(spentCents)}/{fmtCents(next.threshold)}
            </span>
          </div>
          <ProgressBar pct={pct} />
        </div>
      ) : (
        <div className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-accent">
          <Sparkles className="w-3.5 h-3.5" />
          Top tier reached
        </div>
      )}
    </div>
  );
}

// ───────────────────────── grant status badge ─────────────────────────

function GrantBadge({ grant }: { grant: Grant }) {
  const status = grant.status;

  if (status === 'pending_approval') {
    return (
      <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 font-bold inline-flex items-center gap-1">
        <Loader2 className="w-2.5 h-2.5" />
        Pending review
      </span>
    );
  }

  if (status === 'approved' || status === 'issued') {
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
        <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-green-100 text-green-800 border border-green-300 font-bold inline-flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5" />
          Ready
        </span>
        {grant.expires_at && (
          <span className="font-mono text-[9px] text-black/45">expires {fmtDate(grant.expires_at)}</span>
        )}
      </span>
    );
  }

  if (status === 'redeemed') {
    return (
      <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-black/10 text-black/50 font-bold">
        Used
      </span>
    );
  }

  // denied (and any unknown status) is hidden by the caller.
  return null;
}

// ───────────────────────── grants list ─────────────────────────

function GrantsList({ grants, heading }: { grants: Grant[]; heading: string }) {
  // denied grants are hidden entirely.
  const visible = grants.filter((g) => g.status !== 'denied');

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Gift className="w-4 h-4 text-accent" />
        <p className="font-mono text-xs font-semibold tracking-[0.2em] uppercase text-black/60">
          {heading}
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="font-mono text-xs text-black/50 border-2 border-black/10 p-4">
          No rewards yet — book studio time to start earning.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((g) => (
            <li
              key={g.id}
              className="flex items-center justify-between gap-3 border-2 border-black/10 px-4 py-3"
            >
              <p className="font-mono text-sm font-bold min-w-0 truncate">
                {(g.metadata?.label as string) || g.rule_key}
              </p>
              <div className="shrink-0">
                <GrantBadge grant={g} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────── main ─────────────────────────

export default function HubPerks() {
  const [data, setData] = useState<RewardsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/hub/rewards', { cache: 'no-store' });
        if (!res.ok) {
          if (active) setError('Could not load rewards.');
          return;
        }
        const body = (await res.json()) as RewardsPayload;
        if (active) setData(body);
      } catch {
        if (active) setError('Network error.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Loading
  if (!data && !error) {
    return (
      <div className="flex items-center gap-2 font-mono text-sm text-black/50 py-12 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading your perks…
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-2 border-red-300 bg-red-50 p-3 inline-flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-red-700" />
        <p className="font-mono text-sm text-red-900">{error}</p>
      </div>
    );
  }

  const payload = data as RewardsPayload;
  const counters = payload.counters ?? { studio_hours: 0, dollars_spent: 0 };
  const grants = payload.grants ?? [];
  const bands = payload.bands ?? [];
  const bandGrants = payload.bandGrants ?? [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-heading-md flex items-center gap-3">
          <Gift className="w-6 h-6 text-accent" />
          PERKS
        </h2>
        <p className="font-mono text-sm text-black/60 mt-1">
          Book studio time and spend with us to climb the reward ladder. Earn free sessions, free
          media, and standing discounts — automatically.
        </p>
      </div>

      {/* Personal progress */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HoursCard
          hours={counters.studio_hours}
          rules={HOUR_RULES}
          title="Studio Loyalty"
          subtitle="Completed studio hours this calendar year. Each rung unlocks a reward."
        />
        <SpendCard
          spentCents={counters.dollars_spent}
          rules={SPEND_RULES}
          title="Spend Loyalty"
          subtitle="Total spend this calendar year. Hit a tier for a standing discount."
        />
      </div>

      {/* Earned rewards */}
      <GrantsList grants={grants} heading="Your Rewards" />

      {/* Band perks */}
      {bands.length > 0 && (
        <div className="space-y-6 pt-2">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-accent" />
            <h3 className="font-mono text-sm font-bold uppercase tracking-wider">Band Perks</h3>
          </div>

          {bands.map((band) => {
            const theirGrants = bandGrants.filter((g) => g.owner_band_id === band.id);
            return (
              <div key={band.id} className="border-2 border-accent/40 bg-accent/5 p-5 space-y-6">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-accent text-black font-bold inline-flex items-center gap-1">
                    <Users className="w-2.5 h-2.5" />
                    {band.name}
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <HoursCard
                    hours={band.counters.band_hours}
                    rules={BAND_HOUR_RULES}
                    title="Band Studio Loyalty"
                    subtitle="Completed band studio hours this calendar year."
                  />
                  <SpendCard
                    spentCents={band.counters.band_spend}
                    rules={BAND_SPEND_RULES}
                    title="Band Spend Loyalty"
                    subtitle="Total band spend this calendar year."
                  />
                </div>

                <GrantsList grants={theirGrants} heading={`${band.name} Rewards`} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
