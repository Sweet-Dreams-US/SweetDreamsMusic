import Link from 'next/link';
import Image from 'next/image';
import { Clock, Calendar } from 'lucide-react';
import { fmtStampDate } from '@/lib/studio-time';

interface BlogPostCardProps {
  slug: string;
  title: string;
  excerpt: string | null;
  category: string | null;
  categoryColor?: string | null;
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  readTimeMinutes: number | null;
  publishedAt: string | null;
  authorName: string | null;
}

export default function BlogPostCard({
  slug,
  title,
  excerpt,
  category,
  categoryColor,
  featuredImageUrl,
  featuredImageAlt,
  readTimeMinutes,
  publishedAt,
}: BlogPostCardProps) {
  const bgColor = categoryColor || '#F4C430';

  return (
    <Link
      href={`/blog/${slug}`}
      className="group block border-2 border-black/10 hover:border-black transition-colors no-underline"
    >
      {/* Thumbnail */}
      <div className="relative aspect-[16/9] overflow-hidden bg-black">
        {featuredImageUrl ? (
          <Image
            src={featuredImageUrl}
            alt={featuredImageAlt || title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-500"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: `${bgColor}20` }}
          >
            <span
              className="font-mono text-4xl font-bold uppercase opacity-20"
              style={{ color: bgColor }}
            >
              {category || 'BLOG'}
            </span>
          </div>
        )}

        {/* Category badge */}
        {category && (
          <span
            className="absolute top-3 left-3 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: bgColor, color: '#000' }}
          >
            {category}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-5 sm:p-6">
        <h3 className="text-base sm:text-lg font-bold uppercase tracking-wide mb-2 text-black group-hover:text-[#F4C430] transition-colors line-clamp-2">
          {title}
        </h3>

        {excerpt && (
          <p className="font-mono text-xs sm:text-sm text-black/60 mb-4 line-clamp-3 leading-relaxed">
            {excerpt}
          </p>
        )}

        <div className="flex items-center gap-4 font-mono text-[10px] sm:text-xs text-black/40 uppercase tracking-wider">
          {publishedAt && (
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3 h-3" />
              {fmtStampDate(publishedAt, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
          {readTimeMinutes && (
            <span className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              {readTimeMinutes} min read
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
