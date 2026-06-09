'use client';

import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { Send } from 'lucide-react';

// Site key is env-overridable so a wrong/rotated key can be fixed without a code
// change. Falls back to the previously-hardcoded value.
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '0x4AAAAAAC-NKDZ6-U5VzVto';

export default function ContactForm() {
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
        theme: 'light',
      });
    }
  }, []);

  useEffect(() => {
    // Load Turnstile script
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
    // Submit even if Turnstile hasn't issued a token (widget may be broken/blocked).
    // The server verifies the token when present + configured, but never hard-blocks.
    setStatus('sending');

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      message: formData.get('message'),
      turnstileToken,
    };

    try {
      const res = await fetch('/api/contact', {
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
      <div className="border-2 border-black p-8 sm:p-12 text-center">
        <h3 className="text-heading-lg mb-4">MESSAGE SENT</h3>
        <p className="font-mono text-black/60 text-body-sm">
          Thanks for reaching out. We&apos;ll get back to you soon.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="name" className="block font-mono text-sm font-semibold uppercase tracking-wider mb-2">
          Name *
        </label>
        <input
          type="text"
          id="name"
          name="name"
          required
          className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none transition-colors"
          placeholder="Your name"
        />
      </div>

      <div>
        <label htmlFor="email" className="block font-mono text-sm font-semibold uppercase tracking-wider mb-2">
          Email *
        </label>
        <input
          type="email"
          id="email"
          name="email"
          required
          className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none transition-colors"
          placeholder="your@email.com"
        />
      </div>

      <div>
        <label htmlFor="phone" className="block font-mono text-sm font-semibold uppercase tracking-wider mb-2">
          Phone
        </label>
        <input
          type="tel"
          id="phone"
          name="phone"
          className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none transition-colors"
          placeholder="(555) 123-4567"
        />
      </div>

      <div>
        <label htmlFor="message" className="block font-mono text-sm font-semibold uppercase tracking-wider mb-2">
          Message *
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={5}
          className="w-full border-2 border-black px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none transition-colors resize-vertical"
          placeholder="Tell us about your project..."
        />
      </div>

      {/* Cloudflare Turnstile verification */}
      <div ref={turnstileRef} className="flex justify-center" />

      {status === 'error' && (
        <p className="font-mono text-sm text-red-600">
          Something went wrong. Please try again or email us directly.
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full bg-black text-white font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-3"
      >
        <Send className="w-5 h-5" />
        {status === 'sending' ? 'SENDING...' : 'SEND MESSAGE'}
      </button>
    </form>
  );
}
