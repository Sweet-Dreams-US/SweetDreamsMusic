'use client';

import { useState, useEffect, useMemo } from 'react';
import { Trophy, X, ChevronDown, ChevronRight } from 'lucide-react';
import { ACHIEVEMENTS, TIER_COLORS } from '@/lib/achievements';
import BadgeIcon from './BadgeIcon';
import { fmtStampDate } from '@/lib/studio-time';
import { SkeletonGrid } from './LoadingSkeleton';

// ---------------------------------------------------------------------------
// Category metadata for display
// ---------------------------------------------------------------------------
const CATEGORY_META: Record<string, { label: string; order: number }> = {
  sessions:    { label: 'Sessions',    order: 0 },
  engineer:    { label: 'Engineer',    order: 1 },
  producer:    { label: 'Producer',    order: 2 },
  projects:    { label: 'Projects',    order: 3 },
  revenue:     { label: 'Revenue',     order: 4 },
  metrics:     { label: 'Metrics',     order: 5 },
  goals:       { label: 'Goals',       order: 6 },
  engagement:  { label: 'Engagement',  order: 7 },
  milestones:  { label: 'Milestones',  order: 8 },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Achievement {
  achievement_key: string;
  unlocked_at: string;
}

interface AchievementBadgesProps {
  newUnlocks?: string[];
  progress?: Record<string, { current: number; target: number }>;
  onDismiss?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function AchievementBadges({ newUnlocks = [], progress = {}, onDismiss }: AchievementBadgesProps) {
  const [unlocked, setUnlocked] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [showBanner, setShowBanner] = useState(newUnlocks.length > 0);

  useEffect(() => {
    fetch('/api/hub/achievements')
      .then((r) => r.json())
      .then((d) => setUnlocked(d.achievements || []))
      .finally(() => setLoading(false));
  }, []);

  // Show banner when newUnlocks changes
  useEffect(() => {
    if (newUnlocks.length > 0) setShowBanner(true);
  }, [newUnlocks]);

  const unlockedKeys = useMemo(() => new Set(unlocked.map((a) => a.achievement_key)), [unlocked]);
  const newUnlockSet = useMemo(() => new Set(newUnlocks), [newUnlocks]);

  const unlockedCount = unlockedKeys.size;
  const totalCount = Object.keys(ACHIEVEMENTS).length;
  const progressPct = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

  // Total XP earned from achievements
  const totalXpEarned = useMemo(() => {
    let xp = 0;
    for (const key of unlockedKeys) {
      if (ACHIEVEMENTS[key]) xp += ACHIEVEMENTS[key].xp;
    }
    return xp;
  }, [unlockedKeys]);

  // Group achievements by category
  const grouped = useMemo(() => {
    const groups: Record<string, { key: string; def: (typeof ACHIEVEMENTS)[string] }[]> = {};
    for (const [key, def] of Object.entries(ACHIEVEMENTS)) {
      const cat = def.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push({ key, def });
    }
    return Object.entries(groups).sort(
      ([a], [b]) => (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99),
    );
  }, []);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleDismiss = () => {
    setShowBanner(false);
    onDismiss?.();
  };

  // ----- Loading state -----------------------------------------------------
  if (loading) return <SkeletonGrid count={8} />;

  return (
    <div>
      {/* ---- Inline styles for animations -------------------------------- */}
      <style jsx>{`
        @keyframes pulseGold {
          0%, 100% { box-shadow: 0 0 8px 2px rgba(234, 179, 8, 0.3); }
          50% { box-shadow: 0 0 20px 6px rgba(234, 179, 8, 0.55); }
        }
        .animate-pulse-gold {
          animation: pulseGold 2s ease-in-out infinite;
        }
        @keyframes countUp {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-count-up {
          animation: countUp 0.6s ease-out forwards;
        }
        @keyframes slideDown {
          from { opacity: 0; max-height: 0; }
          to { opacity: 1; max-height: 80px; }
        }
        .animate-slide-down {
          animation: slideDown 0.35s ease-out forwards;
        }
      `}</style>

      {/* ---- New Unlock Banner ------------------------------------------- */}
      {showBanner && newUnlocks.length > 0 && (
        <div className="animate-slide-down mb-6 border-2 border-yellow-400 bg-yellow-50 p-3 flex items-center justify-between gap-3 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0">
            <Trophy className="w-5 h-5 text-yellow-600 shrink-0" />
            <p className="font-mono text-xs uppercase tracking-wider text-yellow-800 truncate">
              New unlock{newUnlocks.length > 1 ? 's' : ''}:{' '}
              {newUnlocks
                .map((k) => ACHIEVEMENTS[k]?.title ?? k)
                .join(', ')}
            </p>
          </div>
          <button onClick={handleDismiss} className="shrink-0 text-yellow-600 hover:text-yellow-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ---- Header with overall progress -------------------------------- */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-heading-md font-mono">ACHIEVEMENTS</h2>
        <div className="flex items-center gap-4">
          {totalXpEarned > 0 && (
            <span className="font-mono text-xs text-yellow-700 bg-yellow-50 border border-yellow-300 px-2 py-0.5 font-bold uppercase tracking-wider animate-count-up">
              {totalXpEarned.toLocaleString()} XP Earned
            </span>
          )}
          <span className="font-mono text-xs text-accent font-bold uppercase tracking-wider animate-count-up">
            {unlockedCount} / {totalCount} Unlocked
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-black/5 mb-8 overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-700 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* ---- Category groups --------------------------------------------- */}
      <div className="space-y-8">
        {grouped.map(([category, items]) => {
          const meta = CATEGORY_META[category] ?? { label: category };
          const collapsed = collapsedCategories.has(category);
          const catUnlocked = items.filter((i) => unlockedKeys.has(i.key)).length;

          return (
            <section key={category}>
              {/* Category header */}
              <button
                onClick={() => toggleCategory(category)}
                className="flex items-center gap-2 mb-4 group cursor-pointer w-full text-left"
              >
                {collapsed
                  ? <ChevronRight className="w-4 h-4 text-black/30 group-hover:text-black/60 transition-colors" />
                  : <ChevronDown className="w-4 h-4 text-black/30 group-hover:text-black/60 transition-colors" />
                }
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-black/50 group-hover:text-black/70 transition-colors">
                  {meta.label}
                </span>
                <span className="font-mono text-[10px] text-black/30">
                  {catUnlocked}/{items.length}
                </span>
              </button>

              {/* Achievement grid */}
              {!collapsed && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {items.map(({ key, def }) => {
                    const isUnlocked = unlockedKeys.has(key);
                    const isNew = newUnlockSet.has(key);
                    const unlockedData = unlocked.find((a) => a.achievement_key === key);
                    const tier = TIER_COLORS[def.tier] ?? TIER_COLORS.bronze;
                    const prog = progress[key];
                    const progPct = prog && prog.target > 0
                      ? Math.min(100, Math.round((prog.current / prog.target) * 100))
                      : 0;

                    return (
                      <div
                        key={key}
                        className={[
                          'border-2 p-4 text-center transition-all duration-200',
                          isUnlocked
                            ? `${tier.bg} ${tier.border} ${isNew ? 'animate-pulse-gold' : ''}`
                            : 'border-dashed border-black/10 bg-black/[0.01]',
                          isUnlocked && !isNew ? 'hover:scale-[1.03] hover:shadow-md' : '',
                        ].join(' ')}
                      >
                        {/* Tier label */}
                        {isUnlocked && (
                          <span className={`font-mono text-[10px] font-bold uppercase tracking-widest ${tier.text}`}>
                            {def.tier}
                          </span>
                        )}

                        {/* Badge icon */}
                        <div className="w-16 h-16 mx-auto mb-3 flex items-center justify-center">
                          <BadgeIcon icon={def.icon} tier={def.tier} unlocked={isUnlocked} size={56} />
                        </div>

                        {/* Title */}
                        <p className={`font-mono text-xs font-bold uppercase tracking-wider ${isUnlocked ? '' : 'text-black/50'}`}>
                          {def.title}
                        </p>

                        {/* Description */}
                        <p className={`font-mono text-[11px] mt-1 ${isUnlocked ? 'text-black/60' : 'text-black/40'}`}>
                          {def.description}
                        </p>

                        {/* Progress bar for locked achievements */}
                        {!isUnlocked && prog && prog.target > 1 && (
                          <div className="mt-2">
                            <div className="w-full h-1.5 bg-black/10 overflow-hidden rounded-full">
                              <div
                                className="h-full bg-black/30 transition-all duration-500 rounded-full"
                                style={{ width: `${progPct}%` }}
                              />
                            </div>
                            <p className="font-mono text-[11px] text-black/50 mt-1 font-semibold">
                              {prog.current}/{prog.target}
                            </p>
                          </div>
                        )}

                        {/* XP reward */}
                        <p className={`font-mono text-[11px] mt-2 font-bold ${isUnlocked ? tier.text : 'text-black/30'}`}>
                          +{def.xp} XP
                        </p>

                        {/* Unlock date */}
                        {isUnlocked && unlockedData && (
                          <p className="font-mono text-[10px] text-black/30 mt-0.5">
                            {fmtStampDate(unlockedData.unlocked_at)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
