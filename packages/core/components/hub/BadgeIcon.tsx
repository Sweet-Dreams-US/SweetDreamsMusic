'use client';

import { TIER_HEX } from '@/lib/achievements';

// SVG path data for badge inner symbols — each maps to an achievement icon name
const SYMBOL_PATHS: Record<string, string> = {
  // Music & Studio
  Mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8',
  Music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  Headphones: 'M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3ZM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3Z',
  Disc: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10ZM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  Sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',

  // Achievement & Status
  Star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z',
  Award: 'M12 15l-3.5 2 .67-3.89L6 10.22l3.91-.57L12 6l2.09 3.65 3.91.57-2.83 2.89.67 3.89Z M8.21 13.89L7 23l5-3 5 3-1.21-9.12',
  Trophy: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 22V2h4v20M10 14.66V18h4v-3.34',
  Crown: 'M2 17l3-12 4 5 3-7 3 7 4-5 3 12Z M2 17h20',
  Zap: 'M13 2L3 14h9l-1 10 10-12h-9l1-10Z',

  // Actions & Progress
  Target: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10ZM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  Flame: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 3-7.5.5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.5-2.5 1.5-3.5l1 1Z',
  Rocket: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09ZM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z M9 12H4s.55-3.03 2-4c1.62-1.08 3 0 3 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-3 0-3',
  CheckCircle: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',

  // People & Social
  User: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  Globe: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10ZM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z',
  Heart: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z',
  Link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  Handshake: 'M11 17l-1 1-4-4 5-5 3 3M14 7l1-1 4 4-5 5-3-3M7 21l-3-3M17 3l3 3M3 11l2-2M19 13l2-2',

  // Files & Data
  Folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z',
  FileText: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M16 13H8M16 17H8M10 9H8',
  BarChart: 'M12 20V10M18 20V4M6 20v-4',
  PenLine: 'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z',
  Calendar: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2ZM16 2v4M8 2v4M3 10h18',
  Library: 'M3 7v10M7 3v18M11 7v10M15 3v18M19 7v10',

  // Commerce
  DollarSign: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  TrendingUp: 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
  Upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',

  // Tools
  Wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z',
  Camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  Lock: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2ZM7 11V7a5 5 0 0 1 10 0v4',
};

interface BadgeIconProps {
  icon: string;
  tier: string;
  unlocked: boolean;
  size?: number;
}

export default function BadgeIcon({ icon, tier, unlocked, size = 64 }: BadgeIconProps) {
  const colors = TIER_HEX[tier] || TIER_HEX.bronze;
  const pathData = SYMBOL_PATHS[icon] || SYMBOL_PATHS.Star;
  const r = size / 2;
  const innerR = r * 0.62;
  const iconScale = size / 64; // scale factor relative to 64px base

  if (!unlocked) {
    // Locked badge — muted, dashed outline
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx={r} cy={r} r={r - 2} stroke="#D1D5DB" strokeWidth="1.5" strokeDasharray="4 3" fill="#F9FAFB" />
        <g transform={`translate(${r - 10 * iconScale}, ${r - 10 * iconScale}) scale(${0.83 * iconScale})`}>
          <path d={SYMBOL_PATHS.Lock} stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </g>
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id={`badge-bg-${icon}-${tier}`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor={colors.bg} />
          <stop offset="100%" stopColor={colors.primary} stopOpacity="0.15" />
        </radialGradient>
        <linearGradient id={`badge-ring-${icon}-${tier}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={colors.primary} />
          <stop offset="100%" stopColor={colors.secondary} />
        </linearGradient>
        <filter id={`badge-glow-${icon}-${tier}`}>
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer glow */}
      <circle cx={r} cy={r} r={r - 1} fill={colors.glow} filter={`url(#badge-glow-${icon}-${tier})`} />

      {/* Outer ring */}
      <circle cx={r} cy={r} r={r - 2} stroke={`url(#badge-ring-${icon}-${tier})`} strokeWidth="2.5" fill={`url(#badge-bg-${icon}-${tier})`} />

      {/* Inner circle */}
      <circle cx={r} cy={r} r={innerR} stroke={colors.primary} strokeWidth="1" fill="white" fillOpacity="0.6" />

      {/* Icon */}
      <g transform={`translate(${r - 10 * iconScale}, ${r - 12 * iconScale}) scale(${0.83 * iconScale})`}>
        <path d={pathData} stroke={colors.secondary} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>

      {/* Tier dots at bottom */}
      {tier === 'silver' && (
        <>
          <circle cx={r - 4} cy={size - 8} r="2" fill={colors.primary} />
          <circle cx={r + 4} cy={size - 8} r="2" fill={colors.primary} />
        </>
      )}
      {tier === 'gold' && (
        <>
          <circle cx={r - 6} cy={size - 8} r="2" fill={colors.primary} />
          <circle cx={r} cy={size - 8} r="2" fill={colors.primary} />
          <circle cx={r + 6} cy={size - 8} r="2" fill={colors.primary} />
        </>
      )}
      {tier === 'diamond' && (
        <>
          <circle cx={r - 8} cy={size - 8} r="2" fill={colors.primary} />
          <circle cx={r - 3} cy={size - 8} r="2" fill={colors.primary} />
          <circle cx={r + 3} cy={size - 8} r="2" fill={colors.primary} />
          <circle cx={r + 8} cy={size - 8} r="2" fill={colors.primary} />
        </>
      )}
      {tier === 'bronze' && (
        <circle cx={r} cy={size - 8} r="2" fill={colors.primary} />
      )}
    </svg>
  );
}
