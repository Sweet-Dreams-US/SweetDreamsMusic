import type { Metadata } from 'next';
import Link from 'next/link';
import { Calendar, Clock } from 'lucide-react';
import { SITE_URL } from '@/lib/constants';
import { requireHref } from '@/lib/site-settings-server';
import { getReleasedPosts, formatReleaseDate } from '@/lib/blog/posts';

// Posts come from content/blog files. The release date is checked every time
// this page renders, and it renders at least hourly, so a post shows up on its
// day without a deploy.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: { absolute: 'Blog | Sweet Dreams Music' },
  description: 'Guides and ideas for artists, bands and creators from Sweet Dreams Music in Fort Wayne.',
  alternates: {
    canonical: `${SITE_URL}/blog`,
    types: { 'application/rss+xml': `${SITE_URL}/blog/rss.xml` },
  },
  openGraph: {
    title: 'Blog | Sweet Dreams Music',
    description: 'Guides and ideas for artists, bands and creators from Sweet Dreams Music in Fort Wayne.',
    url: `${SITE_URL}/blog`,
    type: 'website',
  },
};

export default async function BlogPage() {
  await requireHref('/blog'); // 404 when the Blog is switched off in the control panel
  const posts = await getReleasedPosts();

  return (
    <>
      {/* Hero */}
      <section className="bg-black text-white py-14 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            Sweet Dreams Music
          </p>
          <h1 className="text-display-md mb-5">BLOG</h1>
          <p className="font-mono text-white/70 text-body-md max-w-2xl">
            Guides and ideas for artists, bands and creators.
          </p>
        </div>
      </section>

      {/* Posts */}
      <section className="bg-white text-black py-10 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {posts.length > 0 ? (
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-8">
              {posts.map((post) => (
                <li key={post.slug} className="flex">
                  <Link
                    href={`/blog/${post.slug}`}
                    className="group flex w-full flex-col border-2 border-black/10 border-t-4 border-t-[#F4C430] p-5 sm:p-6 no-underline transition-colors hover:border-black hover:border-t-[#F4C430]"
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] sm:text-xs uppercase tracking-wider text-black/45">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3 w-3" aria-hidden />
                        <time dateTime={post.release_on}>{formatReleaseDate(post.release_on)}</time>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" aria-hidden />
                        {post.reading_minutes} min read
                      </span>
                    </div>
                    <h2 className="mb-3 text-xl sm:text-2xl leading-tight text-black transition-colors group-hover:text-[#F4C430]">
                      {post.title}
                    </h2>
                    {post.description && (
                      <p className="font-mono text-xs sm:text-sm leading-relaxed text-black/60">{post.description}</p>
                    )}
                    <span className="mt-auto pt-5 font-mono text-[11px] font-bold uppercase tracking-wider text-black">
                      Read the post
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-16 text-center">
              <p className="mb-2 font-mono text-lg text-black/50">No posts yet.</p>
              <p className="font-mono text-sm text-black/40">Check back soon.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
