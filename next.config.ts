import type { NextConfig } from "next";

// Posts that used to be written straight into the blog_posts database table.
// They are no longer shown: the blog now comes only from the markdown files in
// content/blog. The full text of each one is saved in the client blog folder
// (blog/extra), and the old addresses redirect to the blog index.
const LEGACY_BLOG_SLUGS = [
  'art-of-mixing-balance-space-dimension',
  'ascap-vs-bmi-pros-explained',
  'beat-licensing-explained-lease-vs-exclusive',
  'building-artist-brand-from-zero',
  'chord-progressions-i-iv-v-vi',
  'chords-triads-seventh-chords',
  'circle-of-fifths-key-signatures',
  'compression-explained-attack-release-ratio',
  'copyright-101-every-artist-must-know',
  'daw-comparison-pro-tools-logic-ableton',
  'eq-fundamentals-shaping-sound',
  'home-studio-setup-budget',
  'how-music-industry-works',
  'melody-writing-hooks-motifs',
  'microphone-types-dynamic-condenser-ribbon',
  'mixing-vocals-chains-techniques',
  'music-publishing-explained',
  'music-theory-101-notes-scales-intervals',
  'music-theory-for-producers',
  'nashville-number-system',
  'recording-vocals-like-a-pro',
  'reverb-delay-creating-space',
  'social-media-strategy-musicians-2026',
  'song-structure-verse-chorus-bridge',
  'spotify-playlists-real-way',
  'streaming-royalties-how-they-work',
  'time-signatures-rhythm-basics',
  'why-minor-chords-sound-sad',
];

const nextConfig: NextConfig = {
  // The blog reads content/blog from disk at request time (that is how a post
  // releases on its date without a deploy). The navigation checks for released
  // posts on every page, so ship the files with every route.
  outputFileTracingIncludes: {
    '/**': ['./content/blog/**/*'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'fweeyjnqwxywmpmnqpts.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'customer-w6h9o08eg118alny.cloudflarestream.com',
      },
    ],
  },
  // 2026-09 media pivot: recording sessions + studio booking are gone. The old
  // marketing/booking URLs still get organic + social traffic, so send them to
  // the /recording landing page (explains the change + the partner studio).
  // Exact-path matches only — /book/invite/[token] and /book/success keep
  // working for any historical session links.
  async redirects() {
    return [
      { source: '/book', destination: '/recording', permanent: true },
      { source: '/pricing', destination: '/recording', permanent: true },
      { source: '/engineers', destination: '/recording', permanent: true },
      // Old database blog: category pages and the posts that were taken off.
      { source: '/blog/category/:path*', destination: '/blog', permanent: true },
      ...LEGACY_BLOG_SLUGS.map((slug) => ({
        source: `/blog/${slug}`,
        destination: '/blog',
        permanent: true,
      })),
    ];
  },
};

export default nextConfig;
