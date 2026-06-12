import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Calendar, ArrowRight, MapPin, Clock, Lock } from 'lucide-react';
import { SITE_URL } from '@/lib/constants';
import { STUDIO_IMAGES } from '@/lib/images';
import { getUpcomingListedEvents } from '@/lib/events-server';
import { requireHref } from '@/lib/site-settings-server';
import { allowsDirectRsvp } from '@/lib/events';
import { fmtStampDate, fmtStampTime } from '@/lib/studio-time';
import { getBrand } from '@/lib/brand-server';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: `Events — ${brand.name}`,
    description: `Upcoming events at ${brand.name} — band showcases, The Sweet Spot sessions, open-mic nights, and studio happenings in ${brand.address.city}, Indiana.`,
    alternates: { canonical: `${SITE_URL}/events` },
    openGraph: {
      title: `Events — ${brand.name}`,
      description: `Upcoming events at ${brand.name} in ${brand.address.city}, Indiana.`,
      url: `${SITE_URL}/events`,
      type: 'website',
    },
  };
}

// Render fresh every hit — events are low-volume and timeliness matters.
// If traffic ever warrants it, flip to `revalidate = 60` for ISR.
export const dynamic = 'force-dynamic';

/**
 * Events page — listed events (public + private_listed) ordered by start time.
 *
 * `private_hidden` events are excluded at the query layer; they're reachable
 * only via their direct invitation-link tokens or the admin UI. The CTA on
 * each card changes based on visibility:
 *
 *   public         → "RSVP"
 *   private_listed → "Request to attend"
 */
export default async function EventsPage() {
  await requireHref('/events'); // 404 when Events is disabled in the control panel
  const brand = await getBrand();
  const events = await getUpcomingListedEvents();

  return (
    <>
      {/* Hero */}
      <section className="relative bg-black text-white py-20 sm:py-28 overflow-hidden">
        <Image
          src={STUDIO_IMAGES.adamCloseupWide}
          alt={`${brand.name} studio`}
          fill
          className="object-cover opacity-25"
          priority
          sizes="100vw"
        />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            What&apos;s Happening
          </p>
          <h1 className="text-display-md mb-6">EVENTS</h1>
          <p className="font-mono text-white/70 text-body-md max-w-2xl">
            Showcases, sessions, open nights, and special broadcasts from the {brand.name} floor.
            Keep this page bookmarked — new events post regularly.
          </p>
        </div>
      </section>

      {/* Events list or empty state */}
      {events.length === 0 ? (
        <section className="bg-white text-black py-20 sm:py-28">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Calendar className="w-16 h-16 text-accent mx-auto mb-8" strokeWidth={1.5} />
            <h2 className="text-heading-lg mb-6">NO EVENTS LISTED RIGHT NOW</h2>
            <p className="font-mono text-black/70 text-body-md max-w-2xl mx-auto mb-10">
              We&apos;re booking our first round of <strong className="text-black">The Sweet Spot</strong> band
              showcases — live-tracked performances from the {brand.name} floor. First dates post soon.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/bands"
                className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center gap-2"
              >
                The Sweet Spot <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/contact"
                className="border-2 border-black text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-black hover:text-white transition-colors no-underline inline-flex items-center justify-center"
              >
                Get notified
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-white text-black py-20 sm:py-28">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10 md:space-y-14">
            {events.map((event) => {
              const dateStr = fmtStampDate(event.starts_at, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
              const timeStr = fmtStampTime(event.starts_at);
              const isPublic = allowsDirectRsvp(event);

              return (
                <Link
                  key={event.id}
                  href={`/events/${event.slug}`}
                  className="group no-underline text-black block border-2 border-black/10 hover:border-black transition-colors"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 md:items-stretch">
                    {/* Flyer column. Source-order first so mobile (single-col)
                        always stacks it on top. On md+, private events flip to
                        order-2, putting the flyer on the right.

                        The flex centering + max-h on the <img> preserves the
                        flyer's natural aspect ratio while keeping rows from
                        getting absurdly tall on portrait posters. */}
                    <div
                      className={`relative bg-black/5 flex items-center justify-center overflow-hidden ${
                        isPublic ? '' : 'md:order-2'
                      }`}
                    >
                      {event.cover_image_url ? (
                        // Plain <img> on purpose: flyer aspect ratios aren't
                        // known at build time. next/image needs explicit
                        // width/height, which would force a crop. Natural
                        // aspect = no crop = the whole flyer the admin uploaded.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={event.cover_image_url}
                          alt={event.title}
                          className="block w-full h-auto md:w-auto md:max-w-full md:max-h-[640px]"
                        />
                      ) : (
                        <div className="aspect-[4/5] w-full flex items-center justify-center bg-gradient-to-br from-accent/20 to-black/20">
                          <Calendar className="w-16 h-16 text-black/30" strokeWidth={1.25} />
                        </div>
                      )}
                      {!isPublic && (
                        <span className="absolute top-3 right-3 bg-black text-white font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 inline-flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          Request to Attend
                        </span>
                      )}
                    </div>

                    {/* Info column. md:order-1 on private events keeps it on
                        the left of the desktop grid. Mobile keeps source order
                        (flyer first) regardless. */}
                    <div
                      className={`p-6 sm:p-8 md:p-10 flex flex-col justify-center ${
                        isPublic ? '' : 'md:order-1'
                      }`}
                    >
                      <h2 className="text-heading-md md:text-heading-lg mb-3 group-hover:text-accent transition-colors leading-tight">
                        {event.title}
                      </h2>
                      {event.tagline && (
                        <p className="font-mono text-sm sm:text-base text-black/70 mb-6 leading-relaxed">
                          {event.tagline}
                        </p>
                      )}

                      <div className="space-y-2 pt-5 border-t border-black/10">
                        <div className="flex items-center gap-2.5 font-mono text-sm text-black/80">
                          <Calendar className="w-4 h-4 text-accent shrink-0" />
                          <span>{dateStr}</span>
                        </div>
                        <div className="flex items-center gap-2.5 font-mono text-sm text-black/80">
                          <Clock className="w-4 h-4 text-accent shrink-0" />
                          <span>{timeStr}</span>
                        </div>
                        {event.location && (
                          <div className="flex items-center gap-2.5 font-mono text-sm text-black/80">
                            <MapPin className="w-4 h-4 text-accent shrink-0" />
                            <span>{event.location}</span>
                          </div>
                        )}
                      </div>

                      <div className="mt-7 inline-flex items-center gap-1.5 font-mono text-sm font-bold uppercase tracking-wider text-accent group-hover:gap-2.5 transition-all">
                        {isPublic ? 'RSVP' : 'View & Request'}
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
