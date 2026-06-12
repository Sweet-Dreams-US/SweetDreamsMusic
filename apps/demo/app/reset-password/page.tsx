'use client';

// app/reset-password/page.tsx
//
// User lands here after clicking the reset link in their email. The link
// shape is /reset-password?token=<64-hex-chars>. We read the token from
// the URL and POST { token, newPassword } to /api/auth/reset-password —
// that endpoint validates the token (single-use, 1-hour expiry), updates
// the password via the Supabase Admin API, and returns ok.
//
// Once successful, the user signs in with their new password from /login.
// We don't auto-establish a session — that would require generating a
// magic link or session via the same admin code paths that have been
// broken for this project's SMTP config. Sign-in is a clean fallback.

import { useState, useEffect, type FormEvent, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  // Friendlier error if someone lands here without a token (e.g. typed the
  // URL by hand or their email client mangled the query string).
  useEffect(() => {
    if (!token) {
      setError('Missing reset token. Open the link from your email, or request a new one.');
    }
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Missing reset token. Open the link from your email, or request a new one.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Could not update password.');
      }
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <section className="bg-white text-black min-h-[80vh] flex items-center justify-center py-20">
        <div className="max-w-md w-full mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-heading-xl mb-4">PASSWORD UPDATED</h1>
          <p className="font-mono text-sm text-black/60 mb-8">
            Your password has been reset. Sign in with your new password to continue.
          </p>
          <a
            href="/login"
            className="bg-black text-white font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black/80 transition-colors no-underline inline-block"
          >
            SIGN IN
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white text-black min-h-[80vh] flex items-center justify-center py-20">
      <div className="max-w-md w-full mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <h1 className="text-heading-xl mb-3">RESET PASSWORD</h1>
          <p className="font-mono text-sm text-black/60">
            Enter your new password below.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="password" className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">
              New Password *
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                disabled={!token}
                className="w-full border-2 border-black px-4 py-3 pr-12 font-mono text-sm bg-transparent focus:border-accent focus:outline-none disabled:opacity-50"
                placeholder="Min 6 characters"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-black/40 hover:text-black transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">
              Confirm Password *
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              disabled={!token}
              className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none disabled:opacity-50"
              placeholder="Confirm your password"
            />
          </div>

          {error && (
            <p className="font-mono text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !token}
            className="w-full bg-black text-white font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black/80 transition-colors disabled:opacity-50"
          >
            {loading ? 'UPDATING...' : 'UPDATE PASSWORD'}
          </button>

          {!token && (
            <p className="font-mono text-xs text-black/50 text-center">
              <a href="/login" className="underline hover:text-black">Request a new reset link</a>
            </p>
          )}
        </form>
      </div>
    </section>
  );
}

export default function ResetPasswordPage() {
  // Suspense wrapper required because useSearchParams() is async-y in
  // App Router. Without it, Next 15+ throws a build-time error about
  // missing Suspense boundary for client-only param reads.
  return (
    <Suspense
      fallback={
        <section className="bg-white text-black min-h-[80vh] flex items-center justify-center py-20">
          <p className="font-mono text-sm text-black/40">Loading…</p>
        </section>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
