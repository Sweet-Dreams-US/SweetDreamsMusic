'use client';

import { useState, useEffect } from 'react';
import { Flame, Rocket } from 'lucide-react';
import Link from 'next/link';
import { calculateLevel, getLevelTitle, getLevelColor } from '@/lib/xp-system';

export default function XPWidget() {
  const [data, setData] = useState<{
    level: number;
    progress: number;
    totalXp: number;
    title: string;
    color: string;
    streak: number;
  } | null>(null);

  useEffect(() => {
    fetch('/api/hub/xp')
      .then((r) => r.json())
      .then((d) => {
        if (d.totalXp !== undefined) {
          const info = calculateLevel(d.totalXp || 0);
          setData({
            level: info.level,
            progress: info.progress,
            totalXp: info.totalXp,
            title: getLevelTitle(info.level),
            color: getLevelColor(info.level),
            streak: d.dailyStreak || 0,
          });
        }
      })
      .catch(() => {});
  }, []);

  if (!data) return null;

  return (
    <Link
      href="/dashboard/hub"
      className="border-2 border-black/10 p-4 sm:p-5 hover:border-accent transition-colors block no-underline group"
    >
      <div className="flex items-center gap-4">
        {/* Level badge */}
        <div
          className="w-12 h-12 rounded-full border-2 flex items-center justify-center flex-shrink-0"
          style={{ borderColor: data.color }}
        >
          <span className="font-mono text-base font-bold" style={{ color: data.color }}>
            {data.level}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-mono text-xs font-bold uppercase tracking-wider">
              Level {data.level} — {data.title}
            </p>
            {data.streak > 0 && (
              <span className="inline-flex items-center gap-0.5 font-mono text-[10px] font-bold text-orange-500">
                <Flame className="w-3 h-3" />
                {data.streak}
              </span>
            )}
          </div>
          {/* Progress bar */}
          <div className="h-2 bg-black/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${data.progress}%`, backgroundColor: '#F4C430' }}
            />
          </div>
          <p className="font-mono text-[10px] text-black/40 mt-1">
            {data.totalXp.toLocaleString()} XP total
          </p>
        </div>

        {/* CTA */}
        <div className="flex-shrink-0 text-black/30 group-hover:text-accent transition-colors">
          <Rocket className="w-5 h-5" />
        </div>
      </div>
    </Link>
  );
}
