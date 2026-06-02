import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Calendar, Mail, ArrowRight, MapPin, Clock, Lock, PartyPopper } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { getEventsForUser, getPendingEventInvitesForEmail } from '@/lib/events-server';
import DashboardNav from '@/components/layout/DashboardNav';
import { rsvpStatusLabel } from '@/lib/events';
import { fmtStampDate, fmtStampTime } from '@/lib/studio-time';
import type { EventRsvpStatus } from '@/lib/events';

export const metadata: Metadata = { title: 'Events' };

/**
 * User's events hub. Parallels /dashboard/bands:
 *   1. Email-addressed pending invites that haven't been responded to yet
 *      (rendered as yellow action cards linking to the token-accept flow)
 *   2. All RSVP rows where user_id = this user, excluding 'not_going'
 *      (rendered as split Upcoming / Past cards)
 *
 * Declined events are intentionally hidden so the list doesn't accumulate
 * noise. Users who want to un-decline can visit the event detail page and
 * change their response there.
 */
export default async function DashboardEventsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const [myEvents, pendingInvites] = await Promise.all([
    getEventsForUser(user.id),
    getPendingEventInvitesForEmail(user.email),
  ]);

  // Filter out invites already present as user-linked RSVPs — avoids showing
  // the same invitation twice when a user's email invite was auto-linked on
  // signup.
  const myEventIds = new Set(myEvents.map((r) => r.event.id));
  const dedupedInvites = pendingInvites.filter((i) => !myEventIds.has(i.event.id));

  // Split by past vs. upcoming.
  const now = Date.now();
  const upcoming = myEvents.filter((r) => new Date(r.event.starts_at).getTime() >= now);
  const past = myEvents.filter((r) => new Date(r.event.starts_at).getTime() < now);

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />

      {/* Header */}
      <section className="bg-white text-black py-8 border-b-2 border-black/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-heading-xl flex items-center gap-3">
              <PartyPopper className="w-7 h-7 text-accent" />
              YOUR EVENTS
            </h1>
            <p className="font-mono text-sm text-black/60 mt-2">
              Showcases, sessions, and studio events you&apos;re invited to or attending.
            </p>
          </div>
          <Link
            href="/events"
            className="border-2 border-black text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-black hover:text-white transition-colors no-underline inline-flex items-center gap-2 flex-shrink-0"
          >
            Browse Events
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          {/* Pending invites */}
          {dedupedInvites.length > 0 && (
            <div>
              <h2 className="text-heading-md mb-4 flex items-center gap-3">
                <Mail className="w-6 h-6 text-accent" />
                PENDING INVITES
              </h2>
              <div className="space-y-3">
                {dedupedInvites.map((inv) => {
                  return (
                    <div
                      key={inv.id}
                      className="bg-yellow-300 border-2 border-black p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-14 h-14 flex-shrink-0 bg-black text-yellow-300 flex items-center justify-center border-2 border-black">
                          <PartyPopper className="w-6 h-6" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-mono text-xs uppercase tracking-wider text-black/70">
                            Invited to
                          </p>
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
                  );
                })}
              </div>
            </div>
          )}

          {/* Upcoming */}
          <div>
            <h2 className="text-heading-md mb-4 flex items-center gap-3">
              <Calendar className="w-6 h-6 text-accent" />
              UPCOMING
            </h2>
            {upcoming.length === 0 ? (
              <EmptyState
                message="No upcoming events on your calendar."
                cta={{ href: '/events', label: 'Browse Events' }}
              />
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
              <h2 className="text-heading-md mb-4 flex items-center gap-3">
                <Clock className="w-6 h-6 text-black/40" />
                PAST
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 opacity-70">
                {past.map((r) => (
                  <EventCard key={r.rsvp.id} event={r.event} status={r.rsvp.status} />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

// ─── Small subcomponents (server-safe, no state) ─────────────────────

function EmptyState({
  message,
  cta,
}: {
  message: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="border-2 border-black/10 p-12 text-center">
      <Calendar className="w-12 h-12 text-black/30 mx-auto mb-4" strokeWidth={1.5} />
      <p className="font-mono text-sm text-black/60 max-w-md mx-auto mb-6">{message}</p>
      {cta && (
        <Link
          href={cta.href}
          className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2"
        >
          {cta.label} <ArrowRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}

function EventCard({
  event,
  status,
}: {
  event: {
    id: string;
    slug: string;
    title: string;
    tagline: string | null;
    starts_at: string;
    location: string | null;
    cover_image_url: string | null;
    is_cancelled: boolean;
    visibility: 'public' | 'private_listed' | 'private_hidden';
  };
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
          <img
            src={event.cover_image_url}
            alt={event.title}
            className="w-full h-full object-cover"
          />
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
        {event.tagline && (
          <p className="font-mono text-xs text-black/60 mt-1 line-clamp-2">{event.tagline}</p>
        )}
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
