'use client';

import { useState, type FormEvent } from 'react';
import { Send } from 'lucide-react';

// Spam protection is a HONEYPOT (the hidden "company" field below): real people
// never see or fill it, naive bots fill every field. The server silently drops
// any submission where it's set. This replaced a Cloudflare Turnstile widget that
// was never actually configured (no secret in any env + a placeholder site key),
// so it only ever blocked real customers. To add a real CAPTCHA back, wire a valid
// Turnstile site key + TURNSTILE_SECRET_KEY and re-add the widget.

export default function ContactForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('sending');

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      message: formData.get('message'),
      company: formData.get('company'), // honeypot
    };

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to send');
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

      {/* Honeypot — visually hidden + off-screen; humans never fill it, bots do. */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] top-0 h-0 w-0 opacity-0"
      />

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
