'use client';

// Artist Hub → Bands tab. Relocated from the standalone /dashboard/bands page
// (which still exists as a deep route). Presentational only — data is fetched
// server-side in app/dashboard/hub/page.tsx and passed in as props. All deep
// actions (create / detail / edit / members / accept-invite) link out to the
// existing standalone routes, which keep their own nav.

import Link from 'next/link';
import Image from 'next/image';
import { Users, Plus, Mail, AlertCircle, ArrowRight, Film } from 'lucide-react';
import type { BandMembership, BandInvite, Band } from '@/lib/bands';

type PendingBandInvite = BandInvite & { band: Band };

export default function HubBands({
  memberships,
  pendingInvites,
  hasProfile,
}: {
  memberships: BandMembership[];
  pendingInvites: PendingBandInvite[];
  hasProfile: boolean;
}) {
  return (
    <div className="space-y-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-heading-md flex items-center gap-3">
            <Users className="w-6 h-6 text-accent" />
            YOUR BANDS
          </h2>
          <p className="font-mono text-sm text-black/60 mt-1">
            Collaborate on bookings, releases, and The Sweet Spot showcases.
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
            href="/dashboard/profile"
            className="border-2 border-black text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-black hover:text-white transition-colors no-underline inline-flex items-center gap-2 flex-shrink-0"
          >
            Set up your profile first
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div>
          <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2">
            <Mail className="w-4 h-4 text-accent" /> Pending Invites
          </h3>
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
                    <p className="font-mono text-xs uppercase tracking-wider text-black/70">Invited to join</p>
                    <p className="font-mono text-lg font-bold truncate">{invite.band.display_name}</p>
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

      {/* Your bands grid */}
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
                <div className="p-5 flex-1 flex flex-col">
                  <p className="font-mono text-lg font-bold truncate group-hover:text-accent transition-colors">
                    {m.band.display_name}
                  </p>
                  {m.band.genre && <p className="font-mono text-xs text-black/60 mt-1">{m.band.genre}</p>}
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

          {/* Cross-link to media — bands are eligible for the full media catalog. */}
          <div className="mt-10 border-2 border-accent bg-accent/5 p-6 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Film className="w-6 h-6 text-accent shrink-0" />
              <div className="min-w-0">
                <p className="font-mono text-sm font-bold uppercase tracking-wider">Media for your band</p>
                <p className="font-mono text-xs text-black/60">
                  Music videos, photo shoots, cover art, full release packages.
                </p>
              </div>
            </div>
            <Link
              href="/dashboard/media"
              className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 hover:bg-accent hover:text-black transition-colors no-underline inline-flex items-center gap-2 shrink-0"
            >
              Open Media <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
