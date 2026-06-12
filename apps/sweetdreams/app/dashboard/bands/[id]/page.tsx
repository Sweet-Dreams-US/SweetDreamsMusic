import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Users,
  Settings,
  Globe,
  Lock,
  ArrowLeft,
  Pencil,
  ExternalLink,
  Mail,
  UserPlus,
  Calendar,
} from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { memberHasFlag, isOwnerOrAdmin } from '@/lib/bands';
import {
  getBandWithMembers,
  getMembership,
  getPendingInvitesForBand,
} from '@/lib/bands-server';
import DashboardNav from '@/components/layout/DashboardNav';

export const metadata: Metadata = { title: 'Band Hub' };

/**
 * Band hub overview. This is the per-band landing after creation or from the
 * bands list. Shows:
 *   - Band identity (name, picture, genre, visibility)
 *   - Member count + quick link to members page
 *   - Permission-gated action cards (edit page, invite, book sessions, etc.)
 *   - Public URL if the band is public
 *
 * Phase 3 will add a "Band Bookings" card below the action grid; we leave the
 * space ready for it.
 */
export default async function BandHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Load band + members + current user's membership + pending invites in parallel.
  const [bandResult, membership, pendingInvites] = await Promise.all([
    getBandWithMembers(id),
    getMembership(id, user.id),
    getPendingInvitesForBand(id),
  ]);

  if (!bandResult) notFound();
  // If user isn't a member, they can't access this hub.
  if (!membership) notFound();

  const { band, members } = bandResult;

  const canEdit = memberHasFlag(membership, 'can_edit_public_page');
  const canManage = memberHasFlag(membership, 'can_manage_members');
  const canBook = memberHasFlag(membership, 'can_book_band_sessions');
  const adminish = isOwnerOrAdmin(membership);

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />

      {/* Band header */}
      <section className="relative bg-black text-white overflow-hidden">
        {band.cover_image_url && (
          <Image
            src={band.cover_image_url}
            alt={band.display_name}
            fill
            className="object-cover opacity-40"
            priority
            sizes="100vw"
          />
        )}
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <Link
            href="/dashboard/bands"
            className="font-mono text-xs text-white/70 hover:text-white no-underline inline-flex items-center gap-1 mb-6"
          >
            <ArrowLeft className="w-3 h-3" />
            All bands
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-end gap-6">
            {/* Profile picture */}
            <div className="relative w-24 h-24 sm:w-32 sm:h-32 border-4 border-white flex-shrink-0 bg-black">
              {band.profile_picture_url ? (
                <Image
                  src={band.profile_picture_url}
                  alt={band.display_name}
                  fill
                  className="object-cover"
                  sizes="128px"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Users className="w-10 h-10 text-white/30" strokeWidth={1.5} />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 ${
                    membership.role === 'owner'
                      ? 'bg-accent text-black'
                      : membership.role === 'admin'
                      ? 'bg-white text-black'
                      : 'bg-white/20 text-white'
                  }`}
                >
                  {membership.role}
                </span>
                {band.is_public ? (
                  <span className="font-mono text-[10px] text-white/70 inline-flex items-center gap-1">
                    <Globe className="w-3 h-3" /> Public
                  </span>
                ) : (
                  <span className="font-mono text-[10px] text-white/70 inline-flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Private
                  </span>
                )}
              </div>
              <h1 className="text-display-sm truncate">{band.display_name}</h1>
              <div className="font-mono text-sm text-white/70 mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {band.genre && <span>{band.genre}</span>}
                {band.hometown && <span>{band.hometown}</span>}
                <span>{members.length} member{members.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Public URL banner (if public) */}
      {band.is_public && (
        <section className="bg-accent text-black py-4 border-b-2 border-black">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="font-mono text-xs">
              <span className="font-bold uppercase tracking-wider">Public page:</span>{' '}
              <span className="font-semibold">sweetdreamsmusic.com/bands/{band.slug}</span>
            </p>
            <Link
              href={`/bands/${band.slug}`}
              target="_blank"
              className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1 hover:underline no-underline"
            >
              View page <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </section>
      )}

      {/* Action grid */}
      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          {/* Per-member stage info (if set) */}
          {(membership.stage_name || membership.band_role) && (
            <div className="border-2 border-black/10 bg-black/5 p-4 mb-8">
              <p className="font-mono text-xs text-black/60 mb-1">YOUR ROLE IN THIS BAND</p>
              <p className="font-mono text-sm font-bold">
                {membership.stage_name || user.profile?.display_name}
                {membership.band_role && (
                  <span className="font-normal text-black/70"> — {membership.band_role}</span>
                )}
              </p>
            </div>
          )}

          <h2 className="text-heading-md mb-6">BAND HUB</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

            {/* Members — everyone sees */}
            <Link
              href={`/dashboard/bands/${band.id}/members`}
              className="border-2 border-black/10 hover:border-accent transition-colors p-6 no-underline group"
            >
              <Users className="w-8 h-8 text-accent mb-4" strokeWidth={1.5} />
              <p className="font-mono text-xs text-black/60 mb-1">MEMBERS</p>
              <p className="font-mono text-heading-sm font-bold group-hover:text-accent transition-colors">
                {members.length}
              </p>
              {pendingInvites.length > 0 && canManage && (
                <p className="font-mono text-xs text-black/60 mt-2 inline-flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  {pendingInvites.length} pending invite{pendingInvites.length === 1 ? '' : 's'}
                </p>
              )}
            </Link>

            {/* Edit public page */}
            {canEdit && (
              <Link
                href={`/dashboard/bands/${band.id}/edit`}
                className="border-2 border-black/10 hover:border-accent transition-colors p-6 no-underline group"
              >
                <Pencil className="w-8 h-8 text-accent mb-4" strokeWidth={1.5} />
                <p className="font-mono text-xs text-black/60 mb-1">PROFILE</p>
                <p className="font-mono text-body-md font-bold group-hover:text-accent transition-colors">
                  Edit band profile
                </p>
                <p className="font-mono text-xs text-black/60 mt-2">
                  Photo, cover, bio, social links.
                </p>
              </Link>
            )}

            {/* Invite members */}
            {canManage && (
              <Link
                href={`/dashboard/bands/${band.id}/members`}
                className="border-2 border-black/10 hover:border-accent transition-colors p-6 no-underline group"
              >
                <UserPlus className="w-8 h-8 text-accent mb-4" strokeWidth={1.5} />
                <p className="font-mono text-xs text-black/60 mb-1">INVITE</p>
                <p className="font-mono text-body-md font-bold group-hover:text-accent transition-colors">
                  Invite a member
                </p>
                <p className="font-mono text-xs text-black/60 mt-2">
                  Send an email invite with role + permissions.
                </p>
              </Link>
            )}

            {/* Book a band session — routes to the unified booking flow in
                band mode. The page re-verifies canBook server-side; this is
                just the entry point. */}
            {canBook && (
              <Link
                href={`/book?bandId=${band.id}`}
                className="border-2 border-black/10 hover:border-accent transition-colors p-6 no-underline group"
              >
                <Calendar className="w-8 h-8 text-accent mb-4" strokeWidth={1.5} />
                <p className="font-mono text-xs text-black/60 mb-1">BOOKINGS</p>
                <p className="font-mono text-body-md font-bold group-hover:text-accent transition-colors">
                  Book a band session
                </p>
                <p className="font-mono text-xs text-black/60 mt-2">
                  Studio A, flat-rate 4h or 8h tiers — 50% deposit.
                </p>
              </Link>
            )}

            {/* Owner-only: settings */}
            {adminish && (
              <Link
                href={`/dashboard/bands/${band.id}/edit`}
                className="border-2 border-black/10 hover:border-accent transition-colors p-6 no-underline group"
              >
                <Settings className="w-8 h-8 text-accent mb-4" strokeWidth={1.5} />
                <p className="font-mono text-xs text-black/60 mb-1">SETTINGS</p>
                <p className="font-mono text-body-md font-bold group-hover:text-accent transition-colors">
                  Band settings
                </p>
                <p className="font-mono text-xs text-black/60 mt-2">
                  Visibility, URL slug, ownership.
                </p>
              </Link>
            )}
          </div>

          {/* Members quick list */}
          <div className="mt-12">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-heading-sm">LINEUP</h3>
              <Link
                href={`/dashboard/bands/${band.id}/members`}
                className="font-mono text-xs text-accent hover:underline no-underline"
              >
                Manage &rarr;
              </Link>
            </div>
            <div className="space-y-2">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="border-2 border-black/10 p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-bold truncate">
                      {m.stage_name || '(unnamed member)'}
                      {m.user_id === user.id && (
                        <span className="ml-2 font-mono text-[10px] text-black/50 font-normal">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="font-mono text-xs text-black/60 mt-0.5">
                      {m.band_role || <span className="italic">No role set</span>}
                    </p>
                  </div>
                  <span
                    className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 flex-shrink-0 ${
                      m.role === 'owner'
                        ? 'bg-accent text-black'
                        : m.role === 'admin'
                        ? 'bg-black text-white'
                        : 'bg-black/10 text-black/70'
                    }`}
                  >
                    {m.role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
