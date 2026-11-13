import { SITE_URL, BRAND } from '@/lib/constants';
import { getReleasedPosts } from '@/lib/blog/posts';

// RSS feed of released posts. A post that has not reached its release date is
// never listed. Refreshed at least hourly, so a new post joins on its day.
export const revalidate = 3600;

function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  const posts = await getReleasedPosts();
  const items = posts
    .map((p) => {
      const url = `${SITE_URL}/blog/${p.slug}`;
      return [
        '<item>',
        `<title>${xml(p.title)}</title>`,
        `<link>${xml(url)}</link>`,
        `<guid isPermaLink="true">${xml(url)}</guid>`,
        `<pubDate>${new Date(`${p.release_on}T12:00:00Z`).toUTCString()}</pubDate>`,
        `<description>${xml(p.description)}</description>`,
        '</item>',
      ].join('');
    })
    .join('\n');

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>',
    `<title>${xml(`${BRAND.name} Blog`)}</title>`,
    `<link>${xml(`${SITE_URL}/blog`)}</link>`,
    `<atom:link href="${xml(`${SITE_URL}/blog/rss.xml`)}" rel="self" type="application/rss+xml" />`,
    '<description>Guides and ideas for artists, bands and creators.</description>',
    '<language>en-us</language>',
    items,
    '</channel></rss>',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
