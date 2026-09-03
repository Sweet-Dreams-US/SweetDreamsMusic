// lib/portfolio.ts — embedded portfolio videos (YouTube IDs). Shared by the
// home page ("Selected Work") and /media ("Music videos we've made"). Add IDs
// here when new videos go live; small enough to keep inline rather than paying
// for a CMS round trip. The Sweet Spot leads — it's the flagship live-band
// format and the most recent release.

export const PORTFOLIO_VIDEOS = [
  { id: 'hvfjYGGmcMQ', title: 'The Sweet Spot — Live Band Session' },
  { id: 'tyQStwbljvo', title: 'Music Video' },
  { id: 'aVDCLVVbVBM', title: 'Music Video' },
  { id: '7BKNcbAsTaQ', title: 'Music Video' },
  { id: 'QWmJm75ryxY', title: 'Music Video' },
  { id: '270fw_HtGds', title: 'Music Video' },
] as const;
