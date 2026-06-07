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
    issued_ref = `media_credits:${(data as any).id}`;
  } else {
    // discount / account_credit / cash_bonus / status — consumed by reading the grant.
    issued_ref = `inline:${g.reward_type}`;
  }

  const { error: upd } = await db.from('reward_grants').update({
    status: 'issued', issued_at: new Date().toISOString(), issued_ref, expires_at,
  }).eq('id', grantId);
  if (upd) return { ok: false, reason: `stamp: ${upd.message}` };
  return { ok: true, issued_ref };
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
