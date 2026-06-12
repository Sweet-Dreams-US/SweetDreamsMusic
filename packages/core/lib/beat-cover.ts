import { BEAT_GENRES } from './constants';

// Generate an SVG cover image for a beat — the brand name in Anton style
// with genre-based colors on a square background. `brandName` is optional
// (default = the historical short-form literal) so existing call sites keep
// emitting the legacy "SWEET DREAMS" artwork byte-identically; pass the real
// brand name (b.name) to white-label the cover.
export function generateBeatCover(genre: string | null, brandName = 'Sweet Dreams'): string {
  const genreConfig = BEAT_GENRES.find(g => g.value === genre);
  const bg = genreConfig?.bg || '#1a1a1a';
  const textColor = genreConfig?.text || '#F4C430';

  // Darken the background slightly for depth
  function adjustColor(hex: string, amount: number): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, Math.min(255, ((num >> 16) & 0xFF) + amount));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0xFF) + amount));
    const b = Math.max(0, Math.min(255, (num & 0xFF) + amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  const bgDark = adjustColor(bg, -20);

  // One uppercased word per line, stacked around the canvas midline (y=425).
  // Two ≤9-char words reproduce the legacy "SWEET DREAMS" layout EXACTLY
  // (y=360/490, font-size 120); longer words scale down to stay inside the
  // 700px inner frame, and the divider/genre block tracks the last line.
  const words = brandName.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const lines = words.length > 0 ? words : ['BEATS'];
  const lineHeight = 130;
  const firstY = 425 - 65 * (lines.length - 1);
  const lastY = firstY + lineHeight * (lines.length - 1);
  const titleLines = lines
    .map((word, i) =>
      `  <text x="400" y="${firstY + i * lineHeight}" font-family="Anton,'Impact','Arial Black',sans-serif" font-size="${Math.min(120, Math.floor(1080 / word.length))}" font-weight="900" fill="${textColor}" text-anchor="middle" letter-spacing="8" opacity="0.95">${escapeXml(word)}</text>`)
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${bg}" />
      <stop offset="100%" style="stop-color:${bgDark}" />
    </linearGradient>
  </defs>
  <rect width="800" height="800" fill="url(#bg)" />
  <line x1="0" y1="400" x2="800" y2="400" stroke="${textColor}" stroke-opacity="0.06" stroke-width="1" />
  <line x1="400" y1="0" x2="400" y2="800" stroke="${textColor}" stroke-opacity="0.06" stroke-width="1" />
  <rect x="50" y="50" width="700" height="700" fill="none" stroke="${textColor}" stroke-opacity="0.08" stroke-width="1" />
${titleLines}
  <rect x="250" y="${lastY + 40}" width="300" height="3" fill="${textColor}" opacity="0.4" />
  ${genre ? `<text x="400" y="${lastY + 90}" font-family="monospace" font-size="20" font-weight="600" fill="${textColor}" text-anchor="middle" opacity="0.4" letter-spacing="6">${escapeXml(genre.toUpperCase())}</text>` : ''}
</svg>`;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
