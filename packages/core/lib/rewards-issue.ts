// lib/rewards-issue.ts — approve / deny / issue a reward_grant.
//
// Issuance maps a grant to the real thing, reusing existing ledgers:
//   • free_hours                         → studio_credits insert (comp, cost_basis 0)
//   • free_short_video / _music_video /  → media_credits insert (credit_kind), comp
//     _photo_session / bundled_cutdowns
//   • spend/mv/referral discount, account_credit_cents, cash_bonus, status
//                                        → NO ledger row: the grant itself is the
//     record. The booking/checkout flow reads active discount grants (best-of),
//     and accounting reads owed cash_bonus grants. "Issuing" just stamps status.
//
// Idempotent via issued_ref. Free customer rewards still cost real money (the
// engineer/filmer is paid from the rewards/marketing budget); cost_basis 0 here
// only reflects that $0 of deferred REVENUE was booked — see spec §11.

import type { SupabaseClient } from '@supabase/supabase-js';
import { MEDIA_WORKER_TOTAL } from '@/lib/constants';
import { rewardLabel } from '@/lib/rewards';
import { customerNextReward } from '@/lib/rewards-server';
import { mirrorToThread } from '@/lib/messaging-mirror';
import { sendRewardReadyEmail, sendRewardsProgressEmail } from '@/lib/email';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

// Retail value estimate per media deliverable when the reward grant carries no cap.
const MEDIA_RETAIL_CENTS: Record<string, number> = {
  music_video: 100000, short_video: 15000, photo_session: 20000, cover_art: 10000, sweet_spot: 200000, other: 15000,
};

/**
 * Suggested team payout for a media session that was funded by a REWARD (a comp).
 * The studio pays the team their standard cut of the comped value from the rewards
 * budget. Returns 0 when the session wasn't reward-funded (then the admin types the
 * amount as usual — per-engagement rates vary for paid work).
 */
export async function suggestedMediaCompPayoutCents(db: Client, sessionId: string): Promise<number> {
  const { data: s } = await db.from('media_session_bookings').select('media_credit_id').eq('id', sessionId).maybeSingle();
  const creditId = (s as any)?.media_credit_id;
  if (!creditId) return 0;
  // Reward-issued credits are linked from the grant via issued_ref.
  const { data: grant } = await db.from('reward_grants').select('reward_cap_cents').eq('issued_ref', `media_credits:${creditId}`).maybeSingle();
  if (!grant) return 0; // not a reward comp
  const { data: credit } = await db.from('media_credits').select('credit_kind').eq('id', creditId).maybeSingle();
  const value = Number((grant as any).reward_cap_cents) || MEDIA_RETAIL_CENTS[String((credit as any)?.credit_kind)] || MEDIA_RETAIL_CENTS.other;
  return Math.round(value * MEDIA_WORKER_TOTAL);
}

const MEDIA_KIND: Record<string, string> = {
  free_short_video: 'short_video',
  free_music_video: 'music_video',
  free_photo_session: 'photo_session',
  free_sweet_spot: 'sweet_spot',
  bundled_cutdowns: 'short_video',
};

// Map a media reward_type → the media_offerings.slug it should land on as a
// comped PROJECT in /media-team. Used to resolve offering_id (NOT NULL on
// media_bookings). Order of fallbacks is handled at insert time: we try the
// primary slug, then any sibling that shares the same `kind` family, so a
// tenant whose offering catalog uses slightly different slugs still resolves.
//
// NOTE: free_sweet_spot has no standalone media offering in the seed catalog
// (it's a studio/recording perk, not a media deliverable), so it has no slug
// here — that reward issues the media_credit only, no project (see issues).
const MEDIA_OFFERING_SLUG: Record<string, string[]> = {
  free_short_video: ['short-basic', 'short-mid', 'short-premium'],
  free_music_video: ['mv-mid', 'mv-premium'],
  free_photo_session: ['photo-session'],
  bundled_cutdowns: ['short-basic', 'short-mid', 'short-premium'],
};

/**
 * Resolve the media_offerings.id for a comped reward project. media_bookings
 * .offering_id is NOT NULL with an FK, so we MUST have a real offering to create
 * the project. Tries the reward's candidate slugs in order; returns the first
 * active match (or any match), else null (caller then skips the project and
 * keeps only the media_credit). Uses the same cross-tenant client issueGrant
 * already holds, so it sees the calling studio's offering catalog.
 */
async function resolveCompOfferingId(db: Client, rewardType: string): Promise<{ id: string; title: string } | null> {
  const slugs = MEDIA_OFFERING_SLUG[rewardType];
  if (!slugs || !slugs.length) return null;
  const { data } = await db.from('media_offerings')
    .select('id,title,slug,is_active')
    .in('slug', slugs);
  const rows = (data ?? []) as Array<{ id: string; title: string; slug: string; is_active: boolean }>;
  if (!rows.length) return null;
  // Prefer the first candidate slug that exists AND is active; fall back to the
  // first existing row regardless of active flag (better a comped project on an
  // inactive offering than none).
  for (const slug of slugs) {
    const active = rows.find((r) => r.slug === slug && r.is_active);
    if (active) return { id: active.id, title: active.title };
  }
  for (const slug of slugs) {
    const any = rows.find((r) => r.slug === slug);
    if (any) return { id: any.id, title: any.title };
  }
  return null;
}

export interface IssueResult { ok: boolean; reason?: string; issued_ref?: string }

/** Issue an already-approved grant (idempotent). Creates the credit ledger row + stamps the grant. */
export async function issueGrant(db: Client, grantId: string): Promise<IssueResult> {
  const { data: g } = await db.from('reward_grants').select('*').eq('id', grantId).maybeSingle();
  if (!g) return { ok: false, reason: 'grant not found' };
  if (g.status === 'issued' || g.status === 'redeemed' || g.issued_ref) return { ok: true, issued_ref: g.issued_ref }; // idempotent
  if (g.status !== 'approved') return { ok: false, reason: `grant is ${g.status}, not approved` };

  // Redemption expiry from the rule (90d for free work; null = never).
  const { data: rule } = await db.from('reward_rules').select('expires_days').eq('id', g.rule_id).maybeSingle();
  const expiresDays: number | null = (rule as any)?.expires_days ?? null;
  const expires_at = expiresDays ? new Date(Date.now() + expiresDays * 86_400_000).toISOString() : null;

  let issued_ref: string;

  if (g.reward_type === 'free_hours') {
    const { data, error } = await db.from('studio_credits').insert({
      user_id: g.owner_user_id, band_id: g.owner_band_id,
      hours_granted: g.reward_value, hours_used: 0,
      cost_basis_cents: 0, expires_at, source_booking_id: null,
    }).select('id').single();
    if (error || !data) return { ok: false, reason: `studio_credits: ${error?.message}` };
    issued_ref = `studio_credits:${(data as any).id}`;
  } else if (MEDIA_KIND[g.reward_type]) {
    const qty = Math.max(1, Math.round(Number(g.reward_value) || 1));
    const { data, error } = await db.from('media_credits').insert({
      user_id: g.owner_user_id, band_id: g.owner_band_id,
      credit_kind: MEDIA_KIND[g.reward_type], quantity_granted: qty, quantity_redeemed: 0,
      cost_basis_cents: 0, expires_at, notes: `Reward: ${g.rule_key}`,
    }).select('id').single();
    if (error || !data) return { ok: false, reason: `media_credits: ${error?.message}` };
    const mediaCreditId = (data as any).id as string;
    issued_ref = `media_credits:${mediaCreditId}`;

    // ── Also materialize a COMPED media PROJECT so the reward lands in
    // /media-team Projects ("media rewards link to media bookings"). The
    // booking is fully comped: $0 price/deposit, marked paid now, dropped into
    // a SCHEDULABLE status ('deposited' — NOT 'inquiry') so the media team can
    // schedule shoots. offering_id is REQUIRED (NOT NULL FK), so we only create
    // the project when a matching media_offerings row resolves; otherwise we
    // keep just the media_credit (see resolveCompOfferingId + issues).
    //
    // Idempotency: a re-issue is already blocked by the guard at the top of
    // issueGrant (status/issued_ref short-circuit). As a second layer, we skip
    // project creation if this grant's metadata already records a booking id —
    // so a manual force-reissue can never spawn a duplicate project.
    const alreadyHasProject = !!((g as any).metadata?.comp_media_booking_id);
    let compBookingId: string | null = null;
    if (!alreadyHasProject) {
      const offering = await resolveCompOfferingId(db, g.reward_type);
      if (offering) {
        const compNow = new Date().toISOString();
        const projectDetails = {
          comped: true,
          source: 'reward_grant',
          reward_grant_id: g.id,
          reward_type: g.reward_type,
          rule_key: g.rule_key,
          media_credit_id: mediaCreditId,
          additional_notes: `Comped from reward "${g.rule_key}" (grant ${g.id}). Fully covered — no charge to the artist.`,
        };
        const { data: booking, error: bookErr } = await db.from('media_bookings').insert({
          offering_id: offering.id,
          user_id: g.owner_user_id,
          band_id: g.owner_band_id,
          status: 'deposited', // schedulable, not 'inquiry'
          configured_components: null,
          project_details: projectDetails,
          final_price_cents: 0,
          deposit_cents: 0,
          actual_deposit_paid: 0,
          deposit_paid_at: compNow,
          final_paid_at: compNow, // $0 owed → fully settled now
          stripe_payment_intent_id: `REWARD-COMP-${g.id}`,
          stripe_session_id: null,
          notes_to_us: `Reward comp: ${offering.title} — issued from grant ${g.id} (${g.rule_key}). Linked media_credit ${mediaCreditId}.`,
          is_test: false,
          created_by: 'rewards-engine',
        }).select('id').single();
        if (bookErr || !booking) {
          // Non-fatal: the credit already exists and is the source of truth for
          // redemption. Log and continue so issuance still succeeds + stamps.
          console.error('[rewards-issue] comp media_bookings insert failed:', bookErr?.message);
        } else {
          compBookingId = (booking as any).id as string;
        }
      } else {
        console.warn(`[rewards-issue] no media offering matched reward_type=${g.reward_type}; comp project skipped, media_credit ${mediaCreditId} kept.`);
      }
    }

    // Stamp the created booking id back onto the grant metadata so a re-issue
    // detects it (idempotency) and the project<->grant link is queryable.
    if (compBookingId) {
      await db.from('reward_grants').update({
        metadata: { ...((g as any).metadata || {}), comp_media_booking_id: compBookingId, comp_media_credit_id: mediaCreditId },
      }).eq('id', grantId);
    }
  } else {
    // discount / account_credit / cash_bonus / status — consumed by reading the grant.
    issued_ref = `inline:${g.reward_type}`;
  }

  const { error: upd } = await db.from('reward_grants').update({
    status: 'issued', issued_at: new Date().toISOString(), issued_ref, expires_at,
  }).eq('id', grantId);
  if (upd) return { ok: false, reason: `stamp: ${upd.message}` };

  // Real earned/approved -> issued transition: notify the recipient. We only
  // reach here on a fresh issue (the idempotent guard above early-returns for
  // already-issued/redeemed grants), so this fires exactly once per grant.
  // Fire-and-forget — a notify/email failure must never fail the issuance.
  await notifyGrantIssued(db, g);

  return { ok: true, issued_ref };
}

/**
 * In-app + email "your reward is ready" notification, fired once when a grant
 * reaches 'issued'. Reuses the career system's inbox helper (mirrorToThread)
 * for the in-app post and the studio's Resend sender (sendRewardReadyEmail).
 *
 * For a band grant we fan the in-app congrats out to every band member's thread
 * (mirrorToThread supports a per-user thread); the email goes to the band's
 * owner. For a personal grant, both go to owner_user_id.
 *
 * NEVER throws: each side is wrapped so issuance is never blocked by a notify or
 * email failure (matches the codebase's fire-and-forget email pattern).
 */
async function notifyGrantIssued(db: Client, grant: any): Promise<void> {
  try {
    const label = rewardLabel({
      reward_type: grant.reward_type,
      reward_value: grant.reward_value,
      reward_cap_cents: grant.reward_cap_cents,
    });
    const subject = 'Your reward is ready 🎁';
    const body = `You earned ${label}. It's waiting in your dashboard under Perks — free studio time and discounts apply automatically when you book, and credits + media perks redeem right from the booking flow.`;

    // Resolve recipient user ids: a band grant -> every band member; otherwise
    // the single owner. Email goes to the band owner (or the owner user).
    const recipientUserIds: string[] = [];
    let emailUserId: string | null = null;

    if (grant.owner_band_id) {
      const { data: members } = await db.from('band_members')
        .select('user_id,role').eq('band_id', grant.owner_band_id);
      for (const m of ((members ?? []) as any[])) {
        if (m.user_id) recipientUserIds.push(m.user_id);
      }
      const owner = ((members ?? []) as any[]).find((m) => m.role === 'owner');
      emailUserId = owner?.user_id ?? recipientUserIds[0] ?? null;
    } else if (grant.owner_user_id) {
      recipientUserIds.push(grant.owner_user_id);
      emailUserId = grant.owner_user_id;
    }

    // In-app: one inbox post per recipient. Each is independently best-effort.
    for (const uid of recipientUserIds) {
      try {
        await mirrorToThread({ userId: uid, kind: 'update', subject, body });
      } catch (e) { console.error('[rewards-issue] in-app notify failed:', e); }
    }

    // Email: resolve the recipient's address from profiles using the route's client.
    if (emailUserId) {
      const { data: prof } = await db.from('profiles')
        .select('email,display_name').eq('user_id', emailUserId).maybeSingle();
      const to = (prof as any)?.email as string | undefined;
      if (to) {
        await sendRewardReadyEmail(to, {
          recipientName: (prof as any)?.display_name || 'there',
          rewardLabel: label,
        });
      }
    }
  } catch (e) {
    // Top-level guard: issuance already succeeded; swallow everything.
    console.error('[rewards-issue] notifyGrantIssued failed:', e);
  }
}

/**
 * "Rewards progress" nudge: tell a customer where they are on the studio-hours
 * reward ladder — current calendar-year hours, hours until the NEXT reward, and
 * WHAT that reward is. Fired (fire-and-forget) after a solo studio booking is
 * confirmed, so the customer sees their progress climb.
 *
 * Resolves the user's email + display_name from profiles, computes the next rung
 * via customerNextReward, and — when there's something left to chase — posts an
 * in-app update (mirrorToThread, kind 'update') AND sends the branded progress
 * email. No-op (does nothing) when:
 *   • the user has no profile/email, or
 *   • currentHours is 0 (haven't logged any hours yet — nothing to celebrate), or
 *   • the top tier is already reached (customerNextReward returns null).
 *
 * NEVER throws — wrapped end-to-end so it can never block or fail a booking.
 */
export async function notifyRewardsProgress(db: Client, userId: string): Promise<void> {
  try {
    if (!userId) return;
    const { data: prof } = await db.from('profiles')
      .select('email,display_name').eq('user_id', userId).maybeSingle();
    const email = (prof as any)?.email as string | undefined;
    if (!email) return; // can't compute customer studio hours without an email

    const next = await customerNextReward(db, userId, email, new Date());
    if (!next || next.currentHours <= 0) return; // top tier reached, or no hours yet

    const hrs = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? 'hr' : 'hrs'}`;
    const subject = 'Your rewards update';
    const body = `You've booked ${hrs(next.currentHours)} this year — ${hrs(next.hoursRemaining)} more for ${next.nextRewardLabel}! See Perks in your dashboard.`;

    // In-app (best-effort, independent of the email).
    try {
      await mirrorToThread({ userId, kind: 'update', subject, body });
    } catch (e) { console.error('[rewards-issue] progress in-app notify failed:', e); }

    // Email (never throws — sendRewardsProgressEmail swallows its own errors).
    await sendRewardsProgressEmail(email, {
      recipientName: (prof as any)?.display_name || 'there',
      currentHours: next.currentHours,
      nextThreshold: next.nextThreshold,
      hoursRemaining: next.hoursRemaining,
      nextRewardLabel: next.nextRewardLabel,
      progressPct: next.progressPct,
    });
  } catch (e) {
    // Top-level guard: this is a fire-and-forget nudge; never let it surface.
    console.error('[rewards-issue] notifyRewardsProgress failed:', e);
  }
}

/** Approve a pending grant (and, by default, issue it immediately). */
export async function approveGrant(db: Client, grantId: string, adminUserId: string, opts: { autoIssue?: boolean } = {}): Promise<IssueResult> {
  const autoIssue = opts.autoIssue ?? true;
  const { data: g } = await db.from('reward_grants').select('id,status').eq('id', grantId).maybeSingle();
  if (!g) return { ok: false, reason: 'grant not found' };
  if (!['pending_approval', 'earned', 'approved'].includes((g as any).status)) {
    return { ok: false, reason: `grant is ${(g as any).status}` };
  }
  await db.from('reward_grants').update({
    status: 'approved', approved_by: adminUserId, approved_at: new Date().toISOString(),
  }).eq('id', grantId);
  return autoIssue ? issueGrant(db, grantId) : { ok: true };
}

/** Deny a pending grant (won't be issued). */
export async function denyGrant(db: Client, grantId: string, adminUserId: string, reason?: string): Promise<IssueResult> {
  const { data: g } = await db.from('reward_grants').select('id,status,metadata').eq('id', grantId).maybeSingle();
  if (!g) return { ok: false, reason: 'grant not found' };
  if ((g as any).status === 'issued' || (g as any).status === 'redeemed') {
    return { ok: false, reason: 'already issued — cannot deny' };
  }
  await db.from('reward_grants').update({
    status: 'denied', approved_by: adminUserId, approved_at: new Date().toISOString(),
    metadata: { ...((g as any).metadata || {}), deny_reason: reason || null },
  }).eq('id', grantId);
  return { ok: true };
}

/**
 * Active redeemable DISCOUNTS for an owner right now (issued/approved, not expired).
 * The booking + media checkout flows call this and apply BEST-OF (never stack).
 * Returns the single largest percent per discount family + any dollar credits.
 */
export async function activeDiscountsForOwner(
  db: Client, ownerUserId: string | null, ownerBandId: string | null,
): Promise<{ spendPct: number; mvPct: number; referralPct: number; creditCents: number }> {
  let q = db.from('reward_grants')
    .select('reward_type,reward_value,value_cents,status,expires_at,owner_user_id,owner_band_id')
    .in('status', ['approved', 'issued'])
    .in('reward_type', ['spend_discount_pct', 'mv_discount_pct', 'referral_discount_pct', 'account_credit_cents']);
  if (ownerBandId) q = q.eq('owner_band_id', ownerBandId);
  else q = q.eq('owner_user_id', ownerUserId);
  const { data } = await q;
  const now = Date.now();
  const live = (data ?? []).filter((g: any) => !g.expires_at || new Date(g.expires_at).getTime() > now);
  const max = (t: string) => live.filter((g: any) => g.reward_type === t).reduce((m: number, g: any) => Math.max(m, Number(g.reward_value) || 0), 0);
  const creditCents = live.filter((g: any) => g.reward_type === 'account_credit_cents').reduce((s: number, g: any) => s + (Number(g.value_cents) || 0), 0);
  return { spendPct: max('spend_discount_pct'), mvPct: max('mv_discount_pct'), referralPct: max('referral_discount_pct'), creditCents };
}

/**
 * The single best STUDIO-session discount grant for an owner to apply to a booking,
 * with the grant id (so it can be marked redeemed / restored). Best-of, never stacked:
 * the highest spend/referral percent. (MV discounts apply to music videos, not studio
 * sessions, so they're excluded here.) Returns null when nothing applies.
 */
export async function bestStudioDiscountForOwner(
  db: Client, ownerUserId: string | null, ownerBandId: string | null,
): Promise<{ grantId: string; pct: number; rule_key: string } | null> {
  let q = db.from('reward_grants')
    .select('id,reward_type,reward_value,status,expires_at,rule_key')
    .in('status', ['approved', 'issued'])
    .in('reward_type', ['spend_discount_pct', 'referral_discount_pct']);
  if (ownerBandId) q = q.eq('owner_band_id', ownerBandId);
  else q = q.eq('owner_user_id', ownerUserId);
  const { data } = await q;
  const now = Date.now();
  const live = (data ?? []).filter((g: any) => !g.expires_at || new Date(g.expires_at).getTime() > now);
  if (!live.length) return null;
  const best = live.reduce((hi: any, g: any) => ((Number(g.reward_value) || 0) > (Number(hi.reward_value) || 0) ? g : hi), live[0]);
  const pct = Number(best.reward_value) || 0;
  return pct > 0 ? { grantId: best.id, pct, rule_key: best.rule_key } : null;
}

/**
 * The best BEAT-store discount grant for a buyer at beat checkout, scoped by license
 * type: leases (mp3/trackout) → beat_lease_discount_pct; exclusive →
 * beat_exclusive_discount_pct. Best-of (highest %), never stacked. Returns null when
 * nothing applies, so beat checkout is a no-op until a grant actually exists.
 */
export async function bestBeatDiscountForOwner(
  db: Client, ownerUserId: string | null, licenseType: string,
): Promise<{ grantId: string; pct: number; rule_key: string } | null> {
  if (!ownerUserId) return null;
  const rewardType = licenseType === 'exclusive' ? 'beat_exclusive_discount_pct' : 'beat_lease_discount_pct';
  const { data } = await db.from('reward_grants')
    .select('id,reward_type,reward_value,status,expires_at,rule_key')
    .in('status', ['approved', 'issued'])
    .eq('reward_type', rewardType)
    .eq('owner_user_id', ownerUserId);
  const now = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const live = (data ?? []).filter((g: any) => !g.expires_at || new Date(g.expires_at).getTime() > now);
  if (!live.length) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const best = live.reduce((hi: any, g: any) => ((Number(g.reward_value) || 0) > (Number(hi.reward_value) || 0) ? g : hi), live[0]);
  const pct = Number(best.reward_value) || 0;
  return pct > 0 ? { grantId: best.id, pct, rule_key: best.rule_key } : null;
}

/** Mark a discount grant redeemed (single-use) once a booking actually uses it. */
export async function markGrantRedeemed(db: Client, grantId: string, bookingId?: string): Promise<void> {
  await db.from('reward_grants').update({
    status: 'redeemed', redeemed_at: new Date().toISOString(),
    metadata: bookingId ? { redeemed_booking_id: bookingId } : {},
  }).eq('id', grantId).in('status', ['approved', 'issued']);
}

/**
 * Redeem ONE use of a MULTI-use discount grant (the beat exclusive perk, good for up
 * to maxUses exclusives). Tracks uses in metadata.uses; only flips to 'redeemed' once
 * maxUses is reached — so bestBeatDiscountForOwner (which filters approved/issued)
 * keeps returning it until then. Single-use grants keep using markGrantRedeemed.
 */
export async function redeemBeatDiscountUse(db: Client, grantId: string, purchaseId: string, maxUses: number): Promise<void> {
  const { data: g } = await db.from('reward_grants').select('metadata,status').eq('id', grantId).single();
  if (!g || (g.status !== 'approved' && g.status !== 'issued')) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const md: any = g.metadata || {};
  const uses = (Number(md.uses) || 0) + 1;
  const metadata = { ...md, uses, last_redeemed_purchase_id: purchaseId };
  const patch = uses >= maxUses
    ? { status: 'redeemed', redeemed_at: new Date().toISOString(), metadata }
    : { metadata };
  await db.from('reward_grants').update(patch).eq('id', grantId).in('status', ['approved', 'issued']);
}

/**
 * Restore rewards when a booking is cancelled (idempotent). Two cases:
 *  • credit-funded (admin_notes 'credit_redemption:<id>' + a studio_credit_redemptions
 *    row): give the hours back (decrement hours_used) and delete the redemption — the
 *    customer keeps their prepaid/free hours.
 *  • discount-funded (bookings.reward_grant_id set): put the discount grant back to
 *    'issued' so the customer can use it on another booking (cancelling shouldn't burn it).
 * Returns a summary of what was restored.
 */
export async function restoreRewardsOnCancel(db: Client, bookingId: string): Promise<{ hoursRestored: number; grantRestored: boolean }> {
  let hoursRestored = 0; let grantRestored = false;
  const { data: booking } = await db.from('bookings').select('id,admin_notes,reward_grant_id').eq('id', bookingId).maybeSingle();
  if (!booking) return { hoursRestored, grantRestored };
  const b = booking as any;

  // Credit-funded: restore hours if a redemption row still exists.
  const m = String(b.admin_notes || '').match(/credit_redemption:([a-f0-9-]+)/);
  if (m) {
    const creditId = m[1];
    const { data: redemption } = await db.from('studio_credit_redemptions')
      .select('id,hours_redeemed').eq('studio_booking_id', bookingId).maybeSingle();
    if (redemption) {
      const hrs = Number((redemption as any).hours_redeemed) || 0;
      const { data: credit } = await db.from('studio_credits').select('hours_used').eq('id', creditId).maybeSingle();
      if (credit) {
        const newUsed = Math.max(0, (Number((credit as any).hours_used) || 0) - hrs);
        await db.from('studio_credits').update({ hours_used: newUsed }).eq('id', creditId);
      }
      await db.from('studio_credit_redemptions').delete().eq('id', (redemption as any).id);
      hoursRestored = hrs;
    }
  }

  // Discount-funded: re-issue the grant so it isn't burned by a cancel.
  if (b.reward_grant_id) {
    const { data: g } = await db.from('reward_grants').select('status').eq('id', b.reward_grant_id).maybeSingle();
    if (g && (g as any).status === 'redeemed') {
      await db.from('reward_grants').update({ status: 'issued', redeemed_at: null }).eq('id', b.reward_grant_id);
      grantRestored = true;
    }
  }
  return { hoursRestored, grantRestored };
}
