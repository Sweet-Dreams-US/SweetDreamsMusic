// components/media/InstagramFeedSection.tsx — public "On Instagram" strip
// (Phase 5 of the marketing hub): the studio's latest Instagram posts rendered
// server-side from the IG API (15-min cached in lib/meta-social).
//
// ADDITIVE + fail-silent: any API hiccup (or missing env in a preview build)
// renders nothing — this section must never break the page it's mounted on.

import { Instagram } from 'lucide-react';
import { getRecentIgMedia, getIgProfile, type IgMediaItem } from '@/lib/meta-social';

export default async function InstagramFeedSection() {
  let media: IgMediaItem[] = [];
  let username = 'sweetdreamsmusic.us';
  try {
    const [items, profile] = await Promise.all([getRecentIgMedia(8), getIgProfile()]);
    media = items.filter((m) => m.mediaUrl || m.thumbnailUrl);
    username = profile.username;
  } catch {
    return null; // fail silent — additive section
  }
  if (media.length === 0) return null;

  return (
    <section className="bg-black text-white py-14 sm:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <p className="font-mono text-sm font-semibold tracking-[0.3em] uppercase mb-2 text-white/50">
              Behind the scenes
            </p>
            <h2 className="text-heading-xl">ON INSTAGRAM</h2>
          </div>
          <a
            href={`https://instagram.com/${username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs font-bold uppercase tracking-wider text-accent hover:underline no-underline inline-flex items-center gap-2"
          >
            <Instagram className="w-4 h-4" /> @{username}
          </a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {media.map((m) => {
            const img = m.mediaType === 'VIDEO' ? (m.thumbnailUrl ?? m.mediaUrl) : m.mediaUrl;
            if (!img) return null;
            return (
              <a
                key={m.id}
                href={m.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-square overflow-hidden bg-white/5"
                aria-label={m.caption?.slice(0, 80) ?? 'Instagram post'}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- IG CDN urls rotate; next/image remote config would break */}
                <img
                  src={img}
                  alt={m.caption?.slice(0, 80) ?? 'Instagram post'}
                  className="w-full h-full object-cover hover:opacity-80 transition-opacity"
                  loading="lazy"
                />
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
