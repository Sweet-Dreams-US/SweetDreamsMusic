// ============================================================
// Achievement Definitions
// Each achievement has conditions checked automatically
// ============================================================

export type AchievementCategory = 'sessions' | 'projects' | 'metrics' | 'goals' | 'engagement' | 'milestones' | 'engineer' | 'producer' | 'revenue';

export interface AchievementDef {
  title: string;
  description: string;
  icon: string;
  xp: number;       // XP awarded on unlock
  tier: 'bronze' | 'silver' | 'gold' | 'diamond';
  category: AchievementCategory;
}

export const ACHIEVEMENTS: Record<string, AchievementDef> = {
  // === Sessions ===
  first_session: {
    title: 'First Session',
    description: 'Completed your first studio session',
    icon: 'Mic', xp: 100, tier: 'bronze', category: 'sessions',
  },
  five_sessions: {
    title: 'Regular',
    description: 'Completed 5 studio sessions',
    icon: 'Calendar', xp: 150, tier: 'silver', category: 'sessions',
  },
  ten_sessions: {
    title: 'Studio Rat',
    description: 'Completed 10 studio sessions',
    icon: 'Star', xp: 200, tier: 'gold', category: 'sessions',
  },
  twenty_five_sessions: {
    title: 'Dedicated',
    description: 'Completed 25 studio sessions',
    icon: 'Award', xp: 500, tier: 'diamond', category: 'sessions',
  },

  // === Projects ===
  first_project: {
    title: 'Project Started',
    description: 'Created your first project',
    icon: 'Folder', xp: 50, tier: 'bronze', category: 'projects',
  },
  first_release: {
    title: 'Released!',
    description: 'Released your first project',
    icon: 'Rocket', xp: 200, tier: 'silver', category: 'projects',
  },
  five_releases: {
    title: 'Prolific',
    description: 'Released 5 projects',
    icon: 'Disc', xp: 500, tier: 'gold', category: 'projects',
  },
  ten_releases: {
    title: 'Catalog Builder',
    description: 'Released 10 projects',
    icon: 'Library', xp: 750, tier: 'diamond', category: 'projects',
  },

  // === Metrics ===
  first_metric_log: {
    title: 'Data Driven',
    description: 'Logged your first metrics',
    icon: 'BarChart', xp: 50, tier: 'bronze', category: 'metrics',
  },
  four_week_streak: {
    title: 'Consistent',
    description: 'Logged metrics 4 weeks in a row',
    icon: 'Flame', xp: 150, tier: 'silver', category: 'metrics',
  },
  twelve_week_streak: {
    title: 'Data Master',
    description: 'Logged metrics 12 weeks in a row',
    icon: 'Flame', xp: 300, tier: 'gold', category: 'metrics',
  },

  // === Goals ===
  first_goal_set: {
    title: 'Ambitious',
    description: 'Set your first goal',
    icon: 'Target', xp: 50, tier: 'bronze', category: 'goals',
  },
  first_goal_completed: {
    title: 'Goal Getter',
    description: 'Completed your first goal',
    icon: 'Trophy', xp: 150, tier: 'silver', category: 'goals',
  },
  five_goals_completed: {
    title: 'Unstoppable',
    description: 'Completed 5 goals',
    icon: 'Trophy', xp: 300, tier: 'gold', category: 'goals',
  },

  // === Engineer ===
  eng_first_session: {
    title: 'First Mix',
    description: 'Engineered your first session',
    icon: 'Wrench', xp: 100, tier: 'bronze', category: 'engineer',
  },
  eng_five_sessions: {
    title: 'Board Operator',
    description: 'Engineered 5 sessions',
    icon: 'Sliders', xp: 150, tier: 'silver', category: 'engineer',
  },
  eng_ten_sessions: {
    title: 'Mix Master',
    description: 'Engineered 10 sessions',
    icon: 'Headphones', xp: 200, tier: 'gold', category: 'engineer',
  },
  eng_twenty_five_sessions: {
    title: 'Studio Veteran',
    description: 'Engineered 25 sessions',
    icon: 'Award', xp: 500, tier: 'diamond', category: 'engineer',
  },
  eng_fifty_sessions: {
    title: 'Legendary Engineer',
    description: 'Engineered 50 sessions',
    icon: 'Crown', xp: 1000, tier: 'diamond', category: 'engineer',
  },

  // === Engagement ===
  profile_complete: {
    title: 'Looking Good',
    description: 'Completed your full profile',
    icon: 'User', xp: 50, tier: 'bronze', category: 'engagement',
  },
  public_profile: {
    title: 'Going Public',
    description: 'Made your profile public',
    icon: 'Globe', xp: 50, tier: 'bronze', category: 'engagement',
  },
  first_beat_purchase: {
    title: 'Beat Buyer',
    description: 'Purchased your first beat',
    icon: 'Music', xp: 50, tier: 'bronze', category: 'engagement',
  },
  first_beat_saved: {
    title: 'Beat Collector',
    description: 'Saved your first beat',
    icon: 'Heart', xp: 50, tier: 'bronze', category: 'engagement',
  },
  first_lyrics: {
    title: 'Wordsmith',
    description: 'Wrote lyrics for the first time',
    icon: 'PenLine', xp: 50, tier: 'bronze', category: 'engagement',
  },
  first_session_notes: {
    title: 'Reviewer',
    description: 'Wrote your first session notes',
    icon: 'FileText', xp: 50, tier: 'bronze', category: 'engagement',
  },
  first_calendar_event: {
    title: 'Planner',
    description: 'Created your first calendar event',
    icon: 'Calendar', xp: 25, tier: 'bronze', category: 'engagement',
  },
  connect_platform: {
    title: 'Connected',
    description: 'Connected Spotify or YouTube',
    icon: 'Link', xp: 50, tier: 'bronze', category: 'engagement',
  },

  // === Producer ===
  first_beat_upload: {
    title: 'Beat Maker',
    description: 'Uploaded your first beat',
    icon: 'Upload', xp: 50, tier: 'bronze', category: 'producer',
  },
  five_beats_uploaded: {
    title: 'Catalog Started',
    description: 'Uploaded 5 beats',
    icon: 'Disc', xp: 150, tier: 'silver', category: 'producer',
  },
  ten_beats_uploaded: {
    title: 'Hit Factory',
    description: 'Uploaded 10 beats',
    icon: 'Disc', xp: 300, tier: 'gold', category: 'producer',
  },
  first_lease_sold: {
    title: 'First Sale',
    description: 'Sold your first lease',
    icon: 'DollarSign', xp: 100, tier: 'bronze', category: 'producer',
  },
  five_leases_sold: {
    title: 'Moving Units',
    description: 'Sold 5 leases',
    icon: 'TrendingUp', xp: 200, tier: 'silver', category: 'producer',
  },
  twenty_five_leases_sold: {
    title: 'Beat Mogul',
    description: 'Sold 25 leases',
    icon: 'Crown', xp: 500, tier: 'gold', category: 'producer',
  },
  first_exclusive_sold: {
    title: 'Exclusive Deal',
    description: 'Sold your first exclusive',
    icon: 'Star', xp: 200, tier: 'silver', category: 'producer',
  },
  five_exclusives_sold: {
    title: 'Top Producer',
    description: 'Sold 5 exclusives',
    icon: 'Crown', xp: 750, tier: 'diamond', category: 'producer',
  },

  // === Engineer (expanded) ===
  eng_hundred_sessions: {
    title: 'Century Club',
    description: 'Engineered 100 sessions',
    icon: 'Award', xp: 1500, tier: 'diamond', category: 'engineer',
  },
  eng_first_media_sale: {
    title: 'Media Seller',
    description: 'Made your first media sale',
    icon: 'Camera', xp: 100, tier: 'bronze', category: 'engineer',
  },
  eng_five_media_sales: {
    title: 'Content Creator',
    description: 'Made 5 media sales',
    icon: 'Camera', xp: 200, tier: 'silver', category: 'engineer',
  },

  // === Revenue Milestones ===
  earned_500: {
    title: 'First Check',
    description: 'Earned $500+ on the platform',
    icon: 'DollarSign', xp: 100, tier: 'bronze', category: 'revenue',
  },
  earned_2500: {
    title: 'Stacking Up',
    description: 'Earned $2,500+ on the platform',
    icon: 'DollarSign', xp: 250, tier: 'silver', category: 'revenue',
  },
  earned_10000: {
    title: 'Five Figures',
    description: 'Earned $10,000+ on the platform',
    icon: 'DollarSign', xp: 500, tier: 'gold', category: 'revenue',
  },
  earned_25000: {
    title: 'Big Money',
    description: 'Earned $25,000+ on the platform',
    icon: 'DollarSign', xp: 1000, tier: 'diamond', category: 'revenue',
  },

  // === Engagement (expanded) ===
  first_private_sale: {
    title: 'Direct Deal',
    description: 'Completed your first private beat sale',
    icon: 'Handshake', xp: 75, tier: 'bronze', category: 'engagement',
  },

  // === Milestones ===
  level_5: {
    title: 'Getting Started',
    description: 'Reached Level 5',
    icon: 'Zap', xp: 100, tier: 'bronze', category: 'milestones',
  },
  level_10: {
    title: 'On the Rise',
    description: 'Reached Level 10',
    icon: 'Zap', xp: 200, tier: 'silver', category: 'milestones',
  },
  level_25: {
    title: 'Committed Artist',
    description: 'Reached Level 25',
    icon: 'Zap', xp: 500, tier: 'gold', category: 'milestones',
  },
  level_50: {
    title: 'Veteran',
    description: 'Reached Level 50',
    icon: 'Crown', xp: 1000, tier: 'diamond', category: 'milestones',
  },
  seven_day_streak: {
    title: 'Week Warrior',
    description: '7-day hub visit streak',
    icon: 'Flame', xp: 100, tier: 'bronze', category: 'milestones',
  },
  thirty_day_streak: {
    title: 'Monthly Grinder',
    description: '30-day hub visit streak',
    icon: 'Flame', xp: 300, tier: 'silver', category: 'milestones',
  },
  hundred_tasks: {
    title: 'Task Machine',
    description: 'Completed 100 tasks across all projects',
    icon: 'CheckCircle', xp: 300, tier: 'gold', category: 'milestones',
  },

  // ── Career path (Plan 6) — granted ONLY by the career rule engine ─────────
  // Stage-ups
  stage_2_catalog:      { title: 'Catalog Builder',  description: 'Reached Stage 2 — every Foundation gate verified', icon: 'Music',      xp: 250,  tier: 'silver',  category: 'milestones' },
  stage_3_audience:     { title: 'Audience Earned',  description: 'Reached Stage 3 — catalog complete, audience growing', icon: 'TrendingUp', xp: 400, tier: 'gold', category: 'milestones' },
  stage_4_monetizing:   { title: 'Open for Business', description: 'Reached Stage 4 — your art makes money', icon: 'DollarSign', xp: 600,  tier: 'gold',    category: 'milestones' },
  stage_5_professional: { title: 'Professional',     description: 'Reached Stage 5 — full-time trajectory, verified', icon: 'Award', xp: 1000, tier: 'diamond', category: 'milestones' },
  // Listener tiers (permanent certifications — numeric naming, never RIAA-ish)
  tier_10k:  { title: '10K Club',  description: '10,000+ verified monthly listeners, two consecutive weeks',  icon: 'Headphones', xp: 300,  tier: 'silver',  category: 'metrics' },
  tier_50k:  { title: '50K Club',  description: '50,000+ verified monthly listeners',  icon: 'Headphones', xp: 500,  tier: 'gold',    category: 'metrics' },
  tier_100k: { title: '100K Club', description: '100,000+ verified monthly listeners — plaque earned', icon: 'Headphones', xp: 800, tier: 'gold', category: 'metrics' },
  tier_200k: { title: '200K Club', description: '200,000+ verified monthly listeners', icon: 'Headphones', xp: 1000, tier: 'gold',    category: 'metrics' },
  tier_500k: { title: '500K Club', description: '500,000+ verified monthly listeners', icon: 'Headphones', xp: 1500, tier: 'diamond', category: 'metrics' },
  tier_1m:   { title: '1M Club',   description: '1,000,000+ verified monthly listeners', icon: 'Headphones', xp: 2000, tier: 'diamond', category: 'metrics' },
  tier_2m:   { title: '2M Club',   description: '2,000,000+ verified monthly listeners', icon: 'Headphones', xp: 2500, tier: 'diamond', category: 'metrics' },
  tier_5m:   { title: '5M Club',   description: '5,000,000+ verified monthly listeners', icon: 'Headphones', xp: 3000, tier: 'diamond', category: 'metrics' },
  tier_10m:  { title: '10M Club',  description: '10,000,000+ verified monthly listeners', icon: 'Headphones', xp: 5000, tier: 'diamond', category: 'metrics' },
  // Shows
  first_show:      { title: 'First Show',      description: 'Performed your first live show (booked ahead, confirmed after)', icon: 'Mic',  xp: 75,  tier: 'bronze', category: 'engagement' },
  five_shows:      { title: 'Road Tested',     description: 'Performed 5 live shows', icon: 'Mic',  xp: 200, tier: 'silver', category: 'engagement' },
  first_paid_show: { title: 'Paid to Play',    description: 'Performed your first PAID show', icon: 'DollarSign', xp: 150, tier: 'silver', category: 'engagement' },
  first_headline:  { title: 'Name on the Marquee', description: 'Headlined or co-headlined a show', icon: 'Star', xp: 250, tier: 'gold', category: 'engagement' },
  // Rollouts
  rollout_60:      { title: 'Planned Drop',    description: 'Scored 60+ on a release rollout', icon: 'Target', xp: 100, tier: 'bronze', category: 'projects' },
  rollout_85:      { title: 'Proper Rollout',  description: 'Scored 85+ on a release rollout', icon: 'Target', xp: 200, tier: 'silver', category: 'projects' },
  rollout_perfect: { title: 'Flawless Campaign', description: 'Scored a perfect 100 rollout', icon: 'Target', xp: 400, tier: 'gold', category: 'projects' },
  // Sharing
  first_share_link: { title: 'First Listen',    description: 'Sent your first private listening link', icon: 'Share2', xp: 50, tier: 'bronze', category: 'engagement' },
  feedback_x10:     { title: 'Focus Group',     description: 'Collected 10 pieces of track feedback', icon: 'MessageCircle', xp: 150, tier: 'silver', category: 'engagement' },
  listening_party:  { title: 'Listening Party', description: '25 plays on a single private link', icon: 'Headphones', xp: 250, tier: 'gold', category: 'engagement' },
  // Consistency
  six_releases_year: { title: 'Machine Mode',  description: '6 releases inside 12 months', icon: 'Repeat', xp: 500, tier: 'gold', category: 'projects' },
  first_collab:      { title: 'Better Together', description: 'Released your first collab', icon: 'Users', xp: 150, tier: 'silver', category: 'projects' },
};

// Tier colors for badge styling (Tailwind classes)
export const TIER_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  bronze: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', glow: 'shadow-amber-200' },
  silver: { bg: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-600', glow: 'shadow-gray-200' },
  gold: { bg: 'bg-yellow-50', border: 'border-yellow-400', text: 'text-yellow-700', glow: 'shadow-yellow-200' },
  diamond: { bg: 'bg-cyan-50', border: 'border-cyan-300', text: 'text-cyan-700', glow: 'shadow-cyan-200' },
};

// Tier hex colors for SVG badge rendering
export const TIER_HEX: Record<string, { primary: string; secondary: string; bg: string; glow: string }> = {
  bronze: { primary: '#CD7F32', secondary: '#A0522D', bg: '#FDF2E6', glow: '#CD7F3240' },
  silver: { primary: '#A8A8A8', secondary: '#707070', bg: '#F5F5F5', glow: '#A8A8A840' },
  gold: { primary: '#F4C430', secondary: '#DAA520', bg: '#FFF9E6', glow: '#F4C43060' },
  diamond: { primary: '#4FD1C5', secondary: '#2C7A7B', bg: '#E6FFFA', glow: '#4FD1C560' },
};
