// ============================================================
// XP & Leveling System for Artist Hub
// ============================================================

// XP needed to advance FROM level N to level N+1
// Starts fast (80 XP for level 2), gradually gets harder
// Level 10: ~3,000 total XP | Level 50: ~100k | Level 100: ~500k
export function xpForNextLevel(level: number): number {
  return Math.floor(50 + 30 * Math.pow(level, 1.3));
}

// Total cumulative XP needed to REACH a given level
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 1; i < level; i++) {
    total += xpForNextLevel(i);
  }
  return total;
}

// Given total XP, calculate current level and progress
export function calculateLevel(totalXp: number): {
  level: number;
  currentLevelXp: number;   // XP earned within current level
  nextLevelXp: number;      // XP needed to reach next level
  progress: number;          // 0-100 percentage
  totalXp: number;
} {
  let level = 1;
  let remaining = totalXp;

  while (true) {
    const needed = xpForNextLevel(level);
    if (remaining < needed) {
      return {
        level,
        currentLevelXp: remaining,
        nextLevelXp: needed,
        progress: Math.min(100, Math.round((remaining / needed) * 100)),
        totalXp,
      };
    }
    remaining -= needed;
    level++;
  }
}

// Level title based on level ranges
export function getLevelTitle(level: number): string {
  if (level <= 3) return 'Newcomer';
  if (level <= 7) return 'Rising';
  if (level <= 12) return 'Committed';
  if (level <= 18) return 'Dedicated';
  if (level <= 25) return 'Skilled';
  if (level <= 35) return 'Established';
  if (level <= 50) return 'Veteran';
  if (level <= 70) return 'Master';
  if (level <= 100) return 'Legend';
  return 'Icon';
}

// Level color gradient based on level
export function getLevelColor(level: number): string {
  if (level <= 5) return '#9CA3AF';   // gray
  if (level <= 10) return '#3B82F6';  // blue
  if (level <= 20) return '#8B5CF6';  // purple
  if (level <= 35) return '#F4C430';  // gold
  if (level <= 50) return '#F97316';  // orange
  if (level <= 75) return '#EF4444';  // red
  if (level <= 100) return '#EC4899'; // pink
  return '#F4C430';                   // diamond gold
}

// ============================================================
// XP Action Values
// ============================================================
export const XP_ACTIONS = {
  // Daily & streaks
  hub_visit: { xp: 10, label: 'Daily Hub Visit', once_per_day: true },
  daily_streak: { xp: 5, label: 'Daily Streak Bonus' }, // multiplied by streak count (capped at 10)
  first_login_streak_3: { xp: 50, label: '3-Day Streak Milestone', unique: true },
  first_login_streak_7: { xp: 100, label: '7-Day Streak Milestone', unique: true },

  // Projects & tasks
  create_project: { xp: 15, label: 'Created a Project' },
  complete_task: { xp: 10, label: 'Completed a Task' },
  advance_phase: { xp: 50, label: 'Advanced Project Phase' },
  complete_project: { xp: 200, label: 'Completed a Project' },

  // Goals
  set_goal: { xp: 15, label: 'Set a New Goal' },
  update_goal: { xp: 5, label: 'Updated Goal Progress' },
  complete_goal: { xp: 30, label: 'Completed a Goal' },

  // Sessions & booking
  book_session: { xp: 50, label: 'Booked a Session' },
  complete_session: { xp: 75, label: 'Completed a Session' },
  log_session_notes: { xp: 15, label: 'Logged Session Notes' },

  // Beat store
  purchase_beat: { xp: 40, label: 'Purchased a Beat' },

  // Calendar & metrics
  add_calendar_event: { xp: 10, label: 'Added Calendar Event' },
  log_metrics: { xp: 15, label: 'Logged Metrics' },

  // Profile & platform
  complete_profile: { xp: 25, label: 'Completed Profile', unique: true },
  connect_platform: { xp: 20, label: 'Connected a Platform' },
  upload_to_profile: { xp: 15, label: 'Shared File on Profile' },

  // Roadmap & achievements
  complete_roadmap_item: { xp: 10, label: 'Completed Roadmap Item' },
  unlock_achievement: { xp: 100, label: 'Unlocked Achievement' },
  earn_achievement: { xp: 0, label: 'Earned Achievement' }, // XP varies, passed via override
  // Career path (Plan 6): per-requirement XP — value passed via xpOverride
  // from career_stage_requirements.xp_award. Verified-heavy by design.
  career_requirement: { xp: 10, label: 'Career Requirement Complete' },
  release_project: { xp: 200, label: 'Released a Project' }, // scaled by rollout score at award time
} as const;

export type XpAction = keyof typeof XP_ACTIONS;

// ============================================================
// Platform Level Thresholds (follower/listener-based)
// ============================================================
export const PLATFORM_LEVEL_THRESHOLDS = [
  0,        // Level 1
  50,       // Level 2
  100,      // Level 3
  250,      // Level 4
  500,      // Level 5
  1000,     // Level 6
  2500,     // Level 7
  5000,     // Level 8
  10000,    // Level 9
  25000,    // Level 10
  50000,    // Level 11
  100000,   // Level 12
  250000,   // Level 13
  500000,   // Level 14
  1000000,  // Level 15
] as const;

export function getPlatformLevel(followers: number): {
  level: number;
  nextThreshold: number | null;
  progress: number;
} {
  let level = 1;
  for (let i = 1; i < PLATFORM_LEVEL_THRESHOLDS.length; i++) {
    if (followers >= PLATFORM_LEVEL_THRESHOLDS[i]) {
      level = i + 1;
    } else {
      break;
    }
  }
  const currentThreshold = PLATFORM_LEVEL_THRESHOLDS[level - 1] ?? 0;
  const nextThreshold = PLATFORM_LEVEL_THRESHOLDS[level] ?? null;
  const progress = nextThreshold
    ? Math.min(100, Math.round(((followers - currentThreshold) / (nextThreshold - currentThreshold)) * 100))
    : 100;

  return { level, nextThreshold, progress };
}

export function getPlatformLevelTitle(level: number): string {
  if (level <= 2) return 'Starting Out';
  if (level <= 4) return 'Building';
  if (level <= 6) return 'Growing';
  if (level <= 8) return 'Buzzing';
  if (level <= 10) return 'Popping';
  if (level <= 12) return 'Viral';
  if (level <= 14) return 'Major';
  return 'Superstar';
}

// ============================================================
// Server-side XP Award Helper (use in API routes / webhooks)
// ============================================================
// Requires a Supabase client (service or authenticated).
// Handles dedup via reference_id, unique actions, and profile update.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function awardXP(
  supabase: any,
  userId: string,
  action: XpAction,
  opts?: {
    referenceId?: string;
    metadata?: Record<string, unknown>;
    xpOverride?: number;
  },
): Promise<{ awarded: boolean; xp: number; error?: string }> {
  const xpAction = XP_ACTIONS[action];
  if (!xpAction) return { awarded: false, xp: 0, error: 'Unknown action' };

  const xpAmount = opts?.xpOverride ?? xpAction.xp;
  if (xpAmount <= 0 && !opts?.xpOverride) return { awarded: false, xp: 0, error: 'Zero XP' };

  // Dedup: if reference_id provided, check for existing entry
  if (opts?.referenceId) {
    const { data: existing } = await supabase
      .from('xp_log')
      .select('id')
      .eq('user_id', userId)
      .eq('action', action)
      .eq('reference_id', opts.referenceId)
      .limit(1);
    if (existing && existing.length > 0) {
      return { awarded: false, xp: 0, error: 'Already awarded for this reference' };
    }
  }

  // Unique actions (one-time ever): check if already earned
  if ('unique' in xpAction && xpAction.unique) {
    const { data: existing } = await supabase
      .from('xp_log')
      .select('id')
      .eq('user_id', userId)
      .eq('action', action)
      .limit(1);
    if (existing && existing.length > 0) {
      return { awarded: false, xp: 0, error: 'Already earned (unique action)' };
    }
  }

  // Insert xp_log entry. The partial UNIQUE index (migration 083) on
  // (user_id, action, reference_id) is the real race guard — if two hooks fire
  // at once, one insert wins and the other hits 23505; we treat that as
  // "already awarded" rather than double-crediting the profile total.
  const { error: logError } = await supabase.from('xp_log').insert({
    user_id: userId,
    action,
    xp_amount: xpAmount,
    label: xpAction.label,
    reference_id: opts?.referenceId || null,
    metadata: opts?.metadata || {},
  });

  if (logError) {
    if ((logError as { code?: string }).code === '23505') return { awarded: false, xp: 0, error: 'Already awarded (race)' };
    return { awarded: false, xp: 0, error: logError.message };
  }

  // Update profile totals. userId here is the AUTH user id — profiles are
  // keyed by user_id (profiles.id is a different PK; the old `.eq('id', …)`
  // matched zero rows, so XP was logged but never totaled. Career-path fix.)
  const { data: profile } = await supabase
    .from('profiles')
    .select('total_xp')
    .eq('user_id', userId)
    .single();

  const newTotal = (profile?.total_xp || 0) + xpAmount;
  const levelInfo = calculateLevel(newTotal);

  await supabase
    .from('profiles')
    .update({ total_xp: newTotal, artist_level: levelInfo.level })
    .eq('user_id', userId);

  return { awarded: true, xp: xpAmount };
}
