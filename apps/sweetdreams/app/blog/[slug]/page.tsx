import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { Clock, Calendar, ChevronRight, ArrowLeft, ArrowRight } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { SITE_URL, BRAND } from '@/lib/constants';
import { getBrand } from '@/lib/brand-server';
import BlogContent from '@/components/blog/BlogContent';
import TableOfContents from '@/components/blog/TableOfContents';
import BlogCTA from '@/components/blog/BlogCTA';
import BlogPostCard from '@/components/blog/BlogPostCard';
import MobileTOC from '@/components/blog/MobileTOC';
import { fmtStampDate } from '@/lib/studio-time';

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createServiceClient();

  const { data: post } = await supabase
    .from('blog_posts')
    .select('title, meta_title, meta_description, excerpt, featured_image_url, featured_image_alt, category, author_name, published_at')
    .eq('slug', slug)
    .eq('status', 'published')
    .single();

  if (!post) return { title: 'Post Not Found' };

  const brand = await getBrand();
  const title = post.meta_title || post.title;
  const description = post.meta_description || post.excerpt || '';

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/blog/${slug}` },
    openGraph: {
      title: `${title} | ${brand.name}`,
      description,
      url: `${SITE_URL}/blog/${slug}`,
      type: 'article',
      publishedTime: post.published_at || undefined,
      authors: post.author_name ? [post.author_name] : undefined,
      images: post.featured_image_url
        ? [{ url: post.featured_image_url, alt: post.featured_image_alt || title }]
        : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${brand.name}`,
      description,
      images: post.featured_image_url ? [post.featured_image_url] : undefined,
    },
  };
}

function formatDate(dateStr: string): string {
  return fmtStampDate(dateStr, { month: 'long', day: 'numeric', year: 'numeric' });
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const supabase = createServiceClient();

  // Fetch post
  const { data: post, error } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single();

  if (error || !post) notFound();

  // Increment view count (fire and forget)
  supabase
    .from('blog_posts')
    .update({ view_count: (post.view_count || 0) + 1 })
    .eq('id', post.id)
    .then(() => {});

  // Fetch category info
  const { data: categoryInfo } = post.category
    ? await supabase
        .from('blog_categories')
        .select('name, slug, color')
        .eq('slug', post.category)
        .single()
    : { data: null };

  // Fetch related posts (same category, excluding current)
  const { data: relatedPosts } = post.category
    ? await supabase
        .from('blog_posts')
        .select('id, slug, title, excerpt, category, featured_image_url, featured_image_alt, read_time_minutes, published_at, author_name')
        .eq('status', 'published')
        .eq('category', post.category)
        .neq('id', post.id)
        .order('published_at', { ascending: false })
        .limit(3)
    : { data: null };

  // Fetch prev/next posts
  const { data: prevPost } = await supabase
    .from('blog_posts')
    .select('slug, title')
    .eq('status', 'published')
    .lt('published_at', post.published_at)
    .order('published_at', { ascending: false })
    .limit(1)
    .single();

  const { data: nextPost } = await supabase
    .from('blog_posts')
    .select('slug, title')
    .eq('status', 'published')
    .gt('published_at', post.published_at)
    .order('published_at', { ascending: true })
    .limit(1)
    .single();

  // Get category colors for related posts
  const { data: allCategories } = await supabase
    .from('blog_categories')
    .select('slug, color');
  const categoryColorMap: Record<string, string> = {};
  if (allCategories) {
    for (const cat of allCategories) {
      categoryColorMap[cat.slug] = cat.color || '#F4C430';
    }
  }

  const catColor = categoryInfo?.color || '#F4C430';

  // JSON-LD
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.meta_description || post.excerpt || '',
    image: post.featured_image_url || undefined,
    datePublished: post.published_at,
    dateModified: post.updated_at || post.published_at,
    author: {
      '@type': 'Person',
      name: post.author_name || BRAND.name,
    },
    publisher: {
      '@type': 'Organization',
      name: BRAND.name,
      url: SITE_URL,
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/blog/${slug}`,
    },
    wordCount: post.content ? post.content.split(/\s+/).length : undefined,
    articleSection: categoryInfo?.name || post.category || undefined,
  };

  return (
    <>
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <section className="relative bg-black text-white py-16 sm:py-24 overflow-hidden">
        {post.featured_image_url && (
          <Image
            src={post.featured_image_url}
            alt={post.featured_image_alt || post.title}
            fill
            className="object-cover opacity-30"
            priority
            sizes="100vw"
          />
        )}
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-2 font-mono text-[10px] sm:text-xs text-white/40 uppercase tracking-wider mb-6 flex-wrap">
            <Link href="/" className="hover:text-white/70 no-underline">Home</Link>
            <ChevronRight className="w-3 h-3" />
            <Link href="/blog" className="hover:text-white/70 no-underline">Blog</Link>
            {categoryInfo && (
              <>
                <ChevronRight className="w-3 h-3" />
                <Link href={`/blog/category/${categoryInfo.slug}`} className="hover:text-white/70 no-underline">
                  {categoryInfo.name}
                </Link>
              </>
            )}
            <ChevronRight className="w-3 h-3" />
            <span className="text-white/60 truncate max-w-[200px]">{post.title}</span>
          </nav>

          {/* Category badge */}
          {post.category && (
            <Link
              href={`/blog/category/${post.category}`}
              className="inline-block px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider mb-5 no-underline"
              style={{ backgroundColor: catColor, color: '#000' }}
            >
              {categoryInfo?.name || post.category}
            </Link>
          )}

          <h1 className="text-2xl sm:text-4xl lg:text-5xl font-bold uppercase tracking-wide leading-tight mb-6">
            {post.title}
          </h1>

          <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-white/50">
            {post.author_name && (
              <span>By {post.author_name}</span>
            )}
            {post.published_at && (
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                {formatDate(post.published_at)}
              </span>
            )}
            {post.read_time_minutes && (
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {post.read_time_minutes} min read
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-12 lg:gap-16">
            {/* Main content */}
            <article className="flex-1 max-w-3xl">
              <BlogContent content={post.content || ''} />

              {/* Mid-content CTA */}
              {post.cta_type && (
                <BlogCTA
                  type={post.cta_type as 'book' | 'beats' | 'contact' | 'sell-beats'}
                  customText={post.cta_text}
                  customUrl={post.cta_url}
                />
              )}

              {/* Tags */}
              {post.tags && post.tags.length > 0 && (
                <div className="mt-12 pt-8 border-t border-black/10">
                  <p className="font-mono text-[10px] font-semibold tracking-[0.3em] uppercase text-black/40 mb-3">
                    Tags
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {post.tags.map((tag: string) => (
                      <span
                        key={tag}
                        className="font-mono text-[10px] px-3 py-1 bg-black/5 text-black/50 uppercase tracking-wider"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Prev / Next */}
              <div className="mt-12 pt-8 border-t border-black/10 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {prevPost ? (
                  <Link
                    href={`/blog/${prevPost.slug}`}
                    className="group flex items-center gap-3 p-4 border-2 border-black/10 hover:border-black transition-colors no-underline"
                  >
                    <ArrowLeft className="w-4 h-4 text-black/40 group-hover:text-black shrink-0" />
                    <div>
                      <span className="font-mono text-[10px] text-black/40 uppercase tracking-wider block">Previous</span>
                      <span className="font-mono text-xs text-black font-semibold line-clamp-1">{prevPost.title}</span>
                    </div>
                  </Link>
                ) : (
                  <div />
                )}
                {nextPost && (
                  <Link
                    href={`/blog/${nextPost.slug}`}
                    className="group flex items-center justify-end gap-3 p-4 border-2 border-black/10 hover:border-black transition-colors no-underline text-right"
                  >
                    <div>
                      <span className="font-mono text-[10px] text-black/40 uppercase tracking-wider block">Next</span>
                      <span className="font-mono text-xs text-black font-semibold line-clamp-1">{nextPost.title}</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-black/40 group-hover:text-black shrink-0" />
                  </Link>
                )}
              </div>
            </article>

            {/* Sidebar: Table of Contents (desktop — sticky) */}
            <aside className="hidden lg:block w-64 shrink-0 self-start sticky top-24">
              <TableOfContents content={post.content || ''} />
            </aside>
          </div>
        </div>

        {/* Mobile TOC — fixed bottom bar */}
        <div className="lg:hidden">
          <MobileTOC content={post.content || ''} />
        </div>
      </section>

      {/* End CTA */}
      <section className="bg-black text-white py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-heading-xl mb-6">READY TO CREATE?</h2>
          <p className="font-mono text-white/70 text-body-md max-w-xl mx-auto mb-8">
            Put what you&apos;ve learned into practice. Book a session or browse beats.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/book"
              className="bg-accent text-black font-mono text-sm font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center"
            >
              Book a Session
            </Link>
            <Link
              href="/beats"
              className="border-2 border-white text-white font-mono text-sm font-bold tracking-wider uppercase px-8 py-4 hover:bg-white hover:text-black transition-colors no-underline inline-flex items-center justify-center"
            >
              Browse Beats
            </Link>
          </div>
        </div>
      </section>

      {/* Related Posts */}
      {relatedPosts && relatedPosts.length > 0 && (
        <section className="bg-white text-black py-16 sm:py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="font-mono text-[10px] font-semibold tracking-[0.3em] uppercase text-[#F4C430] mb-3">
              Keep Reading
            </p>
            <h2 className="text-heading-xl mb-10">RELATED POSTS</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
              {relatedPosts.map((rp) => (
                <BlogPostCard
                  key={rp.id}
                  slug={rp.slug}
                  title={rp.title}
                  excerpt={rp.excerpt}
                  category={rp.category}
                  categoryColor={categoryColorMap[rp.category || ''] || null}
                  featuredImageUrl={rp.featured_image_url}
                  featuredImageAlt={rp.featured_image_alt}
                  readTimeMinutes={rp.read_time_minutes}
                  publishedAt={rp.published_at}
                  authorName={rp.author_name}
                />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
