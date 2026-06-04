'use client';

// Artist Hub → Events tab. Relocated from the standalone /dashboard/events
// page (which still exists as a deep route). Presentational only — data is
// fetched server-side in app/dashboard/hub/page.tsx. RSVP / respond actions
// link out to the public /events routes (untouched).

import Link from 'next/link';
import { Calendar, Mail, ArrowRight, MapPin, Clock, Lock, PartyPopper } from 'lucide-react';
import { rsvpStatusLabel } from '@/lib/events';
import { fmtStampDate, fmtStampTime } from '@/lib/studio-time';
import type { EventRsvpStatus, EventRsvp, SweetEvent, EventWithRsvp } from '@/lib/events';

type PendingEventInvite = EventRsvp & { event: SweetEvent };

export default function HubEvents({
  myEvents,
  pendingInvites,
}: {
  myEvents: EventWithRsvp[];
  pendingInvites: PendingEventInvite[];
}) {
  const myEventIds = new Set(myEvents.map((r) => r.event.id));
  const dedupedInvites = pendingInvites.filter((i) => !myEventIds.has(i.event.id));

  const now = Date.now();
  const upcoming = myEvents.filter((r) => new Date(r.event.starts_at).getTime() >= now);
  const past = myEvents.filter((r) => new Date(r.event.starts_at).getTime() < now);

  return (
    <div className="space-y-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-heading-md flex items-center gap-3">
            <PartyPopper className="w-6 h-6 text-accent" />
            YOUR EVENTS
          </h2>
          <p className="font-mono text-sm text-black/60 mt-1">
            Showcases, sessions, and studio events you&apos;re invited to or attending.
          </p>
        </div>
        <Link
          href="/events"
          className="border-2 border-black text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-black hover:text-white transition-colors no-underline inline-flex items-center gap-2 flex-shrink-0"
        >
          Browse Events <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Pending invites */}
      {dedupedInvites.length > 0 && (
        <div>
          <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
            <Mail className="w-4 h-4 text-accent" /> Pending Invites
          </h3>
          <div className="space-y-3">
            {dedupedInvites.map((inv) => (
              <div
                key={inv.id}
                className="bg-yellow-300 border-2 border-black p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-14 h-14 flex-shrink-0 bg-black text-yellow-300 flex items-center justify-center border-2 border-black">
                    <PartyPopper className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-xs uppercase tracking-wider text-black/70">Invited to</p>
                    <p className="font-mono text-lg font-bold truncate">{inv.event.title}</p>
                    <p className="font-mono text-xs text-black/70 mt-0.5">
                      {fmtStampDate(inv.event.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })}
                      {' at '}
                      {fmtStampTime(inv.event.starts_at)}
                      {inv.event.location && ` · ${inv.event.location}`}
                    </p>
                  </div>
                </div>
                {inv.token && (
                  <Link
                    href={`/events/rsvp/${inv.token}`}
                    className="bg-black text-yellow-300 font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-black/80 transition-colors no-underline inline-flex items-center gap-2 flex-shrink-0"
                  >
                    Respond <ArrowRight className="w-4 h-4" />
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming */}
      <div>
        <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-accent" /> Upcoming
        </h3>
        {upcoming.length === 0 ? (
          <div className="border-2 border-black/10 p-12 text-center">
            <Calendar className="w-12 h-12 text-black/30 mx-auto mb-4" strokeWidth={1.5} />
            <p className="font-mono text-sm text-black/60 max-w-md mx-auto mb-6">
              No upcoming events on your calendar.
            </p>
            <Link
              href="/events"
              className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2"
            >
              Browse Events <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {upcoming.map((r) => (
              <EventCard key={r.rsvp.id} event={r.event} status={r.rsvp.status} />
            ))}
          </div>
        )}
      </div>

      {/* Past */}
      {past.length > 0 && (
        <div>
          <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-black/40" /> Past
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 opacity-70">
            {past.map((r) => (
              <EventCard key={r.rsvp.id} event={r.event} status={r.rsvp.status} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EventCard({
  event,
  status,
}: {
  event: SweetEvent;
  status: EventRsvpStatus;
}) {
  const statusColor: Record<EventRsvpStatus, string> = {
    going: 'bg-green-100 text-green-800',
    maybe: 'bg-amber-100 text-amber-800',
    not_going: 'bg-black/5 text-black/60',
    requested: 'bg-blue-100 text-blue-800',
    invited: 'bg-accent text-black',
  };
  return (
    <Link
      href={`/events/${event.slug}`}
      className="no-underline text-black border-2 border-black/10 hover:border-accent transition-colors group flex flex-col"
    >
      <div className="relative aspect-[16/10] bg-black/5 overflow-hidden">
        {event.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.cover_image_url} alt={event.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent/20 to-black/20">
            <Calendar className="w-14 h-14 text-black/30" strokeWidth={1.25} />
          </div>
        )}
        <span
          className={`absolute top-3 left-3 font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 ${statusColor[status]}`}
        >
          {rsvpStatusLabel(status)}
        </span>
        {event.is_cancelled && (
          <span className="absolute top-3 right-3 font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-red-600 text-white">
            Cancelled
          </span>
        )}
        {!event.is_cancelled && event.visibility !== 'public' && (
          <span className="absolute top-3 right-3 font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-black/70 text-white inline-flex items-center gap-1">
            <Lock className="w-3 h-3" />
            Private
          </span>
        )}
      </div>
      <div className="p-5 flex-1 flex flex-col">
        <h3 className="font-mono text-lg font-bold truncate group-hover:text-accent transition-colors">
          {event.title}
        </h3>
        {event.tagline && <p className="font-mono text-xs text-black/60 mt-1 line-clamp-2">{event.tagline}</p>}
        <div className="mt-auto pt-4 border-t border-black/5 space-y-1">
          <div className="flex items-center gap-2 font-mono text-xs text-black/70">
            <Calendar className="w-3 h-3 text-accent shrink-0" />
            <span>
              {fmtStampDate(event.starts_at, { month: 'short', day: 'numeric', year: 'numeric' })}
              {' · '}
              {fmtStampTime(event.starts_at)}
            </span>
          </div>
          {event.location && (
            <div className="flex items-center gap-2 font-mono text-xs text-black/70">
              <MapPin className="w-3 h-3 text-accent shrink-0" />
              <span className="truncate">{event.location}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
