'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Clock, X, HelpCircle, Ban, LogIn, AlertCircle, Loader2 } from 'lucide-react';
import type { EventRsvp, EventVisibility, EventRsvpStatus } from '@/lib/events';

/**
 * The slice of event data this component needs to render decisions.
 * We intentionally DON'T take the full SweetEvent — this component runs
 * client-side so only sending the minimum keeps payload small and makes
 * prop-shape changes obvious.
 */
type EventShape = {
  id: string;
  slug: string;
  title: string;
  visibility: EventVisibility;
  is_cancelled: boolean;
};

type Props = {
  event: EventShape;
  initialRsvp: EventRsvp | null;
  isAuthenticated: boolean;
  capacityFull: boolean;
};

export default function EventRsvpBlock({
  event,
  initialRsvp,
  isAuthenticated,
  capacityFull,
}: Props) {
  const [rsvp, setRsvp] = useState<EventRsvp | null>(initialRsvp);
  const [message, setMessage] = useState('');
  const [guestCount, setGuestCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Cancelled ─────────────────────────────────────────────────────
  if (event.is_cancelled) {
    return (
      <div className="border-2 border-red-200 bg-red-50 p-6 rounded">
        <div className="flex items-start gap-3">
          <Ban className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-mono text-sm font-bold text-red-900 uppercase tracking-wider">
              Event Cancelled
            </p>
            <p className="font-mono text-xs text-red-800/70 mt-1">
              RSVPs are disabled for cancelled events.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Not authenticated ─────────────────────────────────────────────
  if (!isAuthenticated) {
    const nextUrl = encodeURIComponent(`/events/${event.slug}`);
    return (
      <div className="border-2 border-black/10 p-6">
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-black/50 mb-3">
          RSVP
        </p>
        <p className="font-mono text-sm text-black/70 mb-4">
          Sign in to {event.visibility === 'public' ? 'RSVP for' : 'request to attend'} this event.
        </p>
        <Link
          href={`/login?redirect=${nextUrl}`}
          className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-4 py-3 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2 w-full justify-center"
        >
          <LogIn className="w-4 h-4" />
          Sign in to RSVP
        </Link>
      </div>
    );
  }

  // ─── Helper — submit RSVP change ───────────────────────────────────
  async function submitRsvp(
    status: EventRsvpStatus,
    opts: { message?: string; guestCount?: number } = {},
  ) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${event.slug}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          message: opts.message,
          guestCount: opts.guestCount ?? 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update RSVP');
      } else {
        // Optimistic-ish local update — we know the server accepted, so
        // reflect the new status. An actual refetch would round-trip; this
        // avoids it since the fields we derive from `rsvp` are all captured.
        setRsvp({
          id: rsvp?.id || 'local',
          event_id: event.id,
          user_id: null,
          invited_email: null,
          invited_by: null,
          status,
          token: null,
          message: opts.message || null,
          guest_count: opts.guestCount ?? 0,
          created_at: rsvp?.created_at || new Date().toISOString(),
          responded_at: new Date().toISOString(),
        });
        setMessage('');
      }
    } catch {
      setError('Network error — please try again');
    }
    setSubmitting(false);
  }

  // ─── Already has a decision ────────────────────────────────────────
  // Shows current state + lets them change it (for public events only).
  if (rsvp) {
    return (
      <div className="border-2 border-black/10 p-6">
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-black/50 mb-3">
          Your RSVP
        </p>
        <StatusBadge status={rsvp.status} />

        {rsvp.status === 'requested' && (
          <p className="font-mono text-xs text-black/60 mt-3">
            Your request is pending approval. We&apos;ll email you once the host decides.
          </p>
        )}

        {rsvp.status === 'invited' && (
          <p className="font-mono text-xs text-black/60 mt-3">
            You&apos;ve been invited. Choose a response below.
          </p>
        )}

        {/* Public events allow users to change status freely. Private events
            require admin approval to change an already-decided state. */}
        {event.visibility === 'public' && (
          <div className="mt-4 space-y-2">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-black/50">
              Change response
            </p>
            <ResponseButtons
              current={rsvp.status}
              capacityFull={capacityFull}
              submitting={submitting}
              onSelect={(s) => submitRsvp(s)}
            />
          </div>
        )}

        {/* Token-invited users can respond even on private events */}
        {rsvp.status === 'invited' && event.visibility !== 'public' && (
          <div className="mt-4 space-y-2">
            <ResponseButtons
              current={rsvp.status}
              capacityFull={capacityFull}
              submitting={submitting}
              onSelect={(s) => submitRsvp(s)}
            />
          </div>
        )}

        {error && <ErrorNote message={error} />}
      </div>
    );
  }

  // ─── No RSVP yet — public event (direct RSVP) ──────────────────────
  if (event.visibility === 'public') {
    return (
      <div className="border-2 border-black/10 p-6">
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-black/50 mb-3">
          Can you make it?
        </p>
        {capacityFull && (
          <div className="border-l-2 border-amber-400 bg-amber-50 px-3 py-2 mb-4">
            <p className="font-mono text-xs text-amber-900">
              Event is at capacity — you can still add yourself as &ldquo;Maybe.&rdquo;
            </p>
          </div>
        )}
        <ResponseButtons
          current={null}
          capacityFull={capacityFull}
          submitting={submitting}
          onSelect={(s) => submitRsvp(s)}
        />
        {error && <ErrorNote message={error} />}
      </div>
    );
  }

  // ─── No RSVP yet — private_listed (request to attend) ──────────────
  return (
    <div className="border-2 border-black/10 p-6">
      <p className="font-mono text-xs font-bold uppercase tracking-wider text-black/50 mb-3">
        Request to Attend
      </p>
      <p className="font-mono text-xs text-black/60 mb-4">
        This is a private event. Send a short message and the host will approve or deny your request.
      </p>

      <div className="space-y-3">
        <div>
          <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-black/50 block mb-1">
            Why you&apos;d like to attend
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="A few words about why you want to come..."
            className="w-full border-2 border-black/10 focus:border-accent px-3 py-2 font-mono text-xs outline-none resize-y"
            maxLength={500}
          />
          <p className="font-mono text-[9px] text-black/40 mt-1">{message.length}/500</p>
        </div>

        <div>
          <label className="font-mono text-[10px] font-bold uppercase tracking-wider text-black/50 block mb-1">
            Bringing guests?
          </label>
          <input
            type="number"
            min={0}
            max={20}
            value={guestCount}
            onChange={(e) => setGuestCount(Math.max(0, Math.min(20, parseInt(e.target.value || '0', 10))))}
            className="w-24 border-2 border-black/10 focus:border-accent px-3 py-2 font-mono text-xs outline-none"
          />
          <span className="font-mono text-[10px] text-black/50 ml-2">additional people</span>
        </div>

        <button
          onClick={() => {
            if (!message.trim()) {
              setError('Please include a short message.');
              return;
            }
            submitRsvp('requested', { message: message.trim(), guestCount });
          }}
          disabled={submitting || !message.trim()}
          className="w-full bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider py-3 hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {submitting ? 'Sending...' : 'Send Request'}
        </button>

        {error && <ErrorNote message={error} />}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: EventRsvpStatus }) {
  const config: Record<EventRsvpStatus, { label: string; bg: string; icon: typeof Check }> = {
    going: { label: "You're going", bg: 'bg-green-100 text-green-800 border-green-300', icon: Check },
    maybe: { label: 'Maybe', bg: 'bg-amber-100 text-amber-800 border-amber-300', icon: HelpCircle },
    not_going: { label: 'Not going', bg: 'bg-black/5 text-black/60 border-black/10', icon: X },
    requested: { label: 'Request pending', bg: 'bg-blue-100 text-blue-800 border-blue-300', icon: Clock },
    invited: { label: "You're invited", bg: 'bg-accent/10 text-black border-accent', icon: Check },
  };
  const c = config[status];
  const Icon = c.icon;
  return (
    <div className={`border-2 ${c.bg} px-3 py-2 inline-flex items-center gap-2`}>
      <Icon className="w-4 h-4" />
      <span className="font-mono text-xs font-bold uppercase tracking-wider">{c.label}</span>
    </div>
  );
}

function ResponseButtons({
  current,
  capacityFull,
  submitting,
  onSelect,
}: {
  current: EventRsvpStatus | null;
  capacityFull: boolean;
  submitting: boolean;
  onSelect: (status: EventRsvpStatus) => void;
}) {
  // Hiding 'going' when capacity is full keeps capacity honest. If admin
  // wants to override, they can do it from the roster in the admin UI.
  const options: { key: 'going' | 'maybe' | 'not_going'; label: string; disabled?: boolean }[] = [
    { key: 'going', label: 'Going', disabled: capacityFull && current !== 'going' },
    { key: 'maybe', label: 'Maybe' },
    { key: 'not_going', label: 'Not Going' },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((opt) => {
        const isCurrent = current === opt.key;
        return (
          <button
            key={opt.key}
            onClick={() => onSelect(opt.key)}
            disabled={submitting || opt.disabled || isCurrent}
            className={`border-2 font-mono text-xs font-bold uppercase tracking-wider py-2.5 transition-colors ${
              isCurrent
                ? 'border-accent bg-accent text-black'
                : opt.disabled
                  ? 'border-black/5 text-black/30 cursor-not-allowed'
                  : 'border-black/20 text-black/70 hover:border-black hover:bg-black hover:text-white'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="mt-3 border-l-2 border-red-400 bg-red-50 px-3 py-2">
      <p className="font-mono text-xs text-red-900 inline-flex items-center gap-2">
        <AlertCircle className="w-3.5 h-3.5" />
        {message}
      </p>
    </div>
  );
}
