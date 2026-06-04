'use client';

import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Folder, Target, BarChart3, CalendarDays, Award, BookOpen, FileText, Film, PartyPopper, Users } from 'lucide-react';
import { HUB_TABS, type HubTab } from '@/lib/hub-constants';
import { calculateLevel, getLevelTitle, getLevelColor } from '@/lib/xp-system';
import XPBar from './XPBar';
import HubOverview from './HubOverview';
import ProjectList from './ProjectList';
import GoalTracker from './GoalTracker';
import MetricsDashboard from './MetricsDashboard';
import ContentCalendar from './ContentCalendar';
import AchievementBadges from './AchievementBadges';
import ArtistRoadmap from './ArtistRoadmap';
import SessionNotes from './SessionNotes';
import HubMedia from './HubMedia';
import HubEvents from './HubEvents';
import HubBands from './HubBands';
import type { MediaOffering } from '@/lib/media';
import type { MediaCreditBalance } from '@/lib/media-credits';
import type { BandMembership, BandInvite, Band } from '@/lib/bands';
import type { EventWithRsvp, EventRsvp, SweetEvent } from '@/lib/events';

// Server-fetched data for the relocated Media / Events / Bands tabs. Plain
// serializable objects passed down from app/dashboard/hub/page.tsx so the
// tabs render without a client waterfall (and without new API routes).
export interface HubRelocatedData {
  media: {
    packages: MediaOffering[];
    services: MediaOffering[];
    profilePhone: string | null;
    isAdmin: boolean;
    credits: MediaCreditBalance[];
    studioHours: { hoursRemaining: number; costBasisCents: number };
    orderCount: number;
  };
  events: {
    myEvents: EventWithRsvp[];
    pendingInvites: (EventRsvp & { event: SweetEvent })[];
  };
  bands: {
    memberships: BandMembership[];
    pendingInvites: (BandInvite & { band: Band })[];
    hasProfile: boolean;
  };
}

const TAB_ICONS: Record<string, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  projects: Folder,
  goals: Target,
  metrics: BarChart3,
  calendar: CalendarDays,
  media: Film,
  events: PartyPopper,
  bands: Users,
  achievements: Award,
  roadmap: BookOpen,
  notes: FileText,
};

// Extended tabs with session notes
const EXTENDED_TABS = [
  ...HUB_TABS,
  { key: 'notes' as const, label: 'Notes' },
];

type ExtendedTab = HubTab | 'notes';

interface XpHistoryItem {
  label: string;
  xp_amount: number;
  action: string;
  created_at: string;
}

interface XpData {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
  totalXp: number;
  streak: number;
  recentXp: { label: string; xp: number }[];
  xpHistory: XpHistoryItem[];
}

export default function ArtistHub({ userId, relocated }: { userId: string; relocated: HubRelocatedData }) {
  const [tab, setTab] = useState<ExtendedTab>('overview');
  const [xpData, setXpData] = useState<XpData | null>(null);
  const [newAchievements, setNewAchievements] = useState<string[]>([]);
  const [achievementProgress, setAchievementProgress] = useState<Record<string, { current: number; target: number }>>({});

  const loadXp = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/xp');
      if (!res.ok) return;
      const data = await res.json();
      const levelInfo = calculateLevel(data.totalXp || 0);
      // Build recent XP pills from xpHistory (last few unique actions)
      const recentXp = (data.xpHistory || [])
        .slice(0, 5)
        .map((h: { label: string; xp_amount: number }) => ({
          label: h.label,
          xp: h.xp_amount,
        }));
      setXpData({
        ...levelInfo,
        streak: data.dailyStreak || 0,
        recentXp,
        xpHistory: (data.xpHistory || []).slice(0, 5),
      });
    } catch {
      // silent
    }
  }, []);

  const checkAchievements = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/achievements/check', { method: 'POST' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.progress) {
        setAchievementProgress(data.progress);
      }
      if (data.newAchievements?.length > 0) {
        setNewAchievements(data.newAchievements);
        // Reload XP after achievement awards
        loadXp();
      }
    } catch {
      // silent
    }
  }, [loadXp]);

  useEffect(() => {
    loadXp();
    // Check achievements on mount (slight delay to let XP load first)
    const timer = setTimeout(checkAchievements, 2000);
    return () => clearTimeout(timer);
  }, [loadXp, checkAchievements]);

  // Callback for child components to trigger XP refresh + re-check achievements
  const onXpEarned = useCallback(() => {
    loadXp();
    // Re-check achievements after any XP-granting action
    setTimeout(checkAchievements, 500);
  }, [loadXp, checkAchievements]);

  return (
    <>
      {/* XP Bar */}
      {xpData && (
        <section className="bg-white text-black border-b border-black/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <XPBar
              level={xpData.level}
              currentLevelXp={xpData.currentLevelXp}
              nextLevelXp={xpData.nextLevelXp}
              progress={xpData.progress}
              totalXp={xpData.totalXp}
              title={getLevelTitle(xpData.level)}
              color={getLevelColor(xpData.level)}
              streak={xpData.streak}
              recentXp={xpData.recentXp}
              xpHistory={xpData.xpHistory}
            />
          </div>
        </section>
      )}

      {/* Hub content with sidebar */}
      <section className="bg-white text-black min-h-[60vh]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Mobile Tabs — above everything */}
          <div className="lg:hidden mb-6">
            <div className="flex flex-wrap gap-1.5">
              {EXTENDED_TABS.map((t) => {
                const Icon = TAB_ICONS[t.key] || LayoutDashboard;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key as ExtendedTab)}
                    className={`font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-2 transition-colors inline-flex items-center gap-1.5 rounded ${
                      tab === t.key ? 'bg-black text-white' : 'bg-black/5 text-black/50 hover:bg-black/10'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-8">
            {/* Desktop Sidebar */}
            <aside className="hidden lg:block w-48 shrink-0 self-start sticky top-24">
              <nav className="space-y-1">
                {EXTENDED_TABS.map((t) => {
                  const Icon = TAB_ICONS[t.key] || LayoutDashboard;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key as ExtendedTab)}
                      className={`w-full text-left font-mono text-xs font-semibold uppercase tracking-wider px-4 py-3 transition-colors flex items-center gap-2.5 rounded ${
                        tab === t.key ? 'bg-black text-white' : 'text-black/50 hover:bg-black/5 hover:text-black/80'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {t.label}
                    </button>
                  );
                })}
              </nav>
            </aside>

            {/* Main Content */}
            <div className="flex-1 min-w-0">
              {tab === 'overview' && <HubOverview onXpEarned={onXpEarned} onNavigate={(t) => setTab(t as ExtendedTab)} />}
              {tab === 'projects' && <ProjectList onXpEarned={onXpEarned} />}
              {tab === 'goals' && <GoalTracker onXpEarned={onXpEarned} />}
              {tab === 'metrics' && <MetricsDashboard onXpEarned={onXpEarned} />}
              {tab === 'calendar' && <ContentCalendar onXpEarned={onXpEarned} />}
              {tab === 'media' && (
                <HubMedia
                  packages={relocated.media.packages}
                  services={relocated.media.services}
                  profilePhone={relocated.media.profilePhone}
                  isAdmin={relocated.media.isAdmin}
                  mediaCredits={relocated.media.credits}
                  studioHours={relocated.media.studioHours}
                  orderCount={relocated.media.orderCount}
                />
              )}
              {tab === 'events' && (
                <HubEvents myEvents={relocated.events.myEvents} pendingInvites={relocated.events.pendingInvites} />
              )}
              {tab === 'bands' && (
                <HubBands
                  memberships={relocated.bands.memberships}
                  pendingInvites={relocated.bands.pendingInvites}
                  hasProfile={relocated.bands.hasProfile}
                />
              )}
              {tab === 'achievements' && <AchievementBadges newUnlocks={newAchievements} progress={achievementProgress} onDismiss={() => setNewAchievements([])} />}
              {tab === 'roadmap' && <ArtistRoadmap />}
              {tab === 'notes' && <SessionNotes onXpEarned={onXpEarned} />}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
