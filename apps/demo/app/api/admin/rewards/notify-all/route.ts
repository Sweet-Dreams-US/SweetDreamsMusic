// POST /api/admin/rewards/notify-all — one-time admin "blast" that sends the
// REWARDS-PROGRESS nudge to EVERY eligible customer right now, complementing the
// per-session auto-reminder that already fires after a booking.
//
// Eligibility = customers with rewards progress this calendar year. We reuse the
// SAME customer-enumeration the standings page uses (booking customers ∪ beat
// buyers, resolved to profile user_ids); notifyRewardsProgress() is internally
// guarded and self-skips anyone with 0 hours / top tier reached / no email, so we
// simply attempt the whole set and let it filter. Each call sends at most 1 email,
// and we space calls ~80ms apart to stay well under Resend's ~25/sec.
//
// Admin-only (verifyAdminAccess). One failure never aborts the run — every call is
// wrapped in try/catch and tallied.

import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import { notifyRewardsProgress } from '@/lib/rewards-issue';

/* eslint-disable @typescript-eslint/no-explicit-any */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST() {
  // Auth uses the request-scoped (cookie) client; data uses the service client.
  const authClient = await createClient();
  const isAdmin = await verifyAdminAccess(authClient);
  if (!isAdmin) {
    // verifyAdminAccess returns false for both "not logged in" and "not admin";
    // distinguish so the caller gets a 401 vs 403.
    const { data: { user } } = await authClient.auth.getUser();
    return NextResponse.json(
      { error: user ? 'Admin only' : 'Login required' },
      { status: user ? 403 : 401 },
    );
  }

  const db = createServiceClient();

  // ── Enumerate eligible customers (mirrors app/api/admin/rewards/standings) ──
  // Booking customers (completed, paid, solo — not band) ∪ beat buyers, mapped
  // to profile user_ids via email. notifyRewardsProgress self-skips the rest.
  const [{ data: profs }, { data: bookingRows }, { data: beatBuyers }] = await Promise.all([
    db.from('profiles').select('user_id,email'),
    db.from('bookings').select('customer_email')
      .eq('status', 'completed').is('deleted_at', null).is('band_id', null).gt('total_amount', 0),
    db.from('beat_purchases').select('buyer_id').not('buyer_id', 'is', null),
  ]);

  const emailToUser = new Map<string, string>();
  for (const p of (profs ?? []) as any[]) {
    if (p.email && p.user_id) emailToUser.set(String(p.email).toLowerCase(), p.user_id);
  }
  const custUserIds = new Set<string>();
  for (const b of (bookingRows ?? []) as any[]) {
    const uid = emailToUser.get(String(b.customer_email || '').toLowerCase());
    if (uid) custUserIds.add(uid);
  }
  for (const b of (beatBuyers ?? []) as any[]) {
    if (b.buyer_id) custUserIds.add(b.buyer_id);
  }

  const userIds = Array.from(custUserIds);
  const total = userIds.length;

  // ── Blast: one attempt per user, throttled, fault-isolated ──
  let attempted = 0;
  let failed = 0;
  for (const uid of userIds) {
    try {
      await notifyRewardsProgress(db, uid);
    } catch (e) {
      // notifyRewardsProgress is already self-guarded and never throws, but
      // belt-and-suspenders: a single user's failure must never abort the loop.
      failed++;
      console.error('[rewards/notify-all] notify failed for user', uid, e);
    }
    attempted++;
    // Throttle between users to stay well under Resend's ~25 emails/sec.
    if (attempted < total) await sleep(80);
  }

  return NextResponse.json({ ok: true, attempted, failed, total });
}
