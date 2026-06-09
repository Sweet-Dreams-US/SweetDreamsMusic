'use client';

/**
 * Sweet Spot inquiry form.
 *
 * Distinct from the generic site contact form (components/shared/ContactForm.tsx)
 * because this one:
 *   - Collects band-specific fields (band name, preferred call time)
 *   - Routes to /api/bands/sweet-spot-inquiry (not /api/contact)
 *   - Emails Jay and Cole directly so they can follow up to schedule the 30-min call
 *
 * Two layers of spam protection: Cloudflare Turnstile (CAPTCHA) + a honeypot (the
 * hidden "company" field). Turnstile is best-effort (a broken/blocked widget never
 * disables Send); the server verifies the token when present and the honeypot backs
 * it up.
 */

import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { Send, MessageCircle } from 'lucide-react';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '0x4AAAAAAC-NKDZ6-U5VzVto';

export default function SweetSpotInquiryForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const renderTurnstile = useCallback(() => {
    if (!turnstileRef.current || widgetIdRef.current) return;
    const w = window as unknown as { turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id: string) => void } };
    if (w.turnstile) {
      widgetIdRef.current = w.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(null),
        theme: 'dark',
      });
    }
  }, []);

  useEffect(() => {
    if (document.getElementById('cf-turnstile-script')) {
      renderTurnstile();
      return;
    }
    const script = document.createElement('script');
    script.id = 'cf-turnstile-script';
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => setTimeout(renderTurnstile, 100);
    document.head.appendChild(script);
  }, [renderTurnstile]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('sending');

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name'),
      bandName: formData.get('bandName'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      preferredTime: formData.get('preferredTime'),
      message: formData.get('message'),
      company: formData.get('company'), // honeypot
      turnstileToken,
    };

    try {
      const res = await fetch('/api/bands/sweet-spot-inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.error === 'Verification failed') {
          setStatus('error');
          setTurnstileToken(null);
          const w = window as unknown as { turnstile?: { reset: (id: string) => void } };
          if (w.turnstile && widgetIdRef.current) w.turnstile.reset(widgetIdRef.current);
          return;
        }
        throw new Error('Failed to send');
      }
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'sent') {
    return (
      <div className="border-2 border-accent bg-accent/10 p-8 sm:p-12 text-center">
        <MessageCircle className="w-12 h-12 text-accent mx-auto mb-6" strokeWidth={1.5} />
        <h3 className="text-heading-lg mb-4 text-accent">INQUIRY SENT</h3>
        <p className="font-mono text-white/80 text-body-sm mb-2">
          Jay and Cole will reach out to schedule your 30-minute Sweet Spot call.
        </p>
        <p className="font-mono text-white/60 text-body-sm">
          Expect a reply within 1 business day. We&apos;ll call at the time you provided — or follow up by
          email if we can&apos;t reach you.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label
            htmlFor="name"
            className="block font-mono text-sm font-semibold uppercase tracking-wider mb-2 text-white"
          >
            Your name *
          </label>
          <input
            type="text"
            id="name"
            name="name"
            required
            className="w-full border-2 border-white/20 bg-black px-4 py-3 font-mono text-sm text-white focus:border-accent focus:outline-none transition-colors"
            placeholder="First and last name"
          />
        </div>

        <div>
          <label
            htmlFor="bandName"
            className="block font-mono text-sm font-semibold uppercase tracking-wider mb-2 text-white"
          >
            Band name *
          </label>
          <input
            type="text"
            id="bandName"
            name="bandName"
            required
            className="w-full border-2 border-white/20 bg-black px-4 py-3 font-mono text-sm text-white focus:border-accent focus:outline-none transition-colors"
            placeholder="Your band / project"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label
            htmlFor="email"
            className="block font-mono text-sm font-semibold uppercase tracking-wider mb-2 text-white"
          >
            Email *
          </label>
          <input
            type="email"
            id="email"
            name="email"
            required
            className="w-full border-2 border-white/20 bg-black px-4 py-3 font-mono text-sm text-white focus:border-accent focus:outline-none transition-colors"
            placeholder="you@band.com"
          />
        </div>

        <div>
          <label
            htmlFor="phone"
            className="block font-mono text-sm font-semibold uppercase tracking-wider mb-2 text-white"
          >
            Phone *
          </label>
          <input
            type="tel"
            id="phone"
            name="phone"
            required
            className="w-full border-2 border-white/20 bg-black px-4 py-3 font-mono text-sm text-white focus:border-accent focus:outline-none transition-colors"
            placeholder="(555) 123-4567"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="preferredTime"
          className="block font-mono text-sm font-semibold uppercase tracking-wider mb-2 text-white"
        >
          When should we call you? *
        </label>
        <input
          type="text"
          id="preferredTime"
          name="preferredTime"
          required
          className="w-full border-2 border-white/20 bg-black px-4 py-3 font-mono text-sm text-white focus:border-accent focus:outline-none transition-colors"
          placeholder="e.g. Weekdays after 5pm ET, or Sat morning"
        />
        <p className="font-mono text-xs text-white/50 mt-2">
          A day/time window is fine — we&apos;ll confirm the exact slot by email.
        </p>
      </div>

      <div>
        <label
          htmlFor="message"
          className="block font-mono text-sm font-semibold uppercase tracking-wider mb-2 text-white"
        >
          Anything else we should know?
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          className="w-full border-2 border-white/20 bg-black px-4 py-3 font-mono text-sm text-white focus:border-accent focus:outline-none transition-colors resize-vertical"
          placeholder="Genre, lineup size, songs you want to track, timing — whatever helps us prep for the call."
        />
      </div>

      {/* Honeypot — hidden from humans, traps bots. */}
      <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] top-0 h-0 w-0 opacity-0" />

      {/* Cloudflare Turnstile verification */}
      <div ref={turnstileRef} className="flex justify-center" />

      {status === 'error' && (
        <p className="font-mono text-sm text-red-400">
          Something went wrong. Please try again or email{' '}
          <a href="mailto:jayvalleo@sweetdreams.us" className="text-accent underline">
            jayvalleo@sweetdreams.us
          </a>{' '}
          directly.
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-3"
      >
        <Send className="w-5 h-5" />
        {status === 'sending' ? 'SENDING...' : 'SEND INQUIRY'}
      </button>
    </form>
  );
}
