import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Calendar, Clock, MapPin, Users, Lock, Ban, AlertCircle } from 'lucide-react';
import { SITE_URL } from '@/lib/constants';
import { getEventBySlug, getConfirmedAttendeeCount, getUserRsvp } from '@/lib/events-server';
import { getSessionUser } from '@/lib/auth';
import EventRsvpBlock from '@/components/events/EventRsvpBlock';
import { fmtStampDate, fmtStampTime } from '@/lib/studio-time';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);

  // Don't leak the existence of hidden or cancelled events via meta tags.
  if (!event || event.visibility === 'private_hidden' || event.is_cancelled) {
    return { title: 'Event — Sweet Dreams Music' };
  }

  return {
    title: `${event.title} — Sweet Dreams Music`,
    description: event.tagline || event.description || undefined,
    alternates: { canonical: `${SITE_URL}/events/${event.slug}` },
    openGraph: {
      title: event.title,
      description: event.tagline || event.description || undefined,
      url: `${SITE_URL}/events/${event.slug}`,
      images: event.cover_image_url ? [{ url: event.cover_image_url }] : undefined,
      type: 'website',
    },
  };
}

export const dynamic = 'force-dynamic';

/**
 * Event detail page.
 *
 * Visibility enforcement:
 *   - public         → anyone can view + RSVP directly
 *   - private_listed → anyone can view + request-to-attend (requires auth)
 *   - private_hidden → 404 unless viewer has an existing RSVP row
 *
 * The last rule matters because once an email-invited user signs up and their
 * `event_rsvps.user_id` is linked, they need to be able to find the event
 * again from their dashboard even though it's hidden from public browsing.
 */
export default async function EventDetailPage({ params }: Props) {
  const { slug } = await params;

  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const user = await getSessionUser();
  const existingRsvp = user ? await getUserRsvp(event.id, user.id) : null;

  if (event.visibility === 'private_hidden') {
    // Hidden events don't leak their existence. Only expose if the viewer
    // has an RSVP row on it (meaning they were invited/requested earlier).
    if (!existingRsvp) notFound();
  }

  const attendeeCount = await getConfirmedAttendeeCount(event.id);
  const capacityFull = event.capacity != null && attendeeCount >= event.capacity;

  const dateStr = fmtStampDate(event.starts_at, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = fmtStampTime(event.starts_at, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const endTimeStr = event.ends_at
    ? fmtStampTime(event.ends_at)
    : null;

  return (
    <>
      {/* Hero with cover */}
      <section className="relative bg-black text-white overflow-hidden">
        {event.cover_image_url ? (
          // External URLs may not be in next.config.js remotePatterns — use a
          // plain img tag. Trade some optimization for simplicity + universal
          // URL support.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.cover_image_url}
            alt={event.title}
            className="absolute inset-0 w-full h-full object-cover opacity-40"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/50 to-black/90" />
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="flex flex-wrap gap-2 mb-4">
            <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase">
              Event
            </p>
            {event.visibility === 'private_listed' && (
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-white/10 text-white inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> Request to Attend
              </span>
            )}
            {event.visibility === 'private_hidden' && (
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-white/10 text-white inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> Invite Only
              </span>
            )}
            {event.is_cancelled && (
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-red-600/80 text-white inline-flex items-center gap-1">
                <Ban className="w-3 h-3" /> Cancelled
              </span>
            )}
          </div>

          <h1 className="text-display-md mb-4">{event.title}</h1>
          {event.tagline && (
            <p className="font-mono text-white/80 text-body-md max-w-2xl italic">
              {event.tagline}
            </p>
          )}

          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 font-mono text-sm text-white/80">
            <div className="inline-flex items-center gap-2">
              <Calendar className="w-4 h-4 text-accent" />
              <span>{dateStr}</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <Clock className="w-4 h-4 text-accent" />
              <span>
                {timeStr}
                {endTimeStr && ` – ${endTimeStr}`}
              </span>
            </div>
            {event.location && (
              <div className="inline-flex items-center gap-2">
                <MapPin className="w-4 h-4 text-accent" />
                <span>{event.location}</span>
              </div>
            )}
            {event.capacity != null && (
              <div className="inline-flex items-center gap-2">
                <Users className="w-4 h-4 text-accent" />
                <span>
                  {attendeeCount} / {event.capacity} going
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Cancellation notice */}
      {event.is_cancelled && (
        <section className="bg-red-50 border-b-2 border-red-200 text-red-900">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-mono text-sm font-bold uppercase tracking-wider mb-1">
                  This event has been cancelled
                </p>
                {event.cancellation_reason && (
                  <p className="font-mono text-sm text-red-800/80">{event.cancellation_reason}</p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Full flyer — uncropped, natural aspect, centered. The dark hero above
          uses the same image cropped as a backdrop for atmosphere; this is the
          one the visitor actually reads. */}
      {event.cover_image_url && (
        <section className="bg-white py-10 sm:py-14">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={event.cover_image_url}
              alt={`${event.title} flyer`}
              className="block w-full h-auto mx-auto border border-black/10"
            />
          </div>
        </section>
      )}

      {/* Description + RSVP */}
      <section className="bg-white text-black py-16 sm:py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="lg:col-span-2">
            {event.description ? (
              <>
                <p className="font-mono text-xs font-semibold tracking-[0.3em] uppercase mb-3 text-black/50">
                  About
                </p>
                <p className="font-mono text-body-md text-black/80 whitespace-pre-line leading-relaxed">
                  {event.description}
                </p>
              </>
            ) : (
              <p className="font-mono text-sm text-black/50 italic">No additional details.</p>
            )}
          </div>

          <div className="lg:col-span-1">
            <EventRsvpBlock
              event={{
                id: event.id,
                slug: event.slug,
                title: event.title,
                visibility: event.visibility,
                is_cancelled: event.is_cancelled,
              }}
              initialRsvp={existingRsvp}
              isAuthenticated={!!user}
              capacityFull={capacityFull}
            />
          </div>
        </div>
      </section>

      {/* Back link */}
      <section className="bg-white text-black pb-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/events"
            className="font-mono text-xs font-bold uppercase tracking-wider text-black/60 hover:text-black no-underline inline-flex items-center gap-2"
          >
            ← All events
          </Link>
        </div>
      </section>
    </>
  );
}
