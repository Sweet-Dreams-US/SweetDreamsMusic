import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Calendar, Music, FileAudio, Download, Heart, PenLine, ShoppingBag } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { formatCents, formatDuration } from '@/lib/utils';
import { fmtSessionDate, fmtSessionTime, fmtStampDate } from '@/lib/studio-time';
import DashboardNav from '@/components/layout/DashboardNav';
import RescheduleButton from '@/components/dashboard/RescheduleButton';
import { bookingStatusLabel } from '@/lib/booking-status';
import XPWidget from '@/components/dashboard/XPWidget';
import FileShowcaseToggle from '@/components/dashboard/FileShowcaseToggle';
import PricingCalculator from '@/components/dashboard/PricingCalculator';
import { getStudioConfigs } from '@/lib/studio-config-server';
import ProfileBeatGrid from '@/components/beats/ProfileBeatGrid';
import { getStudioCreditBalanceForUser, getMediaCreditsForOwner } from '@/lib/media-server';
import { getUserBands } from '@/lib/bands-server';
import DashboardBalances from '@/components/dashboard/DashboardBalances';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  // The Cowork stats agent is a single-purpose service account: its whole world
  // is /agent/stats. Login lands on /dashboard, so bounce it to the console
  // (and every other role-gated page already redirects non-matching roles here).
  if (user.role === 'agent') redirect('/agent/stats');

  const supabase = await createClient();

  // DB-driven room configs for the price calculator (matches the booking engine).
  const studios = await getStudioConfigs(createServiceClient());

  // Spendable balances — surfaced at the top so a user who has a free studio hour
  // (or media credits) sees it the moment they land on /dashboard, instead of only
  // in the Artist Hub. Mirrors the Hub overview's data sources exactly.
  const bandMemberships = await getUserBands(user.id);
  const bandIds = bandMemberships.map((m) => m.band_id);
  const [studioHours, mediaCredits] = await Promise.all([
    getStudioCreditBalanceForUser(user.id),
    getMediaCreditsForOwner({ userId: user.id, bandIds }),
  ]);

  // Fetch user's bookings
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, start_time, end_time, duration, total_amount, status, created_at, engineer_name, requested_engineer, reschedule_requested, room')
    .eq('customer_email', user.email)
    .order('created_at', { ascending: false })
    .limit(10);

  // Fetch user's deliverables (files from engineers)
  const { data: deliverables } = await supabase
    .from('deliverables')
    .select('id, file_name, display_name, file_path, file_type, file_size, uploaded_by_name, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  // Fetch saved beats
  const { data: savedBeats } = await supabase
    .from('user_saved_beats')
    .select('beat_id, beats(id, title, producer, genre, bpm, musical_key, preview_url, cover_image_url, mp3_lease_price, trackout_lease_price, exclusive_price, has_exclusive, lease_count)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(6);

  // Fetch user lyrics
  const { data: userLyrics } = await supabase
    .from('user_lyrics')
    .select('beat_id, updated_at, beats(id, title, producer)')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(6);

  // Generate signed download URLs using service client (bypasses storage RLS)
  const serviceClient = createServiceClient();

  // Fetch showcase items to know which files are public
  const { data: showcaseItems } = await serviceClient
    .from('profile_audio_showcase')
    .select('deliverable_id, is_public')
    .eq('user_id', user.id);

  const publicDeliverableIds = new Set(
    (showcaseItems || []).filter(s => s.is_public).map(s => s.deliverable_id)
  );

  // Isolate each signed-URL call — a single transient storage error (supabase-js
  // re-throws network/timeout from createSignedUrl) must not 500 the dashboard.
  const filesWithUrls = await Promise.all(
    (deliverables || []).map(async (file) => {
      const isPublic = publicDeliverableIds.has(file.id);
      if (!file.file_path) return { ...file, downloadUrl: null, isPublic };
      try {
        const { data } = await serviceClient.storage
          .from('client-audio-files')
          .createSignedUrl(file.file_path, 3600, { download: file.file_name || true }); // 1 hour, force download
        return { ...file, downloadUrl: data?.signedUrl || null, isPublic };
      } catch (e) {
        console.error('[dashboard] signed URL failed for', file.file_path, e);
        return { ...file, downloadUrl: null, isPublic };
      }
    })
  );

  const profileSlug = user.profile?.public_profile_slug || null;

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />

      {/* Quick Actions + XP Widget */}
      <section className="bg-white text-black py-8 border-b-2 border-black/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row gap-4 sm:items-start">
            <div className="flex flex-wrap gap-3">
              <Link
                href="/book"
                className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2"
              >
                <Calendar className="w-4 h-4" />
                Book a Session
              </Link>
              <Link
                href="/beats"
                className="border-2 border-black text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-black hover:text-white transition-colors no-underline inline-flex items-center gap-2"
              >
                <Music className="w-4 h-4" />
                Browse Beats
              </Link>
            </div>
            <div className="sm:ml-auto sm:w-80">
              <XPWidget />
            </div>
          </div>
        </div>
      </section>

      {/* Available Balances — surfaced at the top so a user with a free studio
          hour (or media credits) sees it immediately on /dashboard. Renders
          nothing when both balances are empty. */}
      {(studioHours.hoursRemaining > 0 || mediaCredits.length > 0) && (
        <section className="bg-white text-black pt-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <DashboardBalances studioHours={studioHours} mediaCredits={mediaCredits} />
          </div>
        </section>
      )}

      {/* Content Grid */}
      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12">

            {/* Bookings */}
            <div>
              <h2 className="text-heading-md mb-6 flex items-center gap-3">
                <Calendar className="w-6 h-6 text-accent" />
                YOUR SESSIONS
              </h2>

              {(!bookings || bookings.length === 0) ? (
                <div className="border-2 border-black/10 p-8 text-center">
                  <p className="font-mono text-sm text-black/70 mb-4">No sessions yet</p>
                  <Link
                    href="/book"
                    className="font-mono text-sm font-bold text-accent hover:underline"
                  >
                    Book your first session
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {bookings.map((booking) => (
                    <div key={booking.id} className="border-2 border-black/10 p-4 sm:p-5 hover:border-black/30 transition-colors">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-mono text-sm font-semibold">
                            {fmtSessionDate(booking.start_time, { weekday: 'short', month: 'short', day: 'numeric' })}
                            {' · '}
                            {fmtSessionTime(booking.start_time)}
                          </p>
                          <p className="font-mono text-xs text-black/70 mt-1">
                            {formatDuration(booking.duration)} — {formatCents(booking.total_amount)}
                            {booking.room && ` · ${booking.room === 'studio_a' ? 'Studio A' : 'Studio B'}`}
                          </p>
                          {booking.engineer_name && (
                            <p className="font-mono text-xs text-black/60 mt-1">
                              Engineer: <span className="font-semibold">{booking.engineer_name}</span>
                            </p>
                          )}
                          {booking.reschedule_requested && (
                            <p className="font-mono text-[10px] text-amber-600 font-semibold mt-1">
                              Reschedule requested — we&apos;ll be in touch
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <span className={`font-mono text-xs font-bold uppercase tracking-wider px-2 py-1 ${
                            booking.status === 'completed' ? 'bg-green-100 text-green-700' :
                            booking.status === 'confirmed' ? 'bg-accent/20 text-accent' :
                            booking.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            booking.status === 'cancelled' ? 'bg-red-100 text-red-600' :
                            'bg-black/5 text-black/50'
                          }`}>
                            {bookingStatusLabel(booking.status)}
                          </span>
                        </div>
                      </div>
                      {/* Session prep + reschedule for paid sessions (confirmed or awaiting engineer) */}
                      {(booking.status === 'confirmed' || booking.status === 'pending') && (
                        <div className="mt-3 pt-3 border-t border-black/5 flex flex-wrap gap-2">
                          <Link
                            href={`/dashboard/prep/${booking.id}`}
                            className="font-mono text-[11px] font-bold text-accent hover:underline no-underline flex items-center gap-1"
                          >
                            🎤 Prepare for Session
                          </Link>
                          {booking.engineer_name && !booking.reschedule_requested && (
                            <RescheduleButton bookingId={booking.id} />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Files / Deliverables */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-heading-md flex items-center gap-3">
                  <FileAudio className="w-6 h-6 text-accent" />
                  YOUR FILES
                </h2>
                {filesWithUrls.length > 0 && (
                  <Link href="/dashboard/files" className="font-mono text-xs text-accent hover:underline no-underline">
                    View All &rarr;
                  </Link>
                )}
              </div>

              {filesWithUrls.length === 0 ? (
                <div className="border-2 border-black/10 p-8 text-center">
                  <p className="font-mono text-sm text-black/70">
                    No files yet. Files from your sessions will appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filesWithUrls.map((file) => (
                    <div key={file.id} className="border-2 border-black/10 p-4 sm:p-5 hover:border-black/30 transition-colors">
                      <div className="flex justify-between items-start gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-semibold truncate">
                            {file.display_name || file.file_name}
                          </p>
                          <p className="font-mono text-xs text-black/70 mt-1">
                            by {file.uploaded_by_name} — {fmtStampDate(file.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="font-mono text-xs text-black/60 uppercase">
                            {file.file_type?.split('/')[1] || 'file'}
                          </span>
                          {file.downloadUrl && (
                            <a
                              href={file.downloadUrl}
                              download={file.file_name}
                              className="bg-black text-white p-2 hover:bg-black/80 transition-colors"
                              title="Download"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      </div>
                      {file.file_type?.startsWith('audio/') && (
                        <div className="mt-3 pt-3 border-t border-black/5">
                          <FileShowcaseToggle
                            deliverableId={file.id}
                            initialEnabled={file.isPublic}
                            profileSlug={profileSlug}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* Saved Beats */}
          {savedBeats && savedBeats.length > 0 && (() => {
            const flatBeats = savedBeats
              .map(saved => {
                const beat = Array.isArray(saved.beats) ? saved.beats[0] : saved.beats;
                return beat ? { ...beat, has_exclusive: beat.has_exclusive ?? true, lease_count: beat.lease_count ?? 0 } : null;
              })
              .filter(Boolean) as { id: string; title: string; producer: string; genre: string | null; bpm: number | null; musical_key: string | null; preview_url: string | null; cover_image_url: string | null; mp3_lease_price: number | null; trackout_lease_price: number | null; exclusive_price: number | null; has_exclusive: boolean; lease_count: number }[];

            return flatBeats.length > 0 ? (
              <div className="mt-12">
                <h2 className="text-heading-md mb-6 flex items-center gap-3">
                  <Heart className="w-6 h-6 text-accent" />
                  SAVED BEATS
                </h2>
                <ProfileBeatGrid beats={flatBeats} producerName="" />
                <Link href="/beats" className="font-mono text-xs text-accent hover:underline no-underline mt-3 inline-block">
                  Browse more beats &rarr;
                </Link>
              </div>
            ) : null;
          })()}

          {/* My Purchases quick link */}
          <div className="mt-12">
            <Link
              href="/dashboard/purchases"
              className="border-2 border-black/10 p-6 flex items-center gap-4 hover:border-accent transition-colors no-underline"
            >
              <ShoppingBag className="w-8 h-8 text-accent flex-shrink-0" />
              <div>
                <p className="font-mono text-sm font-bold">MY BEAT PURCHASES</p>
                <p className="font-mono text-xs text-black/60">View licenses, re-download files, and manage your beat purchases</p>
              </div>
            </Link>
          </div>

          {/* Session Price Calculator */}
          <PricingCalculator studios={studios} />

          {/* My Lyrics */}
          {userLyrics && userLyrics.length > 0 && (
            <div className="mt-12">
              <h2 className="text-heading-md mb-6 flex items-center gap-3">
                <PenLine className="w-6 h-6 text-accent" />
                MY LYRICS
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {userLyrics.map((lyric) => {
                  const beat = Array.isArray(lyric.beats) ? lyric.beats[0] : lyric.beats;
                  if (!beat) return null;
                  return (
                    <Link
                      key={lyric.beat_id}
                      href={`/beats/${beat.id}/write`}
                      className="border-2 border-black/10 p-4 hover:border-accent transition-colors no-underline"
                    >
                      <p className="font-mono text-sm font-bold truncate">{beat.title}</p>
                      <p className="font-mono text-xs text-black/70 mt-1">
                        {beat.producer} · Last edited {fmtStampDate(lyric.updated_at)}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
