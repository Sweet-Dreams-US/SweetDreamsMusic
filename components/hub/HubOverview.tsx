'use client';

// HubOverview — career-first overview (Plan 6 §7).
// Top: Next Steps strip (replaces the old welcome block + per-card empty
// prompts) → This Week verified deltas (deltas, never totals) → then the
// lg:grid-cols-2 card grid: Stage, Tier, Goals, Projects, Sessions, Events,
// Achievements — every grid card renders ONLY when it has content.

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Folder, Target, Calendar, Award, ChevronRight, ArrowRight, Music,
  TrendingUp, Zap, X, Milestone, Headphones, CheckCircle2, Circle,
} from 'lucide-react';
import { PROJECT_PHASES } from '@/lib/hub-constants';
import { formatDuration } from '@/lib/utils';
import { fmtSessionDate } from '@/lib/studio-time';
import { ACHIEVEMENTS } from '@/lib/achievements';
import { tierLabel } from '@/lib/career';
import TierBadge from '@/components/career/TierBadge';
import { SkeletonList } from './LoadingSkeleton';
import ActivePackages from './ActivePackages';

interface NextStep {
  id: string;
  priority: number;
  message: string;
  href: string;
  dismissible: boolean;
}

interface StageGate {
  key: string;
  title: string;
  verifyType: string;
  status: 'complete' | 'pending';
  xp: number;
}

interface WeekDelta {
  platform: string;
  metric: string;
  delta: number;
  current: number;
}

interface CareerData {
  nextSteps: NextStep[];
  stage: number;
  stageLabel: string;
  stageGates: StageGate[];
  highestTier: number | null;
  nextTier: number | null;
  currentListeners: number | null;
  weekDeltas: WeekDelta[];
  lastUpdated: string | null;
}

interface OverviewData {
  projects: { id: string; title: string; project_type: string; current_phase: string; target_release_date: string | null; status: string; cover_image_url: string | null }[];
  goals: { id: string; title: string; category: string; target_value: number | null; current_value: number; target_date: string | null; status: string; linked_platform?: string | null }[];
  latestMetrics: Record<string, { platform: string; followers: number | null; monthly_listeners: number | null; subscribers: number | null; metric_date: string }>;
  achievements: { achievement_key: string; unlocked_at: string }[];
  upcomingSessions: { id: string; start_time: string; duration: number; room: string | null; status: string; engineer_name: string | null }[];
  completedSessions: { id: string; start_time: string; duration: number; room: string | null; status: string; engineer_name: string | null }[];
  upcomingEvents: { id: string; title: string; event_type: string; event_date: string; event_time: string | null; color: string }[];
  career: CareerData | null;
}

interface HubOverviewProps {
  onXpEarned?: () => void;
  onNavigate?: (tab: string) => void;
}

const DISMISS_PREFIX = 'career_dismissed_';

function deltaMetricWord(metric: string): string {
  if (metric === 'monthly_listeners') return 'listeners';
  if (metric === 'subscribers') return 'subs';
  return 'followers';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function HubOverview({ onXpEarned: _onXpEarned, onNavigate }: HubOverviewProps) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/hub/overview')
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  // Hydration-safe: localStorage only after mount, once steps are known.
  useEffect(() => {
    if (!data?.career?.nextSteps?.length) return;
    const d = new Set<string>();
    for (const s of data.career.nextSteps) {
      try {
        if (localStorage.getItem(`${DISMISS_PREFIX}${s.id}`)) d.add(s.id);
      } catch { /* storage unavailable — show everything */ }
    }
    setDismissed(d);
  }, [data]);

  function dismissStep(id: string) {
    try { localStorage.setItem(`${DISMISS_PREFIX}${id}`, '1'); } catch { /* best-effort */ }
    setDismissed((prev) => new Set(prev).add(id));
  }

  if (loading) {
    return (
      <div>
        <h2 className="text-heading-md mb-6">OVERVIEW</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SkeletonList count={4} />
        </div>
      </div>
    );
  }

  if (!data) return null;

  function daysUntil(date: string) {
    return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
  }

  const career = data.career;
  const visibleSteps = (career?.nextSteps ?? []).filter((s) => !dismissed.has(s.id)).slice(0, 3);
  const weekDeltas = career?.weekDeltas ?? [];
  const stageGates = career?.stageGates ?? [];
  const gatesDone = stageGates.filter((g) => g.status === 'complete').length;

  const hasProjects = data.projects.length > 0;
  const hasGoals = data.goals.length > 0;
  const hasAchievements = data.achievements.length > 0;
  const hasSessions = data.upcomingSessions.length > 0;
  const hasEvents = data.upcomingEvents.length > 0;
  const goalsAutoSync = hasGoals && data.goals.some((g) => g.linked_platform);

  const tierDistance = career && career.nextTier != null && career.currentListeners != null
    ? Math.max(0, career.nextTier - career.currentListeners)
    : null;

  return (
    <div>
      <h2 className="text-heading-md mb-6">OVERVIEW</h2>

      {/* Active packages & memberships — only renders when the customer
          has at least one entitlement, so users without packages see
          nothing extra. Sits at the top of overview because if you HAVE
          a package, that's the highest-priority info on the page. */}
      <div className="mb-8">
        <ActivePackages />
      </div>

      {/* NEXT STEPS strip — the single prompt surface for the whole page. */}
      {visibleSteps.length > 0 && (
        <div className="border-2 border-accent p-5 mb-6 transition-all duration-200">
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-accent" /> Next Steps
          </h3>
          <div className="space-y-2">
            {visibleSteps.map((step) => {
              const isTab = step.href.startsWith('?tab=');
              const inner = (
                <>
                  <span className="font-mono text-sm font-bold flex-1 min-w-0 group-hover:text-accent transition-colors duration-200">
                    {step.message}
                  </span>
                  <ArrowRight className="w-4 h-4 text-accent flex-shrink-0 group-hover:translate-x-0.5 transition-transform duration-200" />
                </>
              );
              return (
                <div key={step.id} className="flex items-center gap-2">
                  {isTab ? (
                    <button
                      onClick={() => onNavigate?.(step.href.slice('?tab='.length))}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left group py-1"
                    >
                      {inner}
                    </button>
                  ) : (
                    <Link href={step.href} className="flex items-center gap-3 flex-1 min-w-0 group py-1">
                      {inner}
                    </Link>
                  )}
                  {step.dismissible && (
                    <button
                      onClick={() => dismissStep(step.id)}
                      aria-label="Dismiss"
                      className="p-1 text-black/20 hover:text-black/60 transition-colors duration-200 flex-shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* THIS WEEK — verified weekly deltas, never totals. */}
      {weekDeltas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-black/40 inline-flex items-center gap-1.5 mr-1">
            <TrendingUp className="w-3.5 h-3.5 text-accent" /> This Week
          </span>
          {weekDeltas.map((d) => {
            const positive = d.delta >= 0;
            return (
              <span
                key={`${d.platform}_${d.metric}`}
                className={`font-mono text-[10px] font-bold px-2 py-1 border ${
                  positive
                    ? 'text-emerald-600 border-emerald-600/30 bg-emerald-500/5'
                    : 'text-red-500 border-red-500/30 bg-red-500/5'
                }`}
              >
                {positive ? '+' : ''}{d.delta.toLocaleString()} {capitalize(d.platform)} {deltaMetricWord(d.metric)}
              </span>
            );
          })}
          {career?.lastUpdated && (
            <span className="font-mono text-[10px] text-black/30">
              Updated {new Date(career.lastUpdated).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Career Stage — current stage + the gates into the NEXT stage. */}
        {career && (
          <div className="border-2 border-black/10 p-5 transition-all duration-200 hover:border-accent/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                <Milestone className="w-4 h-4 text-accent" /> Career Stage
              </h3>
            </div>
            <p className="font-mono text-sm font-bold mb-3">{career.stageLabel}</p>
            {stageGates.length > 0 ? (
              <>
                <div className="space-y-1.5 mb-3">
                  {stageGates.map((g) => (
                    <div key={g.key} className="flex items-center gap-2">
                      {g.status === 'complete' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                      ) : (
                        <Circle className="w-3.5 h-3.5 text-black/20 flex-shrink-0" />
                      )}
                      <span className={`font-mono text-xs truncate ${g.status === 'complete' ? 'text-black/40 line-through' : ''}`}>
                        {g.title}
                      </span>
                      <span className="font-mono text-[10px] text-black/30 ml-auto flex-shrink-0">+{g.xp} xp</span>
                    </div>
                  ))}
                </div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1">
                  {gatesDone} of {stageGates.length} complete
                </p>
                <div className="h-1.5 bg-black/10 rounded-full mb-4 overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-500"
                    style={{ width: `${stageGates.length ? Math.round((gatesDone / stageGates.length) * 100) : 0}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="font-mono text-xs text-black/40 mb-4">All stages complete.</p>
            )}
            <button
              onClick={() => onNavigate?.('roadmap')}
              className="font-mono text-[10px] font-bold uppercase tracking-wider bg-accent text-black px-3 py-1.5 hover:opacity-80 transition-opacity duration-200"
            >
              View Roadmap
            </button>
          </div>
        )}

        {/* Listener Tier — permanent certifications, verified listeners only. */}
        {career && (
          <div className="border-2 border-black/10 p-5 transition-all duration-200 hover:border-accent/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                <Headphones className="w-4 h-4 text-accent" /> Listener Tier
              </h3>
            </div>
            {career.highestTier ? (
              <div className="mb-3"><TierBadge tier={career.highestTier} size="md" /></div>
            ) : (
              <p className="font-mono text-sm font-bold mb-3">No tier yet — first stop: 10K Club</p>
            )}
            {career.currentListeners != null && (
              <p className="font-mono text-xs mb-1">
                {career.currentListeners.toLocaleString()} verified monthly listeners
              </p>
            )}
            {career.nextTier != null && tierDistance != null && (
              <p className="font-mono text-[10px] text-black/40">
                {tierDistance.toLocaleString()} to go to {tierLabel(career.nextTier)}
              </p>
            )}
          </div>
        )}

        {/* Goals */}
        {hasGoals && (
          <div className="border-2 border-black/10 p-5 transition-all duration-200 hover:border-accent/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                <Target className="w-4 h-4 text-accent" /> Goals
              </h3>
              <button
                onClick={() => onNavigate?.('goals')}
                className="font-mono text-[10px] text-accent uppercase tracking-wider inline-flex items-center gap-1 hover:underline transition-colors duration-200"
              >
                View All <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-3">
              {data.goals.slice(0, 3).map((g) => {
                const pct = g.target_value ? Math.min(100, Math.round((g.current_value / g.target_value) * 100)) : 0;
                return (
                  <div key={g.id}>
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-xs font-semibold truncate">{g.title}</p>
                      {g.target_value && <span className="font-mono text-[10px] text-accent font-bold">{pct}%</span>}
                    </div>
                    {g.target_value && (
                      <div className="h-1.5 bg-black/10 rounded-full mt-1 overflow-hidden">
                        <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {goalsAutoSync && (
              <p className="font-mono text-[10px] text-black/30 mt-3">auto-syncs weekly</p>
            )}
          </div>
        )}

        {/* Active Projects */}
        {hasProjects && (
          <div className="border-2 border-black/10 p-5 transition-all duration-200 hover:border-accent/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                <Folder className="w-4 h-4 text-accent" /> Projects
              </h3>
              <button
                onClick={() => onNavigate?.('projects')}
                className="font-mono text-[10px] text-accent uppercase tracking-wider inline-flex items-center gap-1 hover:underline transition-colors duration-200"
              >
                View All <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-3">
              {data.projects.slice(0, 3).map((p) => {
                const phaseIdx = PROJECT_PHASES.findIndex((ph) => ph.key === p.current_phase);
                const days = p.target_release_date ? daysUntil(p.target_release_date) : null;
                return (
                  <div key={p.id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm font-semibold truncate">{p.title}</p>
                      <div className="flex gap-0.5 mt-1">
                        {PROJECT_PHASES.map((_, idx) => (
                          <div key={idx} className={`h-1 flex-1 ${idx <= phaseIdx ? 'bg-accent' : 'bg-black/10'} rounded-full`} />
                        ))}
                      </div>
                    </div>
                    {days !== null && (
                      <span className={`font-mono text-[10px] flex-shrink-0 ${days < 0 ? 'text-red-500' : 'text-black/40'}`}>
                        {days < 0 ? `${Math.abs(days)}d late` : `${days}d`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Upcoming Sessions */}
        {hasSessions && (
          <div className="border-2 border-black/10 p-5 transition-all duration-200 hover:border-accent/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                <Music className="w-4 h-4 text-accent" /> Upcoming Sessions
              </h3>
            </div>
            <div className="space-y-2">
              {data.upcomingSessions.slice(0, 3).map((s) => (
                <div key={s.id} className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-xs">
                      {fmtSessionDate(s.start_time, { weekday: 'short', month: 'short', day: 'numeric' })}
                      {' · '}{formatDuration(s.duration)}
                      {s.room && ` · ${s.room === 'studio_a' ? 'Studio A' : 'Studio B'}`}
                    </p>
                    {s.engineer_name && (
                      <p className="font-mono text-[10px] text-black/40">w/ {s.engineer_name}</p>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-accent flex-shrink-0">{daysUntil(s.start_time)}d</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming Calendar Events */}
        {hasEvents && (
          <div className="border-2 border-black/10 p-5 transition-all duration-200 hover:border-accent/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                <Calendar className="w-4 h-4 text-accent" /> Upcoming Events
              </h3>
              <button
                onClick={() => onNavigate?.('calendar')}
                className="font-mono text-[10px] text-accent uppercase tracking-wider inline-flex items-center gap-1 hover:underline transition-colors duration-200"
              >
                View All <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-2">
              {data.upcomingEvents.slice(0, 4).map((e) => (
                <div key={e.id} className="flex items-center gap-3">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: e.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs font-semibold truncate">{e.title}</p>
                    <p className="font-mono text-[10px] text-black/40">
                      {new Date(e.event_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}
                      {e.event_time && ` · ${e.event_time}`}
                    </p>
                  </div>
                  <span className="font-mono text-[10px] text-black/40 flex-shrink-0">
                    {daysUntil(e.event_date)}d
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Achievements */}
        {hasAchievements && (
          <div className="border-2 border-black/10 p-5 transition-all duration-200 hover:border-accent/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                <Award className="w-4 h-4 text-accent" /> Achievements ({data.achievements.length})
              </h3>
              <button
                onClick={() => onNavigate?.('achievements')}
                className="font-mono text-[10px] text-accent uppercase tracking-wider inline-flex items-center gap-1 hover:underline transition-colors duration-200"
              >
                View All <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.achievements.slice(0, 6).map((a) => {
                const def = ACHIEVEMENTS[a.achievement_key];
                if (!def) return null;
                return (
                  <span key={a.achievement_key} className="bg-accent/10 border border-accent/30 px-2 py-1 font-mono text-[10px] font-bold text-accent uppercase transition-colors duration-200 hover:bg-accent/20">
                    {def.title}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
