import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/constants';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Dynamic sitemap.
 *
 * Hydrates from the DB so search engines and AI crawlers discover every
 * indexable URL, not just the home/nav routes. Pulls from:
 *
 *   • beats (status='active')                        → /beats/[id]
 *   • blog_posts (status='published')                → /blog/[slug]
 *   • events (visibility ∈ public|private_listed)    → /events/[slug]
 *   • bands (is_public=true)                         → /bands/[slug]
 *   • profiles (public_profile_slug is set)          → /u/[slug]
 *
 * Static routes use the file's mtime via `now` because the underlying
 * content rarely changes per-page — `changeFrequency` does the heavy
 * lifting for crawl scheduling. Dynamic routes use the row's `updated_at`
 * (or `published_at` for blog) so a freshly-edited post gets re-crawled.
 *
 * If the DB query fails (network blip, RLS misconfig, etc.) we fall back
 * to the static skeleton — a partial sitemap is better than a missing one.
 * Service client bypasses RLS so engineer/admin auth state doesn't shape
 * what crawlers see.
 *
 * Caching: Next.js caches the result for `revalidate` seconds — 60min is
 * plenty for SEO purposes and prevents hammering the DB on bot traffic.
 */
export const revalidate = 3600;

type Entry = MetadataRoute.Sitemap[number];

const STATIC_ROUTES: Entry[] = [
  { url: '/', changeFrequency: 'weekly', priority: 1.0 },
  { url: '/book', changeFrequency: 'weekly', priority: 0.9 },
  { url: '/pricing', changeFrequency: 'monthly', priority: 0.8 },
  { url: '/beats', changeFrequency: 'daily', priority: 0.8 },
  { url: '/blog', changeFrequency: 'daily', priority: 0.8 },
  { url: '/engineers', changeFrequency: 'monthly', priority: 0.7 },
  { url: '/media', changeFrequency: 'weekly', priority: 0.7 },
  { url: '/sell-beats', changeFrequency: 'monthly', priority: 0.7 },
  { url: '/bands', changeFrequency: 'weekly', priority: 0.7 },
  { url: '/events', changeFrequency: 'weekly', priority: 0.7 },
  { url: '/bands/sweet-spot/inquire', changeFrequency: 'monthly', priority: 0.6 },
  { url: '/about', changeFrequency: 'monthly', priority: 0.6 },
  { url: '/contact', changeFrequency: 'monthly', priority: 0.6 },
  { url: '/login', changeFrequency: 'yearly', priority: 0.3 },
];

function abs(path: string): string {
  return path.startsWith('http') ? path : `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function withDate(entry: Entry, iso?: string | null): Entry {
  return { ...entry, url: abs(entry.url as string), lastModified: iso ? new Date(iso) : new Date() };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date().toISOString();
  const staticEntries: Entry[] = STATIC_ROUTES.map((e) => withDate(e, now));

  // Service client — bypasses RLS so the sitemap reflects what's truly
  // public, not what any one user can see. Errors are swallowed at the
  // boundary: a partial sitemap is more useful than no sitemap.
  let dynamicEntries: Entry[] = [];
  try {
    const supabase = createServiceClient();
    const [beats, posts, events, bands, profiles] = await Promise.all([
      supabase
        .from('beats')
        .select('id, slug, updated_at, created_at')
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(5000),
      supabase
        .from('blog_posts')
        .select('slug, updated_at, published_at')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(5000),
      supabase
        .from('events')
        .select('slug, updated_at')
        .in('visibility', ['public', 'private_listed'])
        .not('slug', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(5000),
      supabase
        .from('bands')
        .select('slug, updated_at')
        .eq('is_public', true)
        .not('slug', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(5000),
      supabase
        .from('profiles')
        .select('public_profile_slug, updated_at')
        .not('public_profile_slug', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(5000),
    ]);

    dynamicEntries = [
      ...(beats.data ?? []).map((b) => ({
        url: abs(`/beats/${b.slug || b.id}`),
        lastModified: new Date(b.updated_at || b.created_at || now),
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      })),
      ...(posts.data ?? []).map((p) => ({
        url: abs(`/blog/${p.slug}`),
        lastModified: new Date(p.updated_at || p.published_at || now),
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      })),
      ...(events.data ?? []).map((e) => ({
        url: abs(`/events/${e.slug}`),
        lastModified: new Date(e.updated_at || now),
        changeFrequency: 'daily' as const,
        priority: 0.7,
      })),
      ...(bands.data ?? []).map((b) => ({
        url: abs(`/bands/${b.slug}`),
        lastModified: new Date(b.updated_at || now),
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      })),
      ...(profiles.data ?? []).map((p) => ({
        url: abs(`/u/${p.public_profile_slug}`),
        lastModified: new Date(p.updated_at || now),
        changeFrequency: 'weekly' as const,
        priority: 0.5,
      })),
    ];
  } catch (err) {
    console.error('[sitemap] dynamic fetch failed — falling back to static-only:', err);
  }

  return [...staticEntries, ...dynamicEntries];
}
