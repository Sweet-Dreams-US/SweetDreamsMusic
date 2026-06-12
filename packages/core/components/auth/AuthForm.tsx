'use client';

import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Mode = 'signin' | 'signup' | 'forgot';

export default function AuthForm() {
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'signup') return 'signup';
    }
    return 'signin';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const supabase = createClient();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (mode === 'forgot') {
        // Custom branded reset flow — see /api/auth/forgot-password for why
        // we don't call supabase.auth.resetPasswordForEmail directly.
        // The route always returns 200 (anti-enumeration), so we always
        // show the same success message regardless of whether the email
        // matches an account.
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (res.status === 429) {
          throw new Error('Too many reset attempts. Please wait a minute and try again.');
        }
        if (!res.ok) {
          throw new Error('Could not send reset email. Please try again.');
        }
        setMessage('If an account exists for that email, a reset link is on its way. Check your inbox (and spam folder just in case).');
      } else if (mode === 'signup') {
        const params = new URLSearchParams(window.location.search);
        const redirect = params.get('redirect');
        const callbackUrl = redirect
          ? `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(redirect)}`
          : `${window.location.origin}/api/auth/callback`;
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: callbackUrl,
          },
        });
        if (error) throw error;
        // If session exists, user is auto-confirmed — redirect immediately
        if (data?.session) {
          window.location.href = redirect || '/dashboard';
          return;
        }
        // Otherwise email confirmation is required
        setMessage('Account created! Check your email for a confirmation link, then come back to sign in.');
        // Switch to sign-in mode after a delay so they can log in
        setTimeout(() => {
          setMode('signin');
          setMessage('Email confirmed? Sign in below.');
        }, 5000);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        const params = new URLSearchParams(window.location.search);
        window.location.href = params.get('redirect') || '/dashboard';
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {mode === 'signup' && (
        <div>
          <label htmlFor="displayName" className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">
            Artist / Display Name *
          </label>
          <input
            type="text"
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
            placeholder="Your name or artist name"
          />
        </div>
      )}

      <div>
        <label htmlFor="email" className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">
          Email *
        </label>
        <input
          type="email"
          id="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
          placeholder="your@email.com"
        />
      </div>

      {mode !== 'forgot' && (
        <div>
          <label htmlFor="password" className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">
            Password *
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full border-2 border-black px-4 py-3 pr-12 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
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
      )}

      {error && (
        <p className="font-mono text-sm text-red-600">{error}</p>
      )}

      {message && (
        <p className="font-mono text-sm text-green-700">{message}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-black text-white font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black/80 transition-colors disabled:opacity-50"
      >
        {loading ? 'LOADING...' : mode === 'forgot' ? 'SEND RESET LINK' : mode === 'signin' ? 'SIGN IN' : 'CREATE ACCOUNT'}
      </button>

      {mode === 'signin' && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}
            className="font-mono text-sm text-black/60 hover:text-accent transition-colors underline"
          >
            Forgot your password?
          </button>
        </div>
      )}

      <div className="text-center">
        <button
          type="button"
          onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setMessage(''); }}
          className="font-mono text-sm text-black/60 hover:text-accent transition-colors underline"
        >
          {mode === 'forgot' ? 'Back to sign in' : mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </form>
  );
}
