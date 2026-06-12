import type { Metadata } from 'next';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { createServiceClient } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/constants';
import { requireHref } from '@/lib/site-settings-server';
import BlogPostCard from '@/components/blog/BlogPostCard';
import { fmtStampDate } from '@/lib/studio-time';
import { getBrand } from '@/lib/brand-server';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: 'Blog — Music Education & Industry Knowledge',
    description: `Music education, production tips, and industry knowledge from ${brand.name}. Learn about recording, mixing, beat-making, and the music business.`,
    alternates: { canonical: `${SITE_URL}/blog` },
    openGraph: {
      title: `Blog — Music Education & Industry Knowledge | ${brand.name}`,
      description: `Music education, production tips, and industry knowledge from ${brand.name}.`,
      url: `${SITE_URL}/blog`,
      type: 'website',
    },
  };
}

interface BlogPageProps {
  searchParams: Promise<{ category?: string; search?: string; page?: string }>;
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  await requireHref('/blog'); // 404 when the Blog is disabled
  const params = await searchParams;
  const currentCategory = params.category || '';
  const searchQuery = params.search || '';
  const currentPage = Math.max(1, parseInt(params.page || '1', 10));
  const perPage = 12;

  const supabase = createServiceClient();

  // Fetch categories
  const { data: categories } = await supabase
    .from('blog_categories')
    .select('id, slug, name, description, color, display_order')
    .order('display_order', { ascending: true });

  // Build post query
  let query = supabase
    .from('blog_posts')
    .select('id, slug, title, excerpt, category, featured_image_url, featured_image_alt, read_time_minutes, published_at, author_name, view_count, status', { count: 'exact' })
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (currentCategory) {
    query = query.eq('category', currentCategory);
  }

  if (searchQuery) {
    const s = searchQuery.replace(/[%_\\(),]/g, '');
    if (s) {
      query = query.or(`title.ilike.%${s}%,excerpt.ilike.%${s}%,content.ilike.%${s}%`);
    }
  }

  const from = (currentPage - 1) * perPage;
  const to = from + perPage - 1;
  query = query.range(from, to);

  const { data: posts, count } = await query;

  const totalPages = count ? Math.ceil(count / perPage) : 1;

  // Featured post = most recent published, only on page 1 with no filters
  const featuredPost = (!currentCategory && !searchQuery && currentPage === 1 && posts && posts.length > 0) ? posts[0] : null;
  const gridPosts = featuredPost ? posts?.slice(1) : posts;

  // Get category color map
  const categoryColorMap: Record<string, string> = {};
  if (categories) {
    for (const cat of categories) {
      categoryColorMap[cat.slug] = cat.color || '#F4C430';
    }
  }

  return (
    <>
      {/* Hero */}
      <section className="bg-black text-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            Sweet Dreams Music
          </p>
          <h1 className="text-display-md mb-6">BLOG</h1>
          <p className="font-mono text-white/70 text-body-md max-w-2xl">
            Music education, production tips, and industry knowledge.
          </p>
        </div>
      </section>

      {/* Filters */}
      <section className="bg-white text-black border-b border-black/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
            {/* Category pills */}
            <div className="flex flex-wrap gap-2">
              <Link
                href="/blog"
                className={`font-mono text-[10px] sm:text-xs font-bold tracking-wider uppercase px-4 py-2 no-underline transition-colors ${
                  !currentCategory
                    ? 'bg-black text-white'
                    : 'bg-black/5 text-black/60 hover:bg-black/10'
                }`}
              >
                All
              </Link>
              {categories?.map((cat) => (
                <Link
                  key={cat.id}
                  href={`/blog?category=${cat.slug}`}
                  className={`font-mono text-[10px] sm:text-xs font-bold tracking-wider uppercase px-4 py-2 no-underline transition-colors ${
                    currentCategory === cat.slug
                      ? 'text-black'
                      : 'bg-black/5 text-black/60 hover:bg-black/10'
                  }`}
                  style={currentCategory === cat.slug ? { backgroundColor: cat.color || '#F4C430' } : undefined}
                >
                  {cat.name}
                </Link>
              ))}
            </div>

            {/* Search */}
            <form action="/blog" method="GET" className="relative w-full sm:w-72">
              {currentCategory && <input type="hidden" name="category" value={currentCategory} />}
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
              <input
                type="text"
                name="search"
                defaultValue={searchQuery}
                placeholder="Search posts..."
                className="w-full pl-10 pr-4 py-2.5 border-2 border-black/10 font-mono text-xs text-black bg-white focus:outline-none focus:border-black placeholder:text-black/30"
              />
            </form>
          </div>
        </div>
      </section>

      {/* Posts */}
      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Active filters display */}
          {(currentCategory || searchQuery) && (
            <div className="flex items-center gap-3 mb-8 font-mono text-xs text-black/50">
              <span>Showing results</span>
              {currentCategory && (
                <span className="px-3 py-1 bg-black/5 text-black/80 font-semibold uppercase tracking-wider">
                  {currentCategory}
                </span>
              )}
              {searchQuery && (
                <span className="text-black/80">
                  for &quot;{searchQuery}&quot;
                </span>
              )}
              <Link href="/blog" className="text-[#F4C430] hover:underline no-underline ml-2">
                Clear
              </Link>
            </div>
          )}

          {/* Featured post */}
          {featuredPost && (
            <div className="mb-12">
              <p className="font-mono text-[10px] font-semibold tracking-[0.3em] uppercase text-[#F4C430] mb-4">
                Latest
              </p>
              <Link
                href={`/blog/${featuredPost.slug}`}
                className="group block border-2 border-black hover:border-[#F4C430] transition-colors no-underline"
              >
                <div className="grid grid-cols-1 md:grid-cols-2">
                  <div className="relative aspect-[16/9] md:aspect-auto bg-black overflow-hidden">
                    {featuredPost.featured_image_url ? (
                      <img
                        src={featuredPost.featured_image_url}
                        alt={featuredPost.featured_image_alt || featuredPost.title}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-[#F4C430]/10">
                        <span className="font-mono text-6xl font-bold uppercase opacity-10 text-[#F4C430]">
                          {featuredPost.category || 'BLOG'}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="p-8 sm:p-10 flex flex-col justify-center">
                    {featuredPost.category && (
                      <span
                        className="inline-block w-fit px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider mb-4"
                        style={{
                          backgroundColor: categoryColorMap[featuredPost.category] || '#F4C430',
                          color: '#000',
                        }}
                      >
                        {featuredPost.category}
                      </span>
                    )}
                    <h2 className="text-xl sm:text-2xl font-bold uppercase tracking-wide mb-3 text-black group-hover:text-[#F4C430] transition-colors">
                      {featuredPost.title}
                    </h2>
                    {featuredPost.excerpt && (
                      <p className="font-mono text-sm text-black/60 mb-4 line-clamp-3">
                        {featuredPost.excerpt}
                      </p>
                    )}
                    <div className="font-mono text-[10px] text-black/40 uppercase tracking-wider">
                      {featuredPost.published_at && fmtStampDate(featuredPost.published_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                      {featuredPost.read_time_minutes && ` \u00B7 ${featuredPost.read_time_minutes} min read`}
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          )}

          {/* Post grid */}
          {gridPosts && gridPosts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              {gridPosts.map((post) => (
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
              <p className="font-mono text-lg text-black/40 mb-2">No posts found</p>
              <p className="font-mono text-sm text-black/30">
                {searchQuery ? 'Try a different search term.' : 'Check back soon for new content.'}
              </p>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-12">
              {currentPage > 1 && (
                <Link
                  href={`/blog?${new URLSearchParams({
                    ...(currentCategory ? { category: currentCategory } : {}),
                    ...(searchQuery ? { search: searchQuery } : {}),
                    page: String(currentPage - 1),
                  }).toString()}`}
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
                        href={`/blog?${new URLSearchParams({
                          ...(currentCategory ? { category: currentCategory } : {}),
                          ...(searchQuery ? { search: searchQuery } : {}),
                          page: String(p),
                        }).toString()}`}
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
                  href={`/blog?${new URLSearchParams({
                    ...(currentCategory ? { category: currentCategory } : {}),
                    ...(searchQuery ? { search: searchQuery } : {}),
                    page: String(currentPage + 1),
                  }).toString()}`}
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
