'use client';

import { useState, useEffect, useRef } from 'react';
import { Flame, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

interface XPHistoryItem {
  label: string;
  xp_amount: number;
  action: string;
  created_at: string;
}

interface XPBarProps {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
  totalXp: number;
  title: string;
  color: string;
  streak: number;
  recentXp?: { label: string; xp: number }[];
  xpHistory?: XPHistoryItem[];
}

export default function XPBar({
  level,
  currentLevelXp,
  nextLevelXp,
  progress,
  totalXp,
  title,
  color,
  streak,
  recentXp,
  xpHistory,
}: XPBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [animateBar, setAnimateBar] = useState(false);
  const [showGlow, setShowGlow] = useState(false);
  const prevXpRef = useRef(totalXp);

  // Animate when XP changes
  useEffect(() => {
    if (totalXp > prevXpRef.current) {
      setAnimateBar(true);
      setShowGlow(true);
      const timer = setTimeout(() => {
        setAnimateBar(false);
        setShowGlow(false);
      }, 2000);
      prevXpRef.current = totalXp;
      return () => clearTimeout(timer);
    }
    prevXpRef.current = totalXp;
  }, [totalXp]);

  const xpToNext = nextLevelXp - currentLevelXp;

  // Get last 5 unique XP entries for the breakdown
  const recentEntries = (xpHistory || []).slice(0, 5);

  function timeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMin = Math.floor((now - then) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    return `${diffDays}d ago`;
  }

  return (
    <div className="w-full mb-6">
      <style>{`
        @keyframes xpPillFloat {
          0% { opacity: 0; transform: translateY(0); }
          20% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-24px); }
        }
        .xp-pill-animate {
          animation: xpPillFloat 2s ease-out forwards;
        }
        @keyframes xpBarPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(244, 196, 48, 0); }
          50% { box-shadow: 0 0 12px 4px rgba(244, 196, 48, 0.4); }
        }
        .xp-bar-pulse {
          animation: xpBarPulse 1s ease-in-out 2;
        }
        @keyframes xpGlow {
          0% { opacity: 0; }
          30% { opacity: 1; }
          100% { opacity: 0; }
        }
        .xp-glow {
          animation: xpGlow 2s ease-out forwards;
        }
      `}</style>

      {/* Level label — clickable to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-black/40 mb-2 hover:text-black/60 transition-colors"
      >
        LEVEL {level} &middot; {title}
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {/* Main bar row */}
      <div className="flex items-center gap-4">
        {/* Level badge */}
        <div
          className={`w-10 h-10 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-300 ${showGlow ? 'scale-110' : ''}`}
          style={{ borderColor: color }}
        >
          <span className="font-mono text-sm font-bold" style={{ color }}>
            {level}
          </span>
        </div>

        {/* Progress bar */}
        <div className={`flex-1 h-3 bg-black/10 rounded-full overflow-hidden relative ${animateBar ? 'xp-bar-pulse' : ''}`}>
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{
              width: `${progress}%`,
              backgroundColor: '#F4C430',
            }}
          />
          {showGlow && (
            <div className="xp-glow absolute inset-0 rounded-full pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent, rgba(244,196,48,0.3), transparent)' }} />
          )}
        </div>

        {/* Right stats */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="font-mono text-xs font-bold">{totalXp.toLocaleString()} XP</span>
          {streak > 0 && (
            <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-orange-500">
              <Flame className="w-3.5 h-3.5" />
              {streak}
            </span>
          )}
        </div>
      </div>

      {/* XP counts + next level below bar */}
      <div className="flex items-center justify-between mt-1 ml-14 mr-0">
        <p className="font-mono text-[10px] text-black/40">
          {currentLevelXp.toLocaleString()} / {nextLevelXp.toLocaleString()} XP
        </p>
        <p className="font-mono text-[10px] text-black/40 flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          {xpToNext.toLocaleString()} XP to Level {level + 1}
        </p>
      </div>

      {/* Recent XP pill notifications */}
      {recentXp && recentXp.length > 0 && (
        <div className="relative flex flex-wrap gap-2 mt-2 ml-14">
          {recentXp.map((item, i) => (
            <span
              key={`${item.label}-${i}`}
              className="xp-pill-animate inline-flex items-center gap-1 bg-accent/20 border border-accent/40 px-2 py-0.5 rounded-full font-mono text-[10px] font-bold text-accent"
              style={{ animationDelay: `${i * 300}ms` }}
            >
              +{item.xp} {item.label}
            </span>
          ))}
        </div>
      )}

      {/* Expanded breakdown panel */}
      {expanded && (
        <div className="mt-3 ml-14 bg-black/[0.03] border border-black/10 rounded-lg p-4 space-y-3">
          <h4 className="font-mono text-[10px] font-bold uppercase tracking-widest text-black/50">
            Recent Activity
          </h4>
          {recentEntries.length > 0 ? (
            <ul className="space-y-2">
              {recentEntries.map((entry, i) => (
                <li key={`${entry.action}-${i}`} className="flex items-center justify-between">
                  <span className="font-mono text-xs text-black/70">{entry.label || entry.action.replace(/_/g, ' ')}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-black/40">
                      {entry.created_at ? timeAgo(entry.created_at) : ''}
                    </span>
                    <span className="font-mono text-xs font-bold text-accent">+{entry.xp_amount}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-mono text-xs text-black/40">No XP activity yet. Start completing tasks to earn XP!</p>
          )}

          {/* Summary stats */}
          <div className="flex gap-4 pt-2 border-t border-black/10">
            <div>
              <p className="font-mono text-[10px] text-black/40 uppercase">Total XP</p>
              <p className="font-mono text-sm font-bold">{totalXp.toLocaleString()}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] text-black/40 uppercase">Level</p>
              <p className="font-mono text-sm font-bold">{level}</p>
            </div>
            {streak > 0 && (
              <div>
                <p className="font-mono text-[10px] text-black/40 uppercase">Streak</p>
                <p className="font-mono text-sm font-bold text-orange-500">{streak} days</p>
              </div>
            )}
            <div>
              <p className="font-mono text-[10px] text-black/40 uppercase">Next Level</p>
              <p className="font-mono text-sm font-bold">{xpToNext.toLocaleString()} XP</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
