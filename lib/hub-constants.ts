// ============================================================
// Artist Hub Constants
// ============================================================

// Project phases in order
export const PROJECT_PHASES = [
  { key: 'concept', label: 'Concept', description: 'Define your vision' },
  { key: 'writing', label: 'Writing', description: 'Create the music' },
  { key: 'recording', label: 'Recording', description: 'Lay it down' },
  { key: 'mixing', label: 'Mixing', description: 'Shape the sound' },
  { key: 'mastering', label: 'Mastering', description: 'Polish to perfection' },
  { key: 'distribution', label: 'Distribution', description: 'Get it out there' },
  { key: 'promotion', label: 'Promotion', description: 'Build the buzz' },
  { key: 'released', label: 'Released', description: 'It\'s live!' },
] as const;

export type ProjectPhase = (typeof PROJECT_PHASES)[number]['key'];

// Default tasks per phase
export const DEFAULT_PHASE_TASKS: Record<ProjectPhase, string[]> = {
  concept: ['Define project vision & direction', 'Choose project type (single/EP/album)', 'Set target release date', 'Create mood board or reference tracks'],
  writing: ['Write or select songs', 'Finalize song structures', 'Create demo recordings', 'Get feedback from trusted ears'],
  recording: ['Book studio sessions', 'Record vocals & instruments', 'Review raw recordings', 'Re-record any takes if needed'],
  mixing: ['Select mix engineer', 'Provide reference mixes', 'Review first mix', 'Request revisions', 'Approve final mix'],
  mastering: ['Select mastering engineer', 'Review master', 'Approve final master', 'Request alternate masters if needed'],
  distribution: ['Choose distributor (DistroKid, TuneCore, etc.)', 'Upload to distributor', 'Set official release date', 'Create pre-save link', 'Register with BMI/ASCAP if needed'],
  promotion: ['Create cover artwork', 'Write press release or bio', 'Plan social media rollout', 'Submit to playlist curators', 'Send to press & blogs', 'Plan release day content'],
  released: ['Share release links everywhere', 'Monitor first-week metrics', 'Thank supporters', 'Plan follow-up content', 'Pitch for playlist adds'],
};

// Project types
export const PROJECT_TYPES = [
  { value: 'single', label: 'Single' },
  { value: 'ep', label: 'EP' },
  { value: 'album', label: 'Album' },
  { value: 'music_video', label: 'Music Video' },
  { value: 'mixtape', label: 'Mixtape' },
  { value: 'deluxe', label: 'Deluxe' },
  { value: 'other', label: 'Other' },
] as const;

export type ProjectType = (typeof PROJECT_TYPES)[number]['value'];

// Career stages
export const CAREER_STAGES = [
  { value: 'emerging', label: 'Emerging', description: 'Just getting started' },
  { value: 'developing', label: 'Developing', description: 'Building your foundation' },
  { value: 'established', label: 'Established', description: 'Growing your audience' },
  { value: 'professional', label: 'Professional', description: 'Full-time artist' },
] as const;

export type CareerStage = (typeof CAREER_STAGES)[number]['value'];

// Goal categories
export const GOAL_CATEGORIES = [
  { value: 'streaming', label: 'Streaming', icon: 'Headphones' },
  { value: 'social', label: 'Social Media', icon: 'Users' },
  { value: 'releases', label: 'Releases', icon: 'Disc' },
  { value: 'shows', label: 'Live Shows', icon: 'Mic' },
  { value: 'business', label: 'Business', icon: 'DollarSign' },
  { value: 'other', label: 'Other', icon: 'Target' },
] as const;

export type GoalCategory = (typeof GOAL_CATEGORIES)[number]['value'];

// Metrics platforms — expanded with more fields and new platforms.
// autoFetchable is FALSE for everything: all platforms are link-only, recorded
// by the weekly agent run (Cowork). No platform APIs (per Cole — the Spotify/
// YouTube keys were never configured in prod anyway). Apple Music alone is
// self-logged (no public page to read).
export const METRIC_PLATFORMS = [
  { key: 'spotify', label: 'Spotify', color: '#1DB954', icon: '🟢',
    fields: ['monthly_listeners', 'followers', 'streams', 'saves', 'playlist_adds', 'popularity_score'],
    primaryField: 'monthly_listeners', autoFetchable: false },
  { key: 'apple_music', label: 'Apple Music', color: '#FC3C44', icon: '🍎',
    fields: ['plays', 'shazams'],
    primaryField: 'plays', autoFetchable: false },
  { key: 'instagram', label: 'Instagram', color: '#E4405F', icon: '📸',
    fields: ['followers', 'posts_count', 'avg_likes', 'avg_comments', 'reels_views', 'engagement_rate'],
    primaryField: 'followers', autoFetchable: false },
  { key: 'tiktok', label: 'TikTok', color: '#000000', icon: '🎵',
    fields: ['followers', 'total_likes', 'avg_views', 'videos_count', 'engagement_rate'],
    primaryField: 'followers', autoFetchable: false },
  { key: 'youtube', label: 'YouTube', color: '#FF0000', icon: '▶️',
    fields: ['subscribers', 'total_views', 'avg_views', 'watch_hours', 'engagement_rate'],
    primaryField: 'subscribers', autoFetchable: false },
  { key: 'soundcloud', label: 'SoundCloud', color: '#FF5500', icon: '☁️',
    fields: ['followers', 'streams', 'reposts', 'comments'],
    primaryField: 'followers', autoFetchable: false },
  { key: 'twitter', label: 'X / Twitter', color: '#000000', icon: '𝕏',
    fields: ['followers', 'avg_likes', 'impressions'],
    primaryField: 'followers', autoFetchable: false },
  // Facebook completes the trackable set. Audiomack + Deezer were CUT
  // (2026-06-10, Cole's field test): their public pages don't visibly show
  // fan counts a human agent can read — nothing recordable, dead cards.
  { key: 'facebook', label: 'Facebook', color: '#1877F2', icon: '📘',
    fields: ['followers'],
    primaryField: 'followers', autoFetchable: false },
] as const;

export type MetricPlatform = (typeof METRIC_PLATFORMS)[number]['key'];

// Field display names for metric fields
export const METRIC_FIELD_LABELS: Record<string, string> = {
  monthly_listeners: 'Monthly Listeners',
  followers: 'Followers',
  streams: 'Streams',
  saves: 'Saves',
  playlist_adds: 'Playlist Adds',
  popularity_score: 'Popularity',
  plays: 'Plays',
  shazams: 'Shazams',
  posts_count: 'Posts',
  avg_likes: 'Avg Likes',
  avg_comments: 'Avg Comments',
  reels_views: 'Reels Views',
  total_likes: 'Total Likes',
  avg_views: 'Avg Views',
  videos_count: 'Videos',
  subscribers: 'Subscribers',
  total_views: 'Total Views',
  watch_hours: 'Watch Hours',
  engagement_rate: 'Engagement %',
  reposts: 'Reposts',
  comments: 'Comments',
  impressions: 'Impressions',
};

// Calendar event types with colors
export const EVENT_TYPES = [
  { value: 'release', label: 'Release', color: '#F4C430' },
  { value: 'social_post', label: 'Social Post', color: '#3B82F6' },
  { value: 'video', label: 'Video', color: '#EF4444' },
  { value: 'live_show', label: 'Live Show', color: '#10B981' },
  { value: 'studio_session', label: 'Studio Session', color: '#000000' },
  { value: 'other', label: 'Other', color: '#6B7280' },
] as const;

export type EventType = (typeof EVENT_TYPES)[number]['value'];

// Hub tabs
export const HUB_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'projects', label: 'Projects' },
  { key: 'goals', label: 'Goals' },
  { key: 'metrics', label: 'Metrics' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'media', label: 'Media' },
  { key: 'events', label: 'Events' },
  { key: 'bands', label: 'Bands' },
  { key: 'achievements', label: 'Achievements' },
  { key: 'perks', label: 'Perks' },
  { key: 'roadmap', label: 'Roadmap' },
] as const;

export type HubTab = (typeof HUB_TABS)[number]['key'];
