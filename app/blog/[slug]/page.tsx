import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, Calendar, Clock } from 'lucide-react';
import { SITE_URL, BRAND } from '@/lib/constants';
import { requireHref } from '@/lib/site-settings-server';
import { getReleasedPost, getReleasedPosts, formatReleaseDate } from '@/lib/blog/posts';
import { renderPostBody, safeUrl } from '@/lib/blog/markdown';
import PostContents from '@/components/blog/PostContents';

// The release date is checked every time this page renders, and it renders at
// least hourly. A post that has not reached its date is a 404.
export const revalidate = 3600;

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getReleasedPost(slug);
  if (!post) return { title: { absolute: 'Not found | Sweet Dreams Music' }, robots: { index: false } };

  const title = `${post.title} | Sweet Dreams Music`;
  const url = `${SITE_URL}/blog/${post.slug}`;
  return {
    title: { absolute: title },
    description: post.description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: post.description,
      url,
      type: 'article',
      publishedTime: post.release_on,
    },
    twitter: { card: 'summary_large_image', title, description: post.description },
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  await requireHref('/blog'); // 404 when the Blog is switched off in the control panel
  const { slug } = await params;
  const post = await getReleasedPost(slug);
  if (!post) notFound();

  const all = await getReleasedPosts();
  const at = all.findIndex((p) => p.slug === post.slug);
  const newer = at > 0 ? all[at - 1] : null;
  const older = at >= 0 && at < all.length - 1 ? all[at + 1] : null;

  const { html, headings } = renderPostBody(post.body, { title: post.title });
  const sources = post.sources.filter((s) => safeUrl(s.url) && /^https?:/i.test(s.url));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.release_on,
    dateModified: post.release_on,
    author: { '@type': 'Organization', name: BRAND.name, url: SITE_URL },
    publisher: { '@type': 'Organization', name: BRAND.name, url: SITE_URL },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/blog/${post.slug}` },
    wordCount: post.body.split(/\s+/).filter(Boolean).length,
    ...(sources.length
      ? {
          citation: sources.map((s) => ({
            '@type': 'CreativeWork',
            name: s.title,
            url: s.url,
            ...(s.author ? { author: { '@type': 'Organization', name: s.author } } : {}),
          })),
        }
      : {}),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      {/* Hero */}
      <section className="bg-black text-white py-10 sm:py-16">
        <div className="max-w-[44rem] mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/blog"
            className="mb-6 inline-flex items-center gap-2 font-mono text-[11px] sm:text-xs uppercase tracking-wider text-white/50 no-underline transition-colors hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            All posts
          </Link>
          <h1 className="mb-5 text-heading-xl leading-tight">{post.title}</h1>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-white/60">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" aria-hidden />
              <time dateTime={post.release_on}>{formatReleaseDate(post.release_on)}</time>
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {post.reading_minutes} min read
            </span>
          </div>
        </div>
      </section>

      {/* Body */}
      <section className="bg-white text-black py-10 sm:py-14">
        <div className="max-w-[44rem] mx-auto px-4 sm:px-6 lg:px-8">
          <article>
            <div id="post-body" className="blog-prose" dangerouslySetInnerHTML={{ __html: html }} />

            {sources.length > 0 && (
              <section aria-labelledby="post-sources" className="mt-14 border-t-2 border-black pt-8">
                <h2 id="post-sources" className="mb-5 text-heading-md">
                  Sources
                </h2>
                <ol className="space-y-4">
                  {sources.map((s) => (
                    <li key={s.url} className="font-mono text-sm leading-snug">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-black underline decoration-[#F4C430] decoration-2 underline-offset-4 hover:bg-[#F4C430]/25"
                      >
                        {s.title}
                      </a>
                      {s.author && <span className="mt-0.5 block text-xs text-black/50">{s.author}</span>}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {(newer || older) && (
              <div className="mt-12 grid grid-cols-1 gap-4 border-t border-black/10 pt-8 sm:grid-cols-2">
                {older ? (
                  <Link
                    href={`/blog/${older.slug}`}
                    className="group flex items-center gap-3 border-2 border-black/10 p-4 no-underline transition-colors hover:border-black"
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0 text-black/40 group-hover:text-black" aria-hidden />
                    <span>
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-black/40">Older</span>
                      <span className="line-clamp-2 font-mono text-xs font-semibold text-black">{older.title}</span>
                    </span>
                  </Link>
                ) : (
                  <div />
                )}
                {newer && (
                  <Link
                    href={`/blog/${newer.slug}`}
                    className="group flex items-center justify-end gap-3 border-2 border-black/10 p-4 text-right no-underline transition-colors hover:border-black"
                  >
                    <span>
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-black/40">Newer</span>
                      <span className="line-clamp-2 font-mono text-xs font-semibold text-black">{newer.title}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-black/40 group-hover:text-black" aria-hidden />
                  </Link>
                )}
              </div>
            )}
          </article>
        </div>
      </section>

      {/* End call to action */}
      <section className="bg-black text-white py-14 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="mb-5 text-heading-xl">READY TO CREATE?</h2>
          <p className="mx-auto mb-8 max-w-xl font-mono text-body-md text-white/70">
            Put what you have learned into practice. Plan your next visual, or browse beats.
          </p>
          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <Link
              href="/media"
              className="inline-flex items-center justify-center bg-accent px-8 py-4 font-mono text-sm font-bold uppercase tracking-wider text-black no-underline transition-colors hover:bg-accent/90"
            >
              See Our Work
            </Link>
            <Link
              href="/beats"
              className="inline-flex items-center justify-center border-2 border-white px-8 py-4 font-mono text-sm font-bold uppercase tracking-wider text-white no-underline transition-colors hover:bg-white hover:text-black"
            >
              Browse Beats
            </Link>
          </div>
        </div>
      </section>

      <PostContents sections={headings} bodyId="post-body" />
    </>
  );
}
