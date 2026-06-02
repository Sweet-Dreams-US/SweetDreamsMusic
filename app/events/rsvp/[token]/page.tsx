import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle, Calendar, Clock, MapPin, PartyPopper, Ban } from 'lucide-react';
import { getRsvpByToken } from '@/lib/events-server';
import EventTokenActions from '@/components/events/EventTokenActions';
import { fmtStampDate, fmtStampTime } from '@/lib/studio-time';

export const metadata: Metadata = { title: 'Event Invitation' };

export const dynamic = 'force-dynamic';

/**
 * Token-based RSVP accept page.
 *
 * Unlike /bands/accept, we don't require the viewer to sign in. The token
 * IS the authentication (32 bytes, base64url — same as band invites). Once
 * it's used, the POST handler clears it and it can't be reused. No risk of
 * someone guessing another person's link.
 *
 * Four states:
 *   1. Token not found → show friendly "link invalid"
 *   2. Token found but event missing (shouldn't happen unless the event was
 *      hard-deleted) → "event no longer available"
 *   3. Event cancelled → "event was cancelled"
 *   4. RSVP status !== 'invited' → "invite already used" (token should already
 *      be cleared in this case, but belt & suspenders)
 *   5. Valid — render event details + response buttons
 */
export default async function EventTokenAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const rsvp = await getRsvpByToken(token);

  // Case 1 — bad token.
  if (!rsvp) {
    return (
      <InviteShell>
        <AlertCircle className="w-10 h-10 text-black/40 mx-auto mb-4" />
        <p className="font-mono text-body-md font-bold mb-2">INVITATION NOT FOUND</p>
        <p className="font-mono text-sm text-black/60 max-w-md mx-auto">
          This invitation link is invalid or has already been used. Ask whoever sent it to resend.
        </p>
      </InviteShell>
    );
  }

  const event = rsvp.event;

  // Case 2 — event missing or cancelled.
  if (!event) {
    return (
      <InviteShell>
        <AlertCircle className="w-10 h-10 text-black/40 mx-auto mb-4" />
        <p className="font-mono text-body-md font-bold mb-2">EVENT NO LONGER AVAILABLE</p>
        <p className="font-mono text-sm text-black/60 max-w-md mx-auto">
          The event this invitation points to has been removed.
        </p>
      </InviteShell>
    );
  }

  if (event.is_cancelled) {
    return (
      <InviteShell eventTitle={event.title}>
        <Ban className="w-10 h-10 text-red-500 mx-auto mb-4" />
        <p className="font-mono text-body-md font-bold mb-2">EVENT CANCELLED</p>
        <p className="font-mono text-sm text-black/60 max-w-md mx-auto mb-3">
          Unfortunately, <strong>{event.title}</strong> has been cancelled.
        </p>
        {event.cancellation_reason && (
          <p className="font-mono text-xs text-black/50 italic">{event.cancellation_reason}</p>
        )}
      </InviteShell>
    );
  }

  // Case 4 — invite already used. If the admin cleared the token on
  // `PATCH /admin/events/.../rsvps/...` we'd hit Case 1 instead — this path
  // is only for edge cases where state diverged.
  if (rsvp.status !== 'invited') {
    return (
      <InviteShell eventTitle={event.title}>
        <Clock className="w-10 h-10 text-black/40 mx-auto mb-4" />
        <p className="font-mono text-body-md font-bold mb-2">ALREADY RESPONDED</p>
        <p className="font-mono text-sm text-black/60 max-w-md mx-auto mb-6">
          You&apos;ve already responded to this invitation (status:{' '}
          <strong>{rsvp.status.replace('_', ' ')}</strong>).
        </p>
        <Link
          href={`/events/${event.slug}`}
          className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2"
        >
          View event page
        </Link>
      </InviteShell>
    );
  }

  // Case 5 — valid, show details + actions.
  const dateStr = fmtStampDate(event.starts_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = fmtStampTime(event.starts_at, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  return (
    <InviteShell eventTitle={event.title}>
      <PartyPopper className="w-10 h-10 text-accent mx-auto mb-4" />
      <p className="font-mono text-xs text-black/60 mb-1">YOU&apos;VE BEEN INVITED TO</p>
      <p className="font-mono text-heading-md mb-4">{event.title}</p>
      {event.tagline && (
        <p className="font-mono text-sm text-black/60 italic max-w-md mx-auto mb-6">{event.tagline}</p>
      )}

      {/* Event meta */}
      <div className="inline-block text-left border-2 border-black/10 p-4 mb-6 space-y-2">
        <div className="flex items-center gap-2 font-mono text-sm text-black/80">
          <Calendar className="w-4 h-4 text-accent shrink-0" />
          <span>{dateStr}</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-sm text-black/80">
          <Clock className="w-4 h-4 text-accent shrink-0" />
          <span>{timeStr}</span>
        </div>
        {event.location && (
          <div className="flex items-center gap-2 font-mono text-sm text-black/80">
            <MapPin className="w-4 h-4 text-accent shrink-0" />
            <span>{event.location}</span>
          </div>
        )}
      </div>

      {event.description && (
        <p className="font-mono text-sm text-black/70 max-w-md mx-auto mb-8 whitespace-pre-line text-left leading-relaxed">
          {event.description}
        </p>
      )}

      {/* Action buttons — client component owns the POST + success state */}
      <EventTokenActions token={token} eventSlug={event.slug} />
    </InviteShell>
  );
}

function InviteShell({
  children,
  eventTitle,
}: {
  children: React.ReactNode;
  eventTitle?: string;
}) {
  return (
    <>
      <section className="bg-black text-white py-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase">
            {eventTitle ? 'Event Invitation' : 'Invitation'}
          </p>
        </div>
      </section>
      <section className="bg-white text-black py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">{children}</div>
      </section>
    </>
  );
}
