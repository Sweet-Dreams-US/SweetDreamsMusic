import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/constants';
import { getBrand } from '@/lib/brand-server';
import BlogPostCard from '@/components/blog/BlogPostCard';

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createServiceClient();

  const { data: category } = await supabase
    .from('blog_categories')
    .select('name, description')
    .eq('slug', slug)
    .single();

  if (!category) return { title: 'Category Not Found' };

  const brand = await getBrand();
  return {
    title: `${category.name} — Blog`,
    description: category.description || `${category.name} articles from ${brand.name}.`,
    alternates: { canonical: `${SITE_URL}/blog/category/${slug}` },
    openGraph: {
      title: `${category.name} — Blog | ${brand.name}`,
      description: category.description || `${category.name} articles from ${brand.name}.`,
      url: `${SITE_URL}/blog/category/${slug}`,
      type: 'website',
    },
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const currentPage = Math.max(1, parseInt(sp.page || '1', 10));
  const perPage = 12;

  const supabase = createServiceClient();

  // Fetch category
  const { data: category, error: catError } = await supabase
    .from('blog_categories')
    .select('id, slug, name, description, color')
    .eq('slug', slug)
    .single();

  if (catError || !category) notFound();

  // Fetch posts in this category
  const from = (currentPage - 1) * perPage;
  const to = from + perPage - 1;

  const { data: posts, count } = await supabase
    .from('blog_posts')
    .select('id, slug, title, excerpt, category, featured_image_url, featured_image_alt, read_time_minutes, published_at, author_name', { count: 'exact' })
    .eq('status', 'published')
    .eq('category', slug)
    .order('published_at', { ascending: false })
    .range(from, to);

  const totalPages = count ? Math.ceil(count / perPage) : 1;
  const catColor = category.color || '#F4C430';

  // Category colors
  const { data: allCategories } = await supabase
    .from('blog_categories')
    .select('slug, color');
  const categoryColorMap: Record<string, string> = {};
  if (allCategories) {
    for (const c of allCategories) {
      categoryColorMap[c.slug] = c.color || '#F4C430';
    }
  }

  return (
    <>
      {/* Hero */}
      <section className="bg-black text-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Breadcrumbs */}
          <nav className="flex items-center gap-2 font-mono text-[10px] sm:text-xs text-white/40 uppercase tracking-wider mb-6">
            <Link href="/" className="hover:text-white/70 no-underline">Home</Link>
            <ChevronRight className="w-3 h-3" />
            <Link href="/blog" className="hover:text-white/70 no-underline">Blog</Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-white/60">{category.name}</span>
          </nav>

          <div className="flex items-center gap-4 mb-4">
            <div
              className="w-3 h-8"
              style={{ backgroundColor: catColor }}
            />
            <h1 className="text-display-md">{category.name.toUpperCase()}</h1>
          </div>

          {category.description && (
            <p className="font-mono text-white/70 text-body-md max-w-2xl">
              {category.description}
            </p>
          )}

          {count !== null && count !== undefined && (
            <p className="font-mono text-xs text-white/40 mt-4 uppercase tracking-wider">
              {count} {count === 1 ? 'post' : 'posts'}
            </p>
          )}
        </div>
      </section>

      {/* Posts */}
      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {posts && posts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              {posts.map((post) => (
                <BlogPostCard
                  key={post.id}
                  slug={post.slug}
                  title={post.title}
                  excerpt={post.excerpt}
                  category={post.category}
                  categoryColor={categoryColorMap[post.category || ''] || null}
                  featuredImageUrl={post.featured_image_url}
                  featuredImageAlt={post.featured_image_alt}
                  readTimeMinutes={post.read_time_minutes}
                  publishedAt={post.published_at}
                  authorName={post.author_name}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-20">
              <p className="font-mono text-lg text-black/40 mb-2">No posts yet</p>
              <p className="font-mono text-sm text-black/30">Check back soon for new content in this category.</p>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-12">
              {currentPage > 1 && (
                <Link
                  href={`/blog/category/${slug}?page=${currentPage - 1}`}
                  className="font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 border-2 border-black text-black hover:bg-black hover:text-white transition-colors no-underline"
                >
                  Prev
                </Link>
              )}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                .map((p, i, arr) => {
                  const prev = arr[i - 1];
                  const showEllipsis = prev && p - prev > 1;
                  return (
                    <span key={p} className="flex items-center gap-2">
                      {showEllipsis && <span className="font-mono text-xs text-black/30 px-1">...</span>}
                      <Link
                        href={`/blog/category/${slug}?page=${p}`}
                        className={`font-mono text-xs font-bold uppercase px-3 py-2 no-underline transition-colors ${
                          p === currentPage
                            ? 'bg-black text-white'
                            : 'text-black/60 hover:text-black'
                        }`}
                      >
                        {p}
                      </Link>
                    </span>
                  );
                })}
              {currentPage < totalPages && (
                <Link
                  href={`/blog/category/${slug}?page=${currentPage + 1}`}
                  className="font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 border-2 border-black text-black hover:bg-black hover:text-white transition-colors no-underline"
                >
                  Next
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
