'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, HelpCircle, X, Loader2, AlertCircle } from 'lucide-react';

type Status = 'going' | 'maybe' | 'not_going';

/**
 * Three-button response widget for the token-accept page.
 *
 * POSTs to /api/events/rsvp/[token] which clears the token server-side on
 * success, so subsequent refreshes of this page fall into the "already used"
 * state naturally. No need to handle the idempotency here.
 */
export default function EventTokenActions({
  token,
  eventSlug,
}: {
  token: string;
  eventSlug: string;
}) {
  const [submitting, setSubmitting] = useState<Status | null>(null);
  const [submitted, setSubmitted] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(status: Status) {
    setSubmitting(status);
    setError(null);
    try {
      const res = await fetch(`/api/events/rsvp/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to record your response.');
      } else {
        setSubmitted(status);
      }
    } catch {
      setError('Network error — please try again.');
    }
    setSubmitting(null);
  }

  // Success screen — same styling regardless of which status they picked,
  // message adapted.
  if (submitted) {
    const msg: Record<Status, { title: string; body: string }> = {
      going: {
        title: "YOU'RE IN",
        body: "We've got you down as going. Look for confirmation and reminders by email.",
      },
      maybe: {
        title: 'RESPONSE SAVED',
        body: "We've marked you as maybe. You can firm up your response anytime from the event page.",
      },
      not_going: {
        title: 'THANKS FOR LETTING US KNOW',
        body: "We've recorded that you can't make it. Hope to see you at another one.",
      },
    };
    const m = msg[submitted];
    return (
      <div className="max-w-md mx-auto">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-accent text-black mx-auto mb-4">
          <Check className="w-6 h-6" strokeWidth={2.5} />
        </div>
        <p className="font-mono text-body-md font-bold mb-2">{m.title}</p>
        <p className="font-mono text-sm text-black/60 mb-6">{m.body}</p>
        <Link
          href={`/events/${eventSlug}`}
          className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2"
        >
          View event page
        </Link>
      </div>
    );
  }

  const buttons: { key: Status; label: string; icon: typeof Check; variant: 'primary' | 'neutral' | 'ghost' }[] = [
    { key: 'going', label: 'Going', icon: Check, variant: 'primary' },
    { key: 'maybe', label: 'Maybe', icon: HelpCircle, variant: 'neutral' },
    { key: 'not_going', label: "Can't Make It", icon: X, variant: 'ghost' },
  ];

  return (
    <div className="max-w-md mx-auto">
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        {buttons.map((b) => {
          const Icon = b.icon;
          const isSubmittingThis = submitting === b.key;
          const variantClass =
            b.variant === 'primary'
              ? 'bg-accent text-black hover:bg-accent/90'
              : b.variant === 'neutral'
                ? 'bg-black text-white hover:bg-black/90'
                : 'border-2 border-black/20 text-black/70 hover:border-black hover:bg-black hover:text-white';
          return (
            <button
              key={b.key}
              onClick={() => respond(b.key)}
              disabled={submitting !== null}
              className={`font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${variantClass}`}
            >
              {isSubmittingThis ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Icon className="w-4 h-4" />
              )}
              {b.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mt-6 inline-flex items-center gap-2 border-l-2 border-red-400 bg-red-50 px-3 py-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <p className="font-mono text-xs text-red-900">{error}</p>
        </div>
      )}
    </div>
  );
}
