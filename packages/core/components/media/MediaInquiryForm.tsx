'use client';

// components/media/MediaInquiryForm.tsx
//
// Inquiry form for range-priced and inquire-only media offerings. POSTs to
// /api/media/inquiry which writes a media_bookings row (status='inquiry')
// and emails Jay + Cole. On success we render an inline thank-you panel
// rather than redirecting — keeps the URL intact so the user can copy the
// page link to a bandmate / producer if they want to revisit.
//
// Why inline the band picker instead of forcing a separate flow: most
// inquirers are solo (no band) or in exactly one band. The picker only
// appears when there's an actual choice (>= 2 bands). Same conservative
// UX rule as the checkout API.

import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';

interface CandidateBand {
  id: string;
  name: string;
}

export default function MediaInquiryForm({
  slug,
  offeringTitle,
  defaultName,
  defaultEmail,
  defaultPhone,
  candidateBands,
}: {
  slug: string;
  offeringTitle: string;
  defaultName: string;
  defaultEmail: string;
  /** Pre-fill from profile.phone if present so returning buyers don't
   *  re-enter. The team CALLS these inquiries — phone is the highest-
   *  value field on the form. */
  defaultPhone?: string | null;
  candidateBands: CandidateBand[];
}) {
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone ?? '');
  const [bandId, setBandId] = useState<string>(
    candidateBands.length === 1 ? candidateBands[0]!.id : '',
  );
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Permissive phone check — admin will dial it manually so we just
  // need enough digits to look real. Same rule as the cart sidebar.
  const phoneClean = phone.replace(/\D/g, '');
  const phoneOk = phoneClean.length >= 7;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!phoneOk) {
      setError('Phone number required so we can call to plan.');
      return;
    }
    if (message.trim().length < 10) {
      setError('Tell us a bit more about your project — at least a sentence or two.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/media/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          name: name.trim(),
          phone: phone.trim(),
          message: message.trim(),
          band_id: bandId || null,
        }),
      });
      if (res.status === 401) {
        window.location.href = `/login?redirect=/dashboard/media/${slug}/inquire`;
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went sideways. Try again or reach us directly.');
        setSubmitting(false);
        return;
      }
      setSuccess(true);
      setSubmitting(false);
    } catch (err) {
      console.error('[media-inquiry] submit error:', err);
      setError('Network error — try again.');
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="border-2 border-accent bg-accent/10 p-8">
        <div className="flex items-center gap-2 mb-3">
          <Check className="w-5 h-5 text-accent" />
          <h2 className="font-bold text-xl">Inquiry sent</h2>
        </div>
        <p className="text-sm mb-2">
          Jay + Cole got your note about <strong>{offeringTitle}</strong>. Expect a reply
          within 1 business day with next steps and a tailored quote.
        </p>
        <p className="font-mono text-xs text-black/60">
          Inquiry recorded under your account — you&apos;ll see it in the dashboard once it
          moves into production.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="block font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-1.5">
          Your name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          className="w-full bg-white border-2 border-black/15 px-4 py-3 text-base focus:border-black outline-none"
        />
      </div>

      <div>
        <label className="block font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-1.5">
          Reply email
        </label>
        <input
          type="email"
          value={defaultEmail}
          disabled
          className="w-full bg-black/5 border-2 border-black/10 px-4 py-3 text-base text-black/60"
        />
        <p className="font-mono text-[11px] text-black/40 mt-1.5">
          We reply to your account email. Update it in settings if you want a different inbox.
        </p>
      </div>

      <div>
        <label className="block font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-1.5">
          Phone number *
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          placeholder="(260) 555-0123"
          className={`w-full bg-white border-2 px-4 py-3 text-base focus:border-black outline-none ${
            phoneOk ? 'border-black/15' : 'border-yellow-400'
          }`}
        />
        <p className="font-mono text-[11px] text-black/40 mt-1.5">
          We&apos;ll call you to plan dates, scope, and final pricing. Saved to your
          profile so you only enter it once.
        </p>
      </div>

      {candidateBands.length >= 2 && (
        <div>
          <label className="block font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-1.5">
            Attribute to band (optional)
          </label>
          <select
            value={bandId}
            onChange={(e) => setBandId(e.target.value)}
            className="w-full bg-white border-2 border-black/15 px-4 py-3 text-base focus:border-black outline-none"
          >
            <option value="">— Personal inquiry —</option>
            {candidateBands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-1.5">
          Project details
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          minLength={10}
          rows={6}
          placeholder="A few sentences about your project — songs, sound, scope, target release window, anything we should know up front."
          className="w-full bg-white border-2 border-black/15 px-4 py-3 text-base focus:border-black outline-none resize-y"
        />
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 font-mono text-xs">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-6 py-4 hover:bg-accent hover:text-black transition-colors inline-flex items-center gap-2 disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Send inquiry'}
        {!submitting && <ArrowRight className="w-3 h-3" />}
      </button>
    </form>
  );
}
