// app/api/auth/reset-password/route.ts
//
// POST /api/auth/reset-password — validate a reset token and update the
// password. Companion to /api/auth/forgot-password.
//
// Body: { token: string, password: string }
//
// Flow:
//   1. Look up the token in password_reset_tokens
//   2. Reject if missing, used, or expired
//   3. Mark the token used (race-safe — UPDATE ... WHERE used_at IS NULL
//      and check rowcount before proceeding)
//   4. Call auth.admin.updateUserById(user_id, { password }) to set the
//      new password directly
//   5. Sign the user in by setting a fresh session cookie (so they land
//      on the dashboard logged in, matching the prior Supabase recovery
//      UX)
//
// Why we don't auto-sign-in the user: it would require generating a
// magic link or session via the admin API, which is the same bucket of
// pain we're avoiding. Instead the page redirects to /login with a
// success flag and the user signs in with their new password — fine UX
// for a recovery flow.

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

interface TokenRow {
  token: string;
  user_id: string;
  email: string;
  expires_at: string;
  used_at: string | null;
}

export async function POST(request: Request) {
  let token: string | undefined;
  let password: string | undefined;
  try {
    const body = await request.json();
    token = typeof body?.token === 'string' ? body.token.trim() : undefined;
    password = typeof body?.password === 'string' ? body.password : undefined;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (!token) {
    return NextResponse.json({ error: 'Missing reset token.' }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
  }

  const service = createServiceClient();

  // Look up the token. We could push validation into a single UPDATE ...
  // RETURNING to be race-safe, but a quick SELECT first lets us return a
  // clearer error message ("expired" vs "already used" vs "not found").
  const { data: tokenRow, error: lookupErr } = await service
    .from('password_reset_tokens')
    .select('token, user_id, email, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();

  if (lookupErr) {
    console.error('[reset-password] token lookup error:', lookupErr);
    return NextResponse.json({ error: 'Could not validate token.' }, { status: 500 });
  }

  const row = tokenRow as TokenRow | null;
  if (!row) {
    return NextResponse.json(
      { error: 'This reset link is not valid. Request a new one.' },
      { status: 400 },
    );
  }
  if (row.used_at) {
    return NextResponse.json(
      { error: 'This reset link has already been used. Request a new one.' },
      { status: 400 },
    );
  }
  if (new Date(row.expires_at) < new Date()) {
    return NextResponse.json(
      { error: 'This reset link has expired. Request a new one.' },
      { status: 400 },
    );
  }

  // Race-safe consume: only succeeds if used_at is still null when we run
  // the UPDATE. If two concurrent requests arrive (shouldn't happen but
  // defensive), only one will get rowcount=1.
  const nowISO = new Date().toISOString();
  const { data: consumed, error: consumeErr } = await service
    .from('password_reset_tokens')
    .update({ used_at: nowISO })
    .eq('token', token)
    .is('used_at', null)
    .select('token');

  if (consumeErr || !consumed || consumed.length === 0) {
    console.error('[reset-password] token consume error:', consumeErr);
    return NextResponse.json(
      { error: 'This reset link has already been used. Request a new one.' },
      { status: 400 },
    );
  }

  // Update the password AND mark the email confirmed (we just delivered
  // a working email to that address — that's the same proof of email
  // ownership that the signup confirmation flow exists to establish).
  // This unblocks any user whose account is stuck `email_confirmed_at IS
  // NULL` because Supabase's built-in confirmation email failed to
  // deliver — they can self-rescue via Forgot Password.
  //
  // service.auth.admin.updateUserById bypasses the user's session
  // entirely — this works even if the user has no active session
  // (which they don't, since they came in via email link).
  const { error: updateErr } = await service.auth.admin.updateUserById(row.user_id, {
    password,
    email_confirm: true,
  });

  if (updateErr) {
    console.error('[reset-password] password update error:', updateErr);
    // Token is now consumed but the password didn't change. The user
    // will need to request a new link. This is correct from a security
    // standpoint — we'd rather fail closed.
    return NextResponse.json(
      { error: 'Could not update password. Please request a new reset link.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, email: row.email });
}
