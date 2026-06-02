'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Folder, Target, BarChart3, Calendar, Award, ChevronRight, Rocket, Music, TrendingUp, Zap, FileText } from 'lucide-react';
import { PROJECT_PHASES, METRIC_PLATFORMS, GOAL_CATEGORIES } from '@/lib/hub-constants';
import { formatDuration } from '@/lib/utils';
import { fmtSessionDate } from '@/lib/studio-time';
import { ACHIEVEMENTS } from '@/lib/achievements';
import { SkeletonList } from './LoadingSkeleton';
import ActivePackages from './ActivePackages';

interface OverviewData {
  projects: { id: string; title: string; project_type: string; current_phase: string; target_release_date: string | null; status: string; cover_image_url: string | null }[];
  goals: { id: string; title: string; category: string; target_value: number | null; current_value: number; target_date: string | null; status: string }[];
  latestMetrics: Record<string, { platform: string; followers: number | null; monthly_listeners: number | null; subscribers: number | null; metric_date: string }>;
  achievements: { achievement_key: string; unlocked_at: string }[];
  upcomingSessions: { id: string; start_time: string; duration: number; room: string | null; status: string; engineer_name: string | null }[];
  completedSessions: { id: string; start_time: string; duration: number; room: string | null; status: string; engineer_name: string | null }[];
  upcomingEvents: { id: string; title: string; event_type: string; event_date: string; event_time: string | null; color: string }[];
}

interface HubOverviewProps {
  onXpEarned?: () => void;
  onNavigate?: (tab: string) => void;
}

export default function HubOverview({ onXpEarned, onNavigate }: HubOverviewProps) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/hub/overview')
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

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

  const hasProjects = data.projects.length > 0;
  const hasGoals = data.goals.length > 0;
  const hasMetrics = Object.keys(data.latestMetrics).length > 0;
  const hasAchievements = data.achievements.length > 0;
  const hasSessions = data.upcomingSessions.length > 0;
  const hasEvents = data.upcomingEvents.length > 0;
  const isEmpty = !hasProjects && !hasGoals && !hasMetrics;

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

      {/* Welcome section when hub is mostly empty */}
      {isEmpty && (
        <div className="border-2 border-accent p-8 mb-8 transition-all duration-200">
          <div className="flex items-center gap-3 mb-4">
            <Rocket className="w-5 h-5 text-accent" />
            <h3 className="text-heading-sm">Welcome to Your Artist Hub</h3>
          </div>
          <p className="font-mono text-sm text-black/60 mb-5">
            This is your command center for building your music career. Get started in a few steps:
          </p>
          <div className="space-y-3">
            <button
              onClick={() => onNavigate?.('projects')}
              className="flex items-center gap-3 w-full text-left group"
            >
              <span className="flex items-center justify-center w-6 h-6 border-2 border-accent text-accent font-mono text-xs font-bold flex-shrink-0 group-hover:bg-accent group-hover:text-white transition-colors duration-200">
                1
              </span>
              <span className="font-mono text-xs text-black/50 group-hover:text-black/80 transition-colors duration-200">
                Create a project to track your next release
              </span>
              <ChevronRight className="w-3 h-3 text-black/20 ml-auto group-hover:text-accent transition-colors duration-200" />
            </button>
            <button
              onClick={() => onNavigate?.('goals')}
              className="flex items-center gap-3 w-full text-left group"
            >
              <span className="flex items-center justify-center w-6 h-6 border-2 border-accent text-accent font-mono text-xs font-bold flex-shrink-0 group-hover:bg-accent group-hover:text-white transition-colors duration-200">
                2
              </span>
              <span className="font-mono text-xs text-black/50 group-hover:text-black/80 transition-colors duration-200">
                Set some career goals
              </span>
              <ChevronRight className="w-3 h-3 text-black/20 ml-auto group-hover:text-accent transition-colors duration-200" />
            </button>
            <button
              onClick={() => onNavigate?.('metrics')}
              className="flex items-center gap-3 w-full text-left group"
            >
              <span className="flex items-center justify-center w-6 h-6 border-2 border-accent text-accent font-mono text-xs font-bold flex-shrink-0 group-hover:bg-accent group-hover:text-white transition-colors duration-200">
                3
              </span>
              <span className="font-mono text-xs text-black/50 group-hover:text-black/80 transition-colors duration-200">
                Log your current metrics to start tracking growth
              </span>
              <ChevronRight className="w-3 h-3 text-black/20 ml-auto group-hover:text-accent transition-colors duration-200" />
            </button>
            <button
              onClick={() => onNavigate?.('roadmap')}
              className="flex items-center gap-3 w-full text-left group"
            >
              <span className="flex items-center justify-center w-6 h-6 border-2 border-accent text-accent font-mono text-xs font-bold flex-shrink-0 group-hover:bg-accent group-hover:text-white transition-colors duration-200">
                4
              </span>
              <span className="font-mono text-xs text-black/50 group-hover:text-black/80 transition-colors duration-200">
                Check out the Roadmap for a full guide to building your career
              </span>
              <ChevronRight className="w-3 h-3 text-black/20 ml-auto group-hover:text-accent transition-colors duration-200" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Projects */}
        <div className="border-2 border-black/10 p-5 transition-all duration-200 hover:border-accent/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
              <Folder className="w-4 h-4 text-accent" /> Projects
            </h3>
            {hasProjects && (
              <button
                onClick={() => onNavigate?.('projects')}
                className="font-mono text-[10px] text-accent uppercase tracking-wider inline-flex items-center gap-1 hover:underline transition-colors duration-200"
              >
                View All <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
          {hasProjects ? (
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
          ) : (
            <div className="text-center py-4">
              <Folder className="w-6 h-6 text-black/15 mx-auto mb-2" />
              <p className="font-mono text-xs text-black/30 mb-3">No active projects</p>
              <button
                onClick={() => onNavigate?.('projects')}
                className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent border border-accent px-3 py-1.5 hover:bg-accent hover:text-white transition-all duration-200"
              >
                Start a Project
              </button>
            </div>
          )}
        </div>

        {/* Goals */}
        <div className="border-2 border-black/10 p-5 transition-all duration-200 hover:border-accent/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
              <Target className="w-4 h-4 text-accent" /> Goals
            </h3>
            {hasGoals && (
              <button
                onClick={() => onNavigate?.('goals')}
                className="font-mono text-[10px] text-accent uppercase tracking-wider inline-flex items-center gap-1 hover:underline transition-colors duration-200"
              >
                View All <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
          {hasGoals ? (
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
          ) : (
            <div className="text-center py-4">
              <Target className="w-6 h-6 text-black/15 mx-auto mb-2" />
              <p className="font-mono text-xs text-black/30 mb-3">No active goals</p>
              <button
                onClick={() => onNavigate?.('goals')}
                className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent border border-accent px-3 py-1.5 hover:bg-accent hover:text-white transition-all duration-200"
              >
                Set a Goal
              </button>
            </div>
          )}
        </div>

        {/* Metrics Snapshot */}
        <div className="border-2 border-black/10 p-5 transition-all duration-200 hover:border-accent/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-accent" /> Metrics
            </h3>
            {hasMetrics && (
              <button
                onClick={() => onNavigate?.('metrics')}
                className="font-mono text-[10px] text-accent uppercase tracking-wider inline-flex items-center gap-1 hover:underline transition-colors duration-200"
              >
                View All <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
          {hasMetrics ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {METRIC_PLATFORMS.map((platform) => {
                const m = data.latestMetrics[platform.key];
                if (!m) return null;
                const val = m.followers || m.monthly_listeners || m.subscribers || 0;
                return (
                  <div key={platform.key}>
                    <p className="font-mono text-[10px] uppercase" style={{ color: platform.color }}>{platform.label}</p>
                    <p className="font-mono text-sm font-bold">{val.toLocaleString()}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-4">
              <BarChart3 className="w-6 h-6 text-black/15 mx-auto mb-2" />
              <p className="font-mono text-xs text-black/30 mb-3">No metrics logged yet</p>
              <button
                onClick={() => onNavigate?.('metrics')}
                className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent border border-accent px-3 py-1.5 hover:bg-accent hover:text-white transition-all duration-200"
              >
                Log Metrics
              </button>
            </div>
          )}
        </div>

        {/* Upcoming Sessions */}
        <div className="border-2 border-black/10 p-5 transition-all duration-200 hover:border-accent/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
              <Music className="w-4 h-4 text-accent" /> Upcoming Sessions
            </h3>
          </div>
          {hasSessions ? (
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
          ) : (
            <div className="text-center py-4">
              <Music className="w-6 h-6 text-black/15 mx-auto mb-2" />
              <p className="font-mono text-xs text-black/30 mb-3">No upcoming sessions</p>
              <Link
                href="/book"
                className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent border border-accent px-3 py-1.5 hover:bg-accent hover:text-white transition-all duration-200"
              >
                Book a Session
              </Link>
            </div>
          )}
        </div>

        {/* Upcoming Calendar Events */}
        <div className="border-2 border-black/10 p-5 transition-all duration-200 hover:border-accent/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
              <Calendar className="w-4 h-4 text-accent" /> Upcoming Events
            </h3>
            {hasEvents && (
              <button
                onClick={() => onNavigate?.('calendar')}
                className="font-mono text-[10px] text-accent uppercase tracking-wider inline-flex items-center gap-1 hover:underline transition-colors duration-200"
              >
                View All <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
          {hasEvents ? (
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
          ) : (
            <div className="text-center py-4">
              <Calendar className="w-6 h-6 text-black/15 mx-auto mb-2" />
              <p className="font-mono text-xs text-black/30 mb-3">No upcoming events</p>
              <button
                onClick={() => onNavigate?.('calendar')}
                className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent border border-accent px-3 py-1.5 hover:bg-accent hover:text-white transition-all duration-200"
              >
                Add an Event
              </button>
            </div>
          )}
        </div>

        {/* Achievements */}
        <div className="border-2 border-black/10 p-5 transition-all duration-200 hover:border-accent/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
              <Award className="w-4 h-4 text-accent" /> Achievements {hasAchievements && `(${data.achievements.length})`}
            </h3>
            {hasAchievements && (
              <button
                onClick={() => onNavigate?.('achievements')}
                className="font-mono text-[10px] text-accent uppercase tracking-wider inline-flex items-center gap-1 hover:underline transition-colors duration-200"
              >
                View All <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
          {hasAchievements ? (
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
          ) : (
            <div className="text-center py-4">
              <Award className="w-6 h-6 text-black/15 mx-auto mb-2" />
              <p className="font-mono text-xs text-black/30">Complete actions to unlock achievements</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
