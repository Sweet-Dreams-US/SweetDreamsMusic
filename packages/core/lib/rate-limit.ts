/**
 * Rate limiting — per-IP sliding window via Supabase.
 *
 * WHY SUPABASE: the app already runs on a paid Supabase tier. Adding Upstash
 * would've been another vendor, another env var set, another billing line —
 * for a latency win (~15-30ms vs ~2-5ms) that doesn't move the needle at our
 * traffic profile. The RPCs in migration 037 (`rate_limit_check`, `mark_once`)
 * do the race-safe counting/dedup in Postgres so this file stays small.
 *
 * ENV VARS (set in Vercel):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * If either is missing, this module's limiter falls back to "allow all" with
 * a console.warn in production. That way local dev + preview deployments
 * without service creds still boot; production is noisy so a misconfiguration
 * can't silently disable protection.
 *
 * BUCKETS:
 *   contact  → 5/min   (contact, sweet-spot, producer-apply)
 *   rsvp     → 10/min
 *   play     → 20/min  (+ per-(ip,beatId,minute) dedup done in the handler)
 *   auth     → 5/min   (login-shaped flows that don't use Supabase client-side)
 *   checkout → 10/min  (booking/create, beats/checkout, beats/renew, upgrade)
 *
 * Admin paths bypass rate limiting entirely — they're already gated by
 * verifyAdminAccess and we don't want to block broadcast sends.
 */

import { createServiceClient } from '@/lib/supabase/server';

export type Bucket = 'contact' | 'rsvp' | 'play' | 'auth' | 'checkout';

// Per-bucket sliding-window config. Kept in a single table so it's trivial to
// tune and obvious at a glance. Window is a constant 60s across the board —
// if we ever need 10s/5s windows, widen this shape.
const BUCKET_CONFIG: Record<Bucket, { max: number; windowSec: number }> = {
  contact:  { max: 5,  windowSec: 60 },
  rsvp:     { max: 10, windowSec: 60 },
  play:     { max: 20, windowSec: 60 },
  auth:     { max: 5,  windowSec: 60 },
  checkout: { max: 10, windowSec: 60 },
};

// Memoize the warning so we don't spam logs when the module is hot under
// concurrent requests.
let warnedMissingEnv = false;
function hasSupabaseEnv(): boolean {
  const ok =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!ok && !warnedMissingEnv && process.env.NODE_ENV === 'production') {
    warnedMissingEnv = true;
    console.warn(
      '[rate-limit] Supabase env vars missing. Rate limiting is DISABLED. ' +
      'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.',
    );
  }
  return ok;
}

// Shape we return — matches the old Upstash contract so middleware doesn't
// need to change.
export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // epoch ms
}

/**
 * Consume one token for this bucket+identifier. Returns `success=true` when
 * the request is allowed. Fails open on configuration error or RPC failure
 * so a transient Supabase blip doesn't site-wide-429 real users.
 */
export async function rateLimit(bucket: Bucket, identifier: string): Promise<RateLimitResult> {
  const cfg = BUCKET_CONFIG[bucket];
  // Lenient fallback for missing env — see module comment.
  if (!hasSupabaseEnv()) {
    return { success: true, limit: cfg.max, remaining: cfg.max, reset: Date.now() + cfg.windowSec * 1000 };
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('rate_limit_check', {
      p_bucket: bucket,
      p_identifier: identifier,
      p_max: cfg.max,
      p_window_seconds: cfg.windowSec,
    });

    if (error || !data) {
      // Fail-open on RPC error. We log for visibility but don't block users.
      console.error('[rate-limit] RPC error — failing open:', error);
      return { success: true, limit: cfg.max, remaining: cfg.max, reset: Date.now() + cfg.windowSec * 1000 };
    }

    // data is JSONB returned as a plain object. Defensive cast + defaults.
    const d = data as { success?: boolean; limit?: number; remaining?: number; reset?: number };
    return {
      success: d.success ?? true,
      limit: d.limit ?? cfg.max,
      remaining: d.remaining ?? 0,
      reset: d.reset ?? Date.now() + cfg.windowSec * 1000,
    };
  } catch (e) {
    console.error('[rate-limit] unexpected error — failing open:', e);
    return { success: true, limit: cfg.max, remaining: cfg.max, reset: Date.now() + cfg.windowSec * 1000 };
  }
}

/**
 * Classify a pathname to a bucket, or return null for "no limit".
 *
 * Keeping this as a pure function makes it trivial to unit test and add
 * new routes without touching middleware.
 */
export function classifyPath(pathname: string): Bucket | null {
  // Admin is trusted — authenticated via verifyAdminAccess and needs throughput
  // for broadcasts and bulk ops.
  if (pathname.startsWith('/api/admin/')) return null;

  // Cron endpoints run on Vercel's scheduler with an auth header — don't limit.
  if (pathname.startsWith('/api/cron/')) return null;

  // Stripe webhook — Stripe will retry its own deliveries; limiting here would
  // cause legit events to be dropped.
  if (pathname === '/api/booking/webhook') return null;

  // Auth-adjacent flows: account claim, unauth user lookup, password reset.
  // The Supabase sign-in / sign-up flow goes directly to supabase.co from
  // the browser and doesn't hit our app, so there's no /api/auth/signin
  // here. Password reset DOES hit us (since we mint+email the link
  // ourselves through Resend) so we throttle that — 5/min/IP keeps
  // someone from spamming reset attempts at a known email.
  if (
    pathname === '/api/booking/claim' ||
    pathname === '/api/booking/lookup-user' ||
    pathname === '/api/auth/forgot-password' ||
    pathname === '/api/auth/reset-password'
  ) return 'auth';

  // Contact / inquiry / application forms (high-value targets for spam).
  if (
    pathname === '/api/contact' ||
    pathname === '/api/bands/sweet-spot-inquiry' ||
    pathname === '/api/producer/apply'
  ) return 'contact';

  // RSVP flood protection.
  if (/^\/api\/events\/[^/]+\/rsvp$/.test(pathname)) return 'rsvp';

  // Track plays (also deduped per-(ip, beatId, minute) inside the handler).
  if (pathname === '/api/beats/track-play') return 'play';

  // Checkout creation — expensive (Stripe API calls), also a fraud vector.
  if (
    pathname === '/api/booking/create' ||
    pathname === '/api/beats/checkout' ||
    pathname === '/api/beats/renew' ||
    pathname === '/api/beats/upgrade' ||
    pathname === '/api/booking/invite/pay' ||
    pathname.startsWith('/api/beats/private-sale/')
  ) return 'checkout';

  return null;
}

/**
 * Best-effort client IP from the request. Vercel's edge network sets
 * x-forwarded-for with the leftmost value being the originating client.
 *
 * Falls back to 'unknown' when no headers are present — anon traffic
 * shares that bucket, which is safer than returning distinct keys
 * (e.g. per-random-uuid) that attackers could cycle through.
 */
export function getClientKey(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

/**
 * Helper for route-level dedup — returns true if this (bucket, key) combo
 * was first-seen within the TTL window. Used by /api/beats/track-play to
 * prevent play-count inflation without needing to 429 the request.
 *
 * The `mark_once` RPC is race-safe (uses SELECT FOR UPDATE + unique-violation
 * catch), so multiple concurrent callers with the same key see exactly one
 * `true` between them.
 */
export async function markOnce(key: string, ttlSeconds: number): Promise<boolean> {
  // Fail-open: without Supabase env or on error, don't block.
  if (!hasSupabaseEnv()) return true;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('mark_once', {
      p_key: key,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) {
      console.error('[rate-limit] mark_once error — failing open:', error);
      return true;
    }
    return Boolean(data);
  } catch (e) {
    console.error('[rate-limit] mark_once unexpected error — failing open:', e);
    return true;
  }
}
