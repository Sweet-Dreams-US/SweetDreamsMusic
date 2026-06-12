import { BEAT_GENRES } from './constants';

// Generate an SVG cover image for a beat — "SWEET DREAMS" in Anton style
// with genre-based colors on a square background
export function generateBeatCover(genre: string | null): string {
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
  <text x="400" y="360" font-family="Anton,'Impact','Arial Black',sans-serif" font-size="120" font-weight="900" fill="${textColor}" text-anchor="middle" letter-spacing="8" opacity="0.95">SWEET</text>
  <text x="400" y="490" font-family="Anton,'Impact','Arial Black',sans-serif" font-size="120" font-weight="900" fill="${textColor}" text-anchor="middle" letter-spacing="8" opacity="0.95">DREAMS</text>
  <rect x="250" y="530" width="300" height="3" fill="${textColor}" opacity="0.4" />
  ${genre ? `<text x="400" y="580" font-family="monospace" font-size="20" font-weight="600" fill="${textColor}" text-anchor="middle" opacity="0.4" letter-spacing="6">${escapeXml(genre.toUpperCase())}</text>` : ''}
</svg>`;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
