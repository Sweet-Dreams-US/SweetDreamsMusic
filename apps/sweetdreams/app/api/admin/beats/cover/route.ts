import { NextRequest, NextResponse } from 'next/server';
import { BEAT_GENRES } from '@/lib/constants';

// Generate a cover art SVG for a beat based on genre
export async function POST(request: NextRequest) {
  const { genre, title } = await request.json();

  const genreConfig = BEAT_GENRES.find(g => g.value === genre);
  const bg = genreConfig?.bg || '#1a1a1a';
  const textColor = genreConfig?.text || '#e6c94a';

  // Create SVG cover art — Sweet Dreams branding + beat title
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${bg};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${adjustColor(bg, -30)};stop-opacity:1" />
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${textColor};stop-opacity:0.6" />
      <stop offset="100%" style="stop-color:${textColor};stop-opacity:0" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="800" height="800" fill="url(#bg)" />

  <!-- Subtle geometric pattern -->
  <line x1="0" y1="600" x2="800" y2="600" stroke="${textColor}" stroke-opacity="0.08" stroke-width="1" />
  <line x1="0" y1="200" x2="800" y2="200" stroke="${textColor}" stroke-opacity="0.08" stroke-width="1" />
  <line x1="600" y1="0" x2="600" y2="800" stroke="${textColor}" stroke-opacity="0.05" stroke-width="1" />
  <line x1="200" y1="0" x2="200" y2="800" stroke="${textColor}" stroke-opacity="0.05" stroke-width="1" />

  <!-- Accent bar -->
  <rect x="60" y="580" width="120" height="4" fill="${textColor}" opacity="0.7" />

  <!-- SWEET DREAMS branding -->
  <text x="60" y="660" font-family="'Anton', Impact, 'Arial Black', sans-serif" font-size="72" font-weight="900" letter-spacing="4" fill="${textColor}" opacity="0.9">SWEET</text>
  <text x="60" y="740" font-family="'Anton', Impact, 'Arial Black', sans-serif" font-size="72" font-weight="900" letter-spacing="4" fill="${textColor}" opacity="0.9">DREAMS</text>

  <!-- Beat title -->
  <text x="60" y="540" font-family="'Inter', 'Helvetica Neue', sans-serif" font-size="${getTitleFontSize(title || 'Untitled')}" font-weight="700" fill="white" opacity="0.95">${escapeXml(title || 'Untitled')}</text>

  <!-- Genre tag -->
  ${genre ? `<text x="60" y="120" font-family="'Inter', monospace" font-size="18" font-weight="600" fill="${textColor}" opacity="0.5" letter-spacing="6" text-transform="uppercase">${escapeXml(genre.toUpperCase())}</text>` : ''}

  <!-- Corner mark -->
  <rect x="740" y="40" width="24" height="24" fill="${textColor}" opacity="0.15" />
</svg>`;

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000',
    },
  });
}

function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xFF) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xFF) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xFF) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function getTitleFontSize(title: string): number {
  if (title.length <= 10) return 56;
  if (title.length <= 18) return 44;
  if (title.length <= 28) return 36;
  return 28;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
