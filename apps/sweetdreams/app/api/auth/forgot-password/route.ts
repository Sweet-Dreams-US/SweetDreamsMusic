// app/api/auth/forgot-password/route.ts
//
// POST /api/auth/forgot-password — initiate a branded password reset email.
//
// Why this exists: Supabase's recovery flow is broken on this project's
// SMTP config — both `resetPasswordForEmail` and `admin.generateLink` end
// up calling Supabase's built-in mailer (which is rate-limited / failing)
// and surface "error sending recovery email" or silently drop. Users
// couldn't reset their passwords.
//
// Strategy: bypass Supabase's recovery flow entirely. We mint our own
// random token, store it in `password_reset_tokens`, and email the link
// via Resend (which is the same path every other working email on the
// platform uses). Token validation + password update happen in
// /api/auth/reset-password.
//
// Security:
// - Always responds 200 regardless of whether the email matches a user
//   (anti-enumeration). The actual outcome is logged server-side.
// - Rate-limited to 5/min per IP via the `auth` bucket (configured in
//   middleware.ts → classifyPath).
// - Tokens are 256 bits of crypto-random entropy, single-use, expire
//   in 1 hour, and only ever written/read via the service role.
// - Doesn't mirror into the user's Sweet Dreams thread — credential
//   rotation links shouldn't live in an inbox someone else might read.

import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { sendPasswordReset } from '@/lib/email';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sweetdreamsmusic.com';
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(request: Request) {
  let email: string | undefined;
  try {
    const body = await request.json();
    email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;
  } catch {
    // Fall through to the validation below
  }

  // Basic shape check — don't bother going further if it's not even an
  // email. We still respond 200 so callers can't tell the difference
  // between a bad input and a non-existent user.
  if (!email || !/.+@.+\..+/.test(email)) {
    return NextResponse.json({ ok: true });
  }

  const service = createServiceClient();

  try {
    // Look up the auth user by email. We use listUsers with a filter
    // because there's no `getUserByEmail` in the Admin API; the filter
    // pushes the search server-side rather than scanning the full list
    // client-side.
    const { data: usersList, error: listErr } = await service.auth.admin.listUsers({
      perPage: 1,
      page: 1,
    });
    if (listErr) {
      console.error('[forgot-password] listUsers error:', listErr);
      return NextResponse.json({ ok: true });
    }

    // listUsers doesn't accept a `filter` arg in the SDK we're on — so
    // we paginate. To avoid hammering the API on large user bases, we
    // page through chunks of 1000 and stop on first match. Sweet Dreams
    // has well under 1000 users so this is one round-trip in practice.
    let userId: string | null = null;
    let page = 1;
    while (page < 50) {
      const { data, error } = await service.auth.admin.listUsers({ perPage: 1000, page });
      if (error || !data?.users || data.users.length === 0) break;
      const match = data.users.find((u) => u.email?.toLowerCase() === email);
      if (match) {
        userId = match.id;
        break;
      }
      if (data.users.length < 1000) break;
      page++;
    }

    if (!userId) {
      // No user with that email. Log it but don't tell the caller.
      console.warn('[forgot-password] no user for', email);
      return NextResponse.json({ ok: true });
    }

    // Mint a fresh token. 32 bytes → 64 hex chars → ~256 bits of entropy.
    // URL-safe (hex is alphanumeric).
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    const { error: insertErr } = await service.from('password_reset_tokens').insert({
      token,
      user_id: userId,
      email,
      expires_at: expiresAt,
    });
    if (insertErr) {
      console.error('[forgot-password] token insert error:', insertErr);
      return NextResponse.json({ ok: true });
    }

    // Look up display_name for personalization. Fail-soft.
    let userName: string | undefined;
    try {
      const { data: profile } = await service
        .from('profiles')
        .select('display_name')
        .eq('user_id', userId)
        .maybeSingle();
      userName = (profile as { display_name?: string | null } | null)?.display_name ?? undefined;
    } catch (e) {
      console.error('[forgot-password] profile lookup error:', e);
    }

    const resetLink = `${SITE_URL}/reset-password?token=${token}`;
    await sendPasswordReset(email, resetLink, userName);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[forgot-password] unexpected error:', e);
    return NextResponse.json({ ok: true });
  }
}
