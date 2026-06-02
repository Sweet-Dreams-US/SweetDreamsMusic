import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { Users, AlertCircle, Clock } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import type { BandInvite, Band } from '@/lib/bands';
import InviteActions from '@/components/bands/InviteActions';
import { fmtStampDate } from '@/lib/studio-time';

export const metadata: Metadata = { title: 'Band Invite' };

/**
 * Accept / reject an email invite. Three states:
 *   1. Invite doesn't exist / expired / already handled — friendly error
 *   2. Not signed in (or signed in as wrong email) — prompt to sign in with invite email
 *   3. Signed in as the correct email — show band info + accept/reject buttons
 */
export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createServiceClient();

  const { data: inviteRow } = await supabase
    .from('band_invites')
    .select('*, band:bands(*)')
    .eq('token', token)
    .maybeSingle();

  const invite = inviteRow as (BandInvite & { band: Band | null }) | null;
  const user = await getSessionUser();

  // Case 1: invite missing
  if (!invite || !invite.band) {
    return (
      <InviteShell>
        <AlertCircle className="w-10 h-10 text-black/40 mx-auto mb-4" />
        <p className="font-mono text-body-md font-bold mb-2">INVITE NOT FOUND</p>
        <p className="font-mono text-sm text-black/60 max-w-md mx-auto">
          This invite link is invalid or was deleted. Ask your bandmate to send a new one.
        </p>
      </InviteShell>
    );
  }

  // Case 1b: already handled or expired
  const now = new Date();
  const expired = new Date(invite.expires_at) < now;
  const alreadyHandled = !!invite.accepted_at || !!invite.rejected_at;

  if (alreadyHandled) {
    return (
      <InviteShell bandName={invite.band.display_name}>
        <Clock className="w-10 h-10 text-black/40 mx-auto mb-4" />
        <p className="font-mono text-body-md font-bold mb-2">
          {invite.accepted_at ? 'ALREADY ACCEPTED' : 'INVITE DECLINED'}
        </p>
        <p className="font-mono text-sm text-black/60 max-w-md mx-auto mb-6">
          This invite to <strong>{invite.band.display_name}</strong> has already been handled.
        </p>
        {user && (
          <Link
            href="/dashboard/bands"
            className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2"
          >
            Go to your bands
          </Link>
        )}
      </InviteShell>
    );
  }

  if (expired) {
    return (
      <InviteShell bandName={invite.band.display_name}>
        <Clock className="w-10 h-10 text-black/40 mx-auto mb-4" />
        <p className="font-mono text-body-md font-bold mb-2">INVITE EXPIRED</p>
        <p className="font-mono text-sm text-black/60 max-w-md mx-auto">
          This invite expired on {fmtStampDate(invite.expires_at)}. Ask your bandmate to
          send a new one.
        </p>
      </InviteShell>
    );
  }

  // Case 2: not signed in, or signed in as wrong email.
  if (!user || user.email.toLowerCase() !== invite.invited_email.toLowerCase()) {
    const signInUrl = `/login?next=${encodeURIComponent(`/bands/accept/${token}`)}&email=${encodeURIComponent(invite.invited_email)}`;
    return (
      <InviteShell bandName={invite.band.display_name}>
        {invite.band.profile_picture_url ? (
          <div className="relative w-16 h-16 mx-auto mb-4 border-2 border-black">
            <Image
              src={invite.band.profile_picture_url}
              alt={invite.band.display_name}
              fill
              className="object-cover"
              sizes="64px"
            />
          </div>
        ) : (
          <Users className="w-10 h-10 text-accent mx-auto mb-4" strokeWidth={1.5} />
        )}
        <p className="font-mono text-xs text-black/60 mb-1">YOU&apos;VE BEEN INVITED TO JOIN</p>
        <p className="font-mono text-heading-md mb-6">{invite.band.display_name}</p>
        {!user ? (
          <>
            <p className="font-mono text-sm text-black/70 max-w-md mx-auto mb-6">
              Sign in with <strong>{invite.invited_email}</strong> to review this invite. If you don&apos;t
              have a Sweet Dreams account yet, you can create one with that email.
            </p>
            <Link
              href={signInUrl}
              className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent/90 transition-colors no-underline inline-flex items-center gap-2"
            >
              Sign in / Sign up
            </Link>
          </>
        ) : (
          <>
            <p className="font-mono text-sm text-black/70 max-w-md mx-auto mb-6">
              This invite was sent to <strong>{invite.invited_email}</strong>, but you&apos;re signed in as{' '}
              <strong>{user.email}</strong>. Sign out and sign back in with the correct account.
            </p>
            <Link
              href="/dashboard"
              className="border-2 border-black text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-black hover:text-white transition-colors no-underline inline-flex items-center gap-2"
            >
              Go to dashboard
            </Link>
          </>
        )}
      </InviteShell>
    );
  }

  // Case 3: signed in as correct email — show review UI
  return (
    <InviteShell bandName={invite.band.display_name}>
      {invite.band.profile_picture_url ? (
        <div className="relative w-20 h-20 mx-auto mb-4 border-2 border-black">
          <Image
            src={invite.band.profile_picture_url}
            alt={invite.band.display_name}
            fill
            className="object-cover"
            sizes="80px"
          />
        </div>
      ) : (
        <div className="w-20 h-20 mx-auto mb-4 bg-black text-accent flex items-center justify-center border-2 border-black">
          <Users className="w-10 h-10" strokeWidth={1.5} />
        </div>
      )}
      <p className="font-mono text-xs text-black/60 mb-1">YOU&apos;VE BEEN INVITED TO JOIN</p>
      <p className="font-mono text-heading-md mb-2">{invite.band.display_name}</p>
      {invite.band.genre && (
        <p className="font-mono text-sm text-black/60 mb-2">{invite.band.genre}</p>
      )}
      <p className="font-mono text-xs text-black/60 mb-6">
        as <strong className="uppercase">{invite.role}</strong>
        {invite.band_role && <> · {invite.band_role}</>}
      </p>

      {/* Permission summary */}
      {(invite.can_edit_public_page ||
        invite.can_book_sessions ||
        invite.can_book_band_sessions ||
        invite.can_manage_members) && (
        <div className="border-2 border-black/10 p-4 mb-6 text-left max-w-sm mx-auto">
          <p className="font-mono text-xs font-bold uppercase tracking-wider mb-3 text-center">
            Permissions you&apos;ll receive
          </p>
          <ul className="space-y-1.5 font-mono text-xs text-black/70">
            {invite.can_edit_public_page && <li>• Edit the band&apos;s public page</li>}
            {invite.can_book_sessions && <li>• Book solo studio sessions</li>}
            {invite.can_book_band_sessions && <li>• Book band sessions</li>}
            {invite.can_manage_members && <li>• Invite & manage other members</li>}
          </ul>
        </div>
      )}

      <InviteActions token={token} bandName={invite.band.display_name} />

      <p className="font-mono text-xs text-black/40 mt-6">
        Invite expires {fmtStampDate(invite.expires_at)}
      </p>
    </InviteShell>
  );
}

function InviteShell({
  children,
  bandName,
}: {
  children: React.ReactNode;
  bandName?: string;
}) {
  return (
    <>
      <section className="bg-black text-white py-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase">
            {bandName ? 'Band Invitation' : 'Invitation'}
          </p>
        </div>
      </section>
      <section className="bg-white text-black py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">{children}</div>
      </section>
    </>
  );
}
