import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { classifyPath, getClientKey, rateLimit } from '@/lib/rate-limit';

export async function middleware(request: NextRequest) {
  // Rate-limit first so a flood of requests never reaches Supabase/Stripe.
  // classifyPath returns null for routes that shouldn't be throttled
  // (admin, cron, webhook, static pages) — those fall straight through
  // to updateSession without a Redis hit.
  const bucket = classifyPath(request.nextUrl.pathname);
  if (bucket) {
    const key = `${bucket}:${getClientKey(request)}`;
    const { success, limit, remaining, reset } = await rateLimit(bucket, key);
    if (!success) {
      const retryAfterSec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return NextResponse.json(
        { error: 'Too many requests. Slow down and try again shortly.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSec),
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': String(remaining),
            'X-RateLimit-Reset': String(reset),
          },
        },
      );
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - Public assets (images, fonts, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)).*)',
  ],
};
