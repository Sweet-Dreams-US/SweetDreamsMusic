import Link from 'next/link';
import Image from 'next/image';
import { Mail, Users, ArrowRight } from 'lucide-react';

/**
 * Pending band invites banner.
 *
 * Rendered from server components that have already fetched invites via
 * `getPendingInvitesForEmail(user.email)`. Pure presentational — no data
 * fetching, no client interactivity. Renders nothing if there are no invites
 * so callers can blindly drop it in above other content.
 *
 * Used on:
 *   - /dashboard/hub   (Artist Hub landing — primary surface)
 *   - /dashboard/bands (Bands dashboard — already had its own inline version,
 *                       we may consolidate later)
 */

type BandSummary = {
  id: string;
  display_name: string;
  profile_picture_url: string | null;
};

type PendingInvite = {
  id: string;
  token: string;
  role: string;
  band_role: string | null;
  band: BandSummary;
};

export default function PendingInvitesBanner({ invites }: { invites: PendingInvite[] }) {
  if (invites.length === 0) return null;

  return (
    <section className="bg-yellow-300 text-black border-b-4 border-black">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center gap-3 mb-4">
          <Mail className="w-5 h-5 text-black" />
          <p className="font-mono text-xs font-bold uppercase tracking-[0.3em]">
            {invites.length === 1 ? 'Band invite waiting' : `${invites.length} band invites waiting`}
          </p>
        </div>
        <div className="space-y-3">
          {invites.map((invite) => (
            <div
              key={invite.id}
              className="bg-black text-yellow-300 border-2 border-black p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            >
              <div className="flex items-center gap-4 min-w-0">
                {invite.band.profile_picture_url ? (
                  <div className="relative w-12 h-12 flex-shrink-0 border-2 border-yellow-300">
                    <Image
                      src={invite.band.profile_picture_url}
                      alt={invite.band.display_name}
                      fill
                      className="object-cover"
                      sizes="48px"
                    />
                  </div>
                ) : (
                  <div className="w-12 h-12 flex-shrink-0 bg-yellow-300 text-black flex items-center justify-center border-2 border-yellow-300">
                    <Users className="w-5 h-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-yellow-300/70">
                    Invited to join
                  </p>
                  <p className="font-mono text-base font-bold truncate">{invite.band.display_name}</p>
                  <p className="font-mono text-[11px] text-yellow-300/70 mt-0.5">
                    Role: <span className="font-bold uppercase">{invite.role}</span>
                    {invite.band_role && <> · {invite.band_role}</>}
                  </p>
                </div>
              </div>
              <Link
                href={`/bands/accept/${invite.token}`}
                className="bg-yellow-300 text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2.5 hover:bg-yellow-400 transition-colors no-underline inline-flex items-center gap-2 flex-shrink-0"
              >
                Review <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
