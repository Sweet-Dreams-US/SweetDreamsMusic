'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  UserPlus,
  Mail,
  Clock,
  AlertCircle,
  Loader2,
  Trash2,
  X,
  Crown,
} from 'lucide-react';
import type { BandMember, BandInvite } from '@/lib/bands';
import { memberHasFlag, isOwner } from '@/lib/bands';
import { fmtStampDate } from '@/lib/studio-time';
import { useBrand } from '@/components/brand/BrandProvider';

type ProfileLookup = Record<string, { display_name: string | null; public_profile_slug: string | null }>;

interface Props {
  bandId: string;
  currentUserId: string;
  currentUserMembership: BandMember;
  members: BandMember[];
  profileLookup: ProfileLookup;
  pendingInvites: BandInvite[];
}

/**
 * Members management UI — invite form + lineup list + pending invites.
 *
 * Permission model:
 *   - `canManage` from `currentUserMembership.can_manage_members` (or owner implicit)
 *     gates the invite form and member-removal buttons
 *   - Owners can never be removed via UI; ownership transfer is a separate flow
 *   - A user cannot remove themselves via this UI (they "leave the band" from elsewhere)
 */
export default function MemberManagement({
  bandId,
  currentUserId,
  currentUserMembership,
  members,
  profileLookup,
  pendingInvites,
}: Props) {
  const router = useRouter();
  const b = useBrand();
  const canManage = memberHasFlag(currentUserMembership, 'can_manage_members');

  // Invite form state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [stageName, setStageName] = useState('');
  const [bandRole, setBandRole] = useState('');
  const [canEditPage, setCanEditPage] = useState(false);
  const [canBookSessions, setCanBookSessions] = useState(false);
  const [canBookBand, setCanBookBand] = useState(false);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pending op state (which row is currently being acted on)
  const [pendingOp, setPendingOp] = useState<string | null>(null);

  function resetInviteForm() {
    setEmail('');
    setRole('member');
    setStageName('');
    setBandRole('');
    setCanEditPage(false);
    setCanBookSessions(false);
    setCanBookBand(false);
    setCanManageMembers(false);
    setError(null);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    setSending(true);
    try {
      const res = await fetch(`/api/bands/${bandId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invited_email: email.trim(),
          role,
          stage_name: stageName.trim() || null,
          band_role: bandRole.trim() || null,
          can_edit_public_page: canEditPage,
          can_book_sessions: canBookSessions,
          can_book_band_sessions: canBookBand,
          can_manage_members: canManageMembers,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send invite');

      resetInviteForm();
      setInviteOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSending(false);
    }
  }

  async function handleCancelInvite(inviteId: string) {
    if (!confirm('Cancel this invite? The recipient will no longer be able to accept.')) return;
    setPendingOp(`invite-${inviteId}`);
    try {
      const res = await fetch(`/api/bands/${bandId}/invites/${inviteId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to cancel invite');
        return;
      }
      router.refresh();
    } finally {
      setPendingOp(null);
    }
  }

  async function handleRemoveMember(memberId: string, displayName: string) {
    if (!confirm(`Remove ${displayName} from the band?`)) return;
    setPendingOp(`member-${memberId}`);
    try {
      const res = await fetch(`/api/bands/${bandId}/members/${memberId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to remove member');
        return;
      }
      router.refresh();
    } finally {
      setPendingOp(null);
    }
  }

  return (
    <div className="space-y-12">

      {/* Invite action (visible to managers only) */}
      {canManage && (
        <div>
          {!inviteOpen ? (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent/90 transition-colors inline-flex items-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              Invite a member
            </button>
          ) : (
            <form onSubmit={handleInvite} className="border-2 border-black p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-heading-sm">NEW INVITE</h3>
                <button
                  type="button"
                  onClick={() => {
                    resetInviteForm();
                    setInviteOpen(false);
                  }}
                  className="text-black/50 hover:text-black"
                  disabled={sending}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {error && (
                <div className="border-2 border-red-500 bg-red-50 p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="font-mono text-xs text-red-700">{error}</p>
                </div>
              )}

              {/* Email */}
              <div>
                <label htmlFor="invite-email" className="font-mono text-xs font-bold uppercase tracking-wider block mb-2">
                  Email *
                </label>
                <input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="bandmate@example.com"
                  className="w-full border-2 border-black px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-accent"
                  disabled={sending}
                />
                <p className="font-mono text-xs text-black/50 mt-1.5">
                  If they don&apos;t have a {b.name} account yet, they&apos;ll be prompted to create one.
                </p>
              </div>

              {/* Role + stage name grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="invite-role" className="font-mono text-xs font-bold uppercase tracking-wider block mb-2">
                    Role
                  </label>
                  <select
                    id="invite-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
                    className="w-full border-2 border-black/20 px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-accent bg-white"
                    disabled={sending}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="invite-band-role" className="font-mono text-xs font-bold uppercase tracking-wider block mb-2">
                    Instrument / part
                  </label>
                  <input
                    id="invite-band-role"
                    type="text"
                    value={bandRole}
                    onChange={(e) => setBandRole(e.target.value)}
                    placeholder="Bass, lead vocals..."
                    className="w-full border-2 border-black/20 px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-accent"
                    disabled={sending}
                  />
                </div>
              </div>

              {/* Stage name */}
              <div>
                <label htmlFor="invite-stage" className="font-mono text-xs font-bold uppercase tracking-wider block mb-2">
                  Stage name (optional)
                </label>
                <input
                  id="invite-stage"
                  type="text"
                  value={stageName}
                  onChange={(e) => setStageName(e.target.value)}
                  placeholder="Name as it appears on the band page"
                  className="w-full border-2 border-black/20 px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-accent"
                  disabled={sending}
                />
              </div>

              {/* Permission flags */}
              <div>
                <span className="font-mono text-xs font-bold uppercase tracking-wider block mb-3">
                  Permissions
                </span>
                <div className="space-y-2">
                  <PermCheckbox
                    label="Edit band profile"
                    description="Can edit the public page (photo, bio, links)"
                    checked={canEditPage}
                    onChange={setCanEditPage}
                    disabled={sending}
                  />
                  <PermCheckbox
                    label="Book solo sessions"
                    description="Can book regular studio time"
                    checked={canBookSessions}
                    onChange={setCanBookSessions}
                    disabled={sending}
                  />
                  <PermCheckbox
                    label="Book band sessions"
                    description="Can create split-pay band bookings (Phase 3)"
                    checked={canBookBand}
                    onChange={setCanBookBand}
                    disabled={sending}
                  />
                  <PermCheckbox
                    label="Manage members"
                    description="Can invite, remove, and edit other members' permissions"
                    checked={canManageMembers}
                    onChange={setCanManageMembers}
                    disabled={sending}
                  />
                </div>
                <p className="font-mono text-xs text-black/50 mt-3">
                  Admins get all permissions by default unless you uncheck them.
                </p>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  disabled={sending || !email.trim()}
                  className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-6 py-3 hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
                >
                  {sending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Sending...
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4" /> Send invite
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetInviteForm();
                    setInviteOpen(false);
                  }}
                  disabled={sending}
                  className="border-2 border-black text-black font-mono text-sm font-bold uppercase tracking-wider px-6 py-3 hover:bg-black hover:text-white disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div>
          <h3 className="text-heading-sm mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-accent" />
            PENDING INVITES
          </h3>
          <div className="space-y-2">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="border-2 border-black/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm font-bold truncate">{invite.invited_email}</p>
                  <p className="font-mono text-xs text-black/60 mt-0.5">
                    Role: <span className="font-semibold uppercase">{invite.role}</span>
                    {invite.band_role && <> · {invite.band_role}</>}
                    {' · '}
                    Expires {fmtStampDate(invite.expires_at)}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleCancelInvite(invite.id)}
                    disabled={pendingOp === `invite-${invite.id}`}
                    className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 border-2 border-black/20 hover:border-red-500 hover:text-red-600 disabled:opacity-50 transition-colors inline-flex items-center gap-1 flex-shrink-0"
                  >
                    {pendingOp === `invite-${invite.id}` ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <X className="w-3 h-3" />
                    )}
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current members */}
      <div>
        <h3 className="text-heading-sm mb-4">LINEUP ({members.length})</h3>
        <div className="space-y-2">
          {members.map((m) => {
            const profile = profileLookup[m.user_id];
            const displayName = m.stage_name || profile?.display_name || '(unnamed)';
            const isMe = m.user_id === currentUserId;
            const canRemove = canManage && !isOwner(m) && !isMe;

            return (
              <div
                key={m.id}
                className="border-2 border-black/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-mono text-sm font-bold truncate">
                      {displayName}
                      {isMe && (
                        <span className="ml-2 font-mono text-[10px] text-black/50 font-normal">
                          (you)
                        </span>
                      )}
                    </p>
                    <span
                      className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 inline-flex items-center gap-1 ${
                        m.role === 'owner'
                          ? 'bg-accent text-black'
                          : m.role === 'admin'
                          ? 'bg-black text-white'
                          : 'bg-black/10 text-black/70'
                      }`}
                    >
                      {m.role === 'owner' && <Crown className="w-3 h-3" />}
                      {m.role}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-black/60 mt-0.5">
                    {m.band_role || <span className="italic">No instrument set</span>}
                    {profile?.display_name && m.stage_name && (
                      <> · aka {profile.display_name}</>
                    )}
                  </p>
                  {/* Permission pills */}
                  {(m.can_edit_public_page ||
                    m.can_book_sessions ||
                    m.can_book_band_sessions ||
                    m.can_manage_members ||
                    m.role === 'owner') && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(m.role === 'owner' || m.can_edit_public_page) && (
                        <Pill>Edit page</Pill>
                      )}
                      {(m.role === 'owner' || m.can_book_sessions) && (
                        <Pill>Book sessions</Pill>
                      )}
                      {(m.role === 'owner' || m.can_book_band_sessions) && (
                        <Pill>Band sessions</Pill>
                      )}
                      {(m.role === 'owner' || m.can_manage_members) && (
                        <Pill>Manage</Pill>
                      )}
                    </div>
                  )}
                </div>
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(m.id, displayName)}
                    disabled={pendingOp === `member-${m.id}`}
                    className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 border-2 border-black/20 hover:border-red-500 hover:text-red-600 disabled:opacity-50 transition-colors inline-flex items-center gap-1 flex-shrink-0"
                  >
                    {pendingOp === `member-${m.id}` ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PermCheckbox({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-3 border-2 border-black/10 p-3 cursor-pointer hover:border-black/30 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 accent-black"
        disabled={disabled}
      />
      <div>
        <p className="font-mono text-sm font-bold">{label}</p>
        <p className="font-mono text-xs text-black/60 mt-0.5">{description}</p>
      </div>
    </label>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-black/5 text-black/70">
      {children}
    </span>
  );
}
