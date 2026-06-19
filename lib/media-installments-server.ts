// lib/media-installments-server.ts
//
// Server-only helpers for the Media Projects installment + contract layer.
// Imports the service Supabase client → MUST NOT be imported by client
// components.
//
// Centralizes the bits the installment / contract routes + webhook all
// share: the installment row type, a list reader, and the artist-side
// ownership check (owner OR band member) reused by the agree route and the
// payment gate.

import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from './supabase/server';
import { getUserBands } from './bands-server';
import { sendPasswordReset } from './email';
import { SITE_URL } from './constants';

export type InstallmentStatus = 'pending' | 'link_sent' | 'paid' | 'void';
export type InstallmentPaidMethod =
  | 'card'
  | 'link'
  | 'cash'
  | 'venmo'
  | 'check'
  | 'other';

export type MediaInstallment = {
  id: string;
  booking_id: string;
  sort_order: number;
  label: string;
  amount_cents: number;
  due_date: string | null;
  status: InstallmentStatus;
  stripe_payment_link_id: string | null;
  stripe_payment_link_url: string | null;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
  paid_method: InstallmentPaidMethod | null;
  created_at: string;
  updated_at: string;
};

const INSTALLMENT_COLUMNS =
  'id, booking_id, sort_order, label, amount_cents, due_date, status, ' +
  'stripe_payment_link_id, stripe_payment_link_url, stripe_payment_intent_id, ' +
  'paid_at, paid_method, created_at, updated_at';

/**
 * All installments for a booking, in display (pay) order. Empty array means
 * the booking has NO plan — i.e. it's a legacy deposit/remainder booking and
 * the caller should fall back to the existing flow.
 */
export async function getInstallmentsForBooking(
  bookingId: string,
  client?: SupabaseClient,
): Promise<MediaInstallment[]> {
  const supabase = client || createServiceClient();
  const { data, error } = await supabase
    .from('media_payment_installments')
    .select(INSTALLMENT_COLUMNS)
    .eq('booking_id', bookingId)
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('[media-installments] getInstallmentsForBooking error:', error);
    return [];
  }
  return (data || []) as unknown as MediaInstallment[];
}

/** Sum of paid stints, in cents. The "paid so far" figure for a plan project. */
export function paidSoFarCents(installments: MediaInstallment[]): number {
  return installments
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + i.amount_cents, 0);
}

/**
 * Whether the plan is "locked" — i.e. at least one stint is already paid or
 * has an outstanding payment link. A locked plan cannot be wholesale
 * replaced; the manager must work with the existing rows.
 */
export function planIsLocked(installments: MediaInstallment[]): boolean {
  return installments.some(
    (i) => i.status === 'paid' || i.status === 'link_sent',
  );
}

/**
 * Artist-side ownership check for a media booking: the signed-in user must be
 * the booking owner OR (for band-attached bookings) a member of the band.
 * Returns the booking row when allowed, or a typed failure otherwise.
 *
 * Uses the service client for the read so RLS doesn't second-guess the
 * explicit check (mirrors app/api/media/sessions/route.ts).
 */
export async function loadBookingForArtist(
  bookingId: string,
  userId: string,
  client?: SupabaseClient,
): Promise<
  | { ok: true; booking: MediaBookingOwnershipRow }
  | { ok: false; status: 404 | 403; error: string }
> {
  const supabase = client || createServiceClient();
  const { data, error } = await supabase
    .from('media_bookings')
    .select(
      'id, user_id, band_id, status, final_price_cents, contract_terms, contract_agreed_at, contract_agreed_by',
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 404, error: 'Order not found' };
  }
  const booking = data as MediaBookingOwnershipRow;

  if (booking.user_id === userId) {
    return { ok: true, booking };
  }
  if (booking.band_id) {
    const memberships = await getUserBands(userId);
    if (memberships.some((m) => m.band_id === booking.band_id)) {
      return { ok: true, booking };
    }
  }
  return { ok: false, status: 403, error: 'Not your order' };
}

export type MediaBookingOwnershipRow = {
  id: string;
  user_id: string;
  band_id: string | null;
  status: string;
  final_price_cents: number;
  contract_terms: string | null;
  contract_agreed_at: string | null;
  contract_agreed_by: string | null;
};

// ============================================================
// Invite-by-email for project buyers
// ============================================================

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for new artists

/**
 * Find an existing auth user by email. Paginates listUsers (the Admin SDK on
 * this project has no getUserByEmail / server-side filter), matching the
 * approach in app/api/auth/forgot-password. Sweet Dreams has well under 1000
 * users so this is one round-trip in practice. Case-insensitive.
 */
async function findAuthUserIdByEmail(
  service: SupabaseClient,
  email: string,
): Promise<string | null> {
  const target = email.trim().toLowerCase();
  let page = 1;
  while (page < 50) {
    const { data, error } = await service.auth.admin.listUsers({ perPage: 1000, page });
    if (error || !data?.users || data.users.length === 0) break;
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < 1000) break;
    page++;
  }
  return null;
}

export type ResolveArtistResult =
  | { ok: true; userId: string; invited: boolean; created: boolean }
  | { ok: false; status: 400 | 404 | 500; error: string };

/**
 * Resolve the buyer for a project: either an existing user_id, or an email
 * that maps to (or creates) an artist user.
 *
 * Precedence:
 *   1. If `userId` is provided + valid, use it (existing-user selection —
 *      the legacy path; unchanged behavior).
 *   2. Else if `email` is provided:
 *        a. existing auth user with that email → return its id (invited:false)
 *        b. otherwise create the auth user (email_confirm:true so they can be
 *           attached + log in once they set a password). The handle_new_user
 *           DB trigger auto-creates the profiles row. Then mint a
 *           password_reset_tokens row and email a set-password / welcome link
 *           via the existing sendPasswordReset path so the new artist can log
 *           in and see the project. (invited:true, created:true)
 *
 * Reuses the platform's existing user-creation + token-link mechanism rather
 * than introducing a parallel invite system.
 */
export async function resolveOrInviteArtist(
  service: SupabaseClient,
  args: { userId?: string | null; email?: string | null; displayName?: string | null },
): Promise<ResolveArtistResult> {
  const userId = args.userId?.trim() || '';
  const email = args.email?.trim().toLowerCase() || '';

  // ── Path 1: existing-user selection ────────────────────────────────
  if (userId) {
    const { data: profile } = await service
      .from('profiles')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (!profile) {
      return { ok: false, status: 404, error: 'Selected buyer not found' };
    }
    return { ok: true, userId, invited: false, created: false };
  }

  // ── Path 2: invite-by-email ────────────────────────────────────────
  if (!email || !/.+@.+\..+/.test(email)) {
    return {
      ok: false,
      status: 400,
      error: 'Provide either an existing user_id or a valid buyer email',
    };
  }

  // 2a. Existing user with this email — attach, no invite needed.
  const existingId = await findAuthUserIdByEmail(service, email);
  if (existingId) {
    return { ok: true, userId: existingId, invited: false, created: false };
  }

  // 2b. Create the auth user (profile auto-created by the DB trigger).
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: args.displayName ? { display_name: args.displayName } : undefined,
  });
  if (createErr || !created?.user) {
    console.error('[media-installments] createUser error:', createErr);
    return {
      ok: false,
      status: 500,
      error: `Could not create artist account: ${createErr?.message || 'unknown error'}`,
    };
  }
  const newUserId = created.user.id;

  // Mint a set-password / welcome link via the existing token mechanism.
  // Fail-soft: if the email/token step fails, the user + booking still
  // exist; the artist can self-rescue via Forgot Password.
  try {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString();
    const { error: tokenErr } = await service.from('password_reset_tokens').insert({
      token,
      user_id: newUserId,
      email,
      expires_at: expiresAt,
    });
    if (tokenErr) {
      console.error('[media-installments] invite token insert error:', tokenErr);
    } else {
      const link = `${SITE_URL}/reset-password?token=${token}`;
      await sendPasswordReset(email, link, args.displayName || undefined);
    }
  } catch (e) {
    console.error('[media-installments] invite email error (swallowed):', e);
  }

  return { ok: true, userId: newUserId, invited: true, created: true };
}
