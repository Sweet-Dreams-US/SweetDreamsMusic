import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Users, Plus, Mail, AlertCircle, ArrowRight, Film } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { getUserBands, getPendingInvitesForEmail } from '@/lib/bands-server';
import DashboardNav from '@/components/layout/DashboardNav';

export const metadata: Metadata = { title: 'Bands' };

/**
 * Band hub landing. Two concurrent data fetches:
 *   1. Bands this user belongs to (any role)
 *   2. Pending invites addressed to their email (may or may not be in a band already)
 *
 * If the user doesn't have a solo profile yet, gate the "Create a Band" CTA —
 * our data model expects every band owner to have an underlying user_profile.
 */
export default async function BandsDashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const [memberships, pendingInvites] = await Promise.all([
    getUserBands(user.id),
    getPendingInvitesForEmail(user.email),
  ]);

  const hasProfile = !!user.profile;

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />

      {/* Header + primary CTA */}
      <section className="bg-white text-black py-8 border-b-2 border-black/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-heading-xl flex items-center gap-3">
              <Users className="w-7 h-7 text-accent" />
              YOUR BANDS
            </h1>
            <p className="font-mono text-sm text-black/60 mt-2">
              Create or join a band to collaborate on bookings, releases, and The Sweet Spot showcases.
            </p>
          </div>
          {hasProfile ? (
            <Link
              href="/dashboard/bands/new"
              className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2 flex-shrink-0"
            >
              <Plus className="w-4 h-4" />
              Create a Band
            </Link>
          ) : (
            <Link
              href="/dashboard/hub"
              className="border-2 border-black text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-black hover:text-white transition-colors no-underline inline-flex items-center gap-2 flex-shrink-0"
            >
              Set up your profile first
              <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </section>

      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">

          {/* Pending invites — yellow card at top */}
          {pendingInvites.length > 0 && (
            <div>
              <h2 className="text-heading-md mb-4 flex items-center gap-3">
                <Mail className="w-6 h-6 text-accent" />
                PENDING INVITES
              </h2>
              <div className="space-y-3">
                {pendingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="bg-yellow-300 border-2 border-black p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      {invite.band.profile_picture_url ? (
                        <div className="relative w-14 h-14 flex-shrink-0 border-2 border-black">
                          <Image
                            src={invite.band.profile_picture_url}
                            alt={invite.band.display_name}
                            fill
                            className="object-cover"
                            sizes="56px"
                          />
                        </div>
                      ) : (
                        <div className="w-14 h-14 flex-shrink-0 bg-black text-yellow-300 flex items-center justify-center border-2 border-black">
                          <Users className="w-6 h-6" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-mono text-xs uppercase tracking-wider text-black/70">
                          Invited to join
                        </p>
                        <p className="font-mono text-lg font-bold truncate">
                          {invite.band.display_name}
                        </p>
                        <p className="font-mono text-xs text-black/70 mt-0.5">
                          Role: <span className="font-bold uppercase">{invite.role}</span>
                          {invite.band_role && <> · {invite.band_role}</>}
                        </p>
                      </div>
                    </div>
                    <Link
                      href={`/bands/accept/${invite.token}`}
                      className="bg-black text-yellow-300 font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-black/80 transition-colors no-underline inline-flex items-center gap-2 flex-shrink-0"
                    >
                      Review invite <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Your bands */}
          {memberships.length === 0 ? (
            <div className="border-2 border-black/10 p-12 text-center">
              <Users className="w-12 h-12 text-black/30 mx-auto mb-4" strokeWidth={1.5} />
              <p className="font-mono text-body-md font-bold mb-2">NO BANDS YET</p>
              <p className="font-mono text-sm text-black/60 max-w-md mx-auto mb-6">
                Create a band to collaborate on bookings and releases, or accept an invite from a bandmate.
              </p>
              {hasProfile ? (
                <Link
                  href="/dashboard/bands/new"
                  className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Create your first band
                </Link>
              ) : (
                <div className="bg-black/5 border-2 border-black/20 p-4 max-w-md mx-auto">
                  <AlertCircle className="w-5 h-5 text-black/60 mx-auto mb-2" />
                  <p className="font-mono text-xs text-black/70">
                    Set up your artist profile first — bands are created from your solo profile.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {memberships.map((m) => (
                  <Link
                    key={m.id}
                    href={`/dashboard/bands/${m.band.id}`}
                    className="border-2 border-black/10 hover:border-accent transition-colors no-underline group overflow-hidden flex flex-col"
                  >
                    {/* Cover / picture */}
                    <div className="relative aspect-[3/2] bg-black">
                      {m.band.cover_image_url ? (
                        <Image
                          src={m.band.cover_image_url}
                          alt={m.band.display_name}
                          fill
                          className="object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                          sizes="(max-width: 768px) 100vw, 33vw"
                        />
                      ) : m.band.profile_picture_url ? (
                        <Image
                          src={m.band.profile_picture_url}
                          alt={m.band.display_name}
                          fill
                          className="object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                          sizes="(max-width: 768px) 100vw, 33vw"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Users className="w-16 h-16 text-white/30" strokeWidth={1.2} />
                        </div>
                      )}
                      {/* Role badge */}
                      <div className="absolute top-3 left-3">
                        <span
                          className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 ${
                            m.role === 'owner'
                              ? 'bg-accent text-black'
                              : m.role === 'admin'
                              ? 'bg-white text-black'
                              : 'bg-black/70 text-white'
                          }`}
                        >
                          {m.role}
                        </span>
                      </div>
                      {!m.band.is_public && (
                        <div className="absolute top-3 right-3">
                          <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 bg-black/70 text-white">
                            Private
                          </span>
                        </div>
                      )}
                    </div>
                    {/* Name / meta */}
                    <div className="p-5 flex-1 flex flex-col">
                      <p className="font-mono text-lg font-bold truncate group-hover:text-accent transition-colors">
                        {m.band.display_name}
                      </p>
                      {m.band.genre && (
                        <p className="font-mono text-xs text-black/60 mt-1">{m.band.genre}</p>
                      )}
                      {m.stage_name && (
                        <p className="font-mono text-xs text-black/50 mt-2">
                          as <span className="font-semibold">{m.stage_name}</span>
                          {m.band_role && <> · {m.band_role}</>}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>

              {/* Cross-link to media catalog — bands are eligible for the
                  full Media Hub (music videos, photos, package builds).
                  Surfacing it from the band hub closes the discovery loop
                  Cole called out in the spec ("Cross-link from /bands"). */}
              <div className="mt-10 border-2 border-accent bg-accent/5 p-6 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <Film className="w-6 h-6 text-accent shrink-0" />
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-bold uppercase tracking-wider">
                      Media for your band
                    </p>
                    <p className="font-mono text-xs text-black/60">
                      Music videos, photo shoots, cover art, full release packages.
                    </p>
                  </div>
                </div>
                <Link
                  href="/dashboard/media"
                  className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 hover:bg-accent hover:text-black transition-colors no-underline inline-flex items-center gap-2 shrink-0"
                >
                  Open Media Hub
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
