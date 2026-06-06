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

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

const MEDIA_KIND: Record<string, string> = {
  free_short_video: 'short_video',
  free_music_video: 'music_video',
  free_photo_session: 'photo_session',
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
