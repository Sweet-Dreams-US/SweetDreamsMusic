import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendBandMemberJoinedNotification } from '@/lib/email';

/**
 * POST /api/bands/invites/[token] — accept or reject a pending invite.
 *
 * Body: { action: 'accept' | 'reject' }
 *
 * On accept:
 *   - Creates a band_members row carrying the invite's role + permission flags
 *   - Marks the invite accepted_at
 *   - Returns the bandId so the client can redirect
 *
 * Guardrails:
 *   - Caller must be authenticated AND their auth-verified email must match
 *     invited_email (case-insensitive). We don't trust client-supplied emails.
 *   - Invite must not be expired or already handled.
 *   - If the user is somehow already a member (edge case), we gracefully mark
 *     the invite accepted and return the band — don't double-insert.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { action?: 'accept' | 'reject' };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const action = body.action;
  if (action !== 'accept' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be "accept" or "reject"' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: invite, error: inviteErr } = await supabase
    .from('band_invites')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (inviteErr || !invite) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  }
  if (invite.invited_email.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json(
      { error: 'This invite was sent to a different email address.' },
      { status: 403 }
    );
  }
  if (invite.accepted_at || invite.rejected_at) {
    return NextResponse.json({ error: 'This invite has already been handled.' }, { status: 400 });
  }
  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This invite has expired.' }, { status: 400 });
  }

  // Reject path: mark rejected_at and we're done.
  if (action === 'reject') {
    const { error } = await supabase
      .from('band_invites')
      .update({ rejected_at: new Date().toISOString() })
      .eq('id', invite.id);
    if (error) {
      console.error('[bands:invite:reject] update failed:', error);
      return NextResponse.json({ error: 'Failed to reject invite' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // Accept path: check not already a member, then insert band_members + mark accepted.
  const { data: existingMember } = await supabase
    .from('band_members')
    .select('id')
    .eq('band_id', invite.band_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!existingMember) {
    const { error: insertErr } = await supabase.from('band_members').insert({
      band_id: invite.band_id,
      user_id: user.id,
      role: invite.role,
      stage_name: invite.stage_name,
      band_role: invite.band_role,
      can_edit_public_page: invite.can_edit_public_page,
      can_book_sessions: invite.can_book_sessions,
      can_book_band_sessions: invite.can_book_band_sessions,
      can_manage_members: invite.can_manage_members,
    });

    if (insertErr) {
      console.error('[bands:invite:accept] member insert failed:', insertErr);
      return NextResponse.json({ error: 'Failed to join band' }, { status: 500 });
    }
  }

  // Mark accepted.
  const { error: updateErr } = await supabase
    .from('band_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id);
  if (updateErr) {
    // Non-fatal: the member row is created, just the invite flag didn't flip.
    console.error('[bands:invite:accept] invite update failed (non-fatal):', updateErr);
  }

  // Notify the band's owner and anyone with can_manage_members that a new
  // member just joined. We exclude the joiner themselves (they know) and
  // dedupe by email in case someone appears twice. Fire-and-forget — email
  // delivery failing should never block the accept response.
  if (!existingMember) {
    notifyManagersOfJoin(supabase, invite.band_id, user.id).catch((err) => {
      console.error('[bands:invite:accept] manager notify failed (non-fatal):', err);
    });
  }

  return NextResponse.json({ ok: true, bandId: invite.band_id });
}

// ────────────────────────────────────────────────────────────────────
// Helper: fetch recipients (owner + can_manage_members) and send the
// "new member joined" email. Isolated so the main handler stays readable.
// ────────────────────────────────────────────────────────────────────

async function notifyManagersOfJoin(
  supabase: ReturnType<typeof createServiceClient>,
  bandId: string,
  joinerUserId: string,
) {
  // We don't use PostgREST's implicit joins here — `band_members.user_id`
  // references `auth.users(id)`, not `profiles.user_id`, so the default FK
  // discovery can't resolve the relationship. Instead we follow the pattern
  // already established in app/dashboard/bands/[id]/members/page.tsx: fetch
  // band_members rows, then batch-fetch profiles by user_id.
  const [bandRes, joinerMemberRes, managerRowsRes] = await Promise.all([
    supabase.from('bands').select('id, display_name').eq('id', bandId).maybeSingle(),
    supabase
      .from('band_members')
      .select('role, stage_name')
      .eq('band_id', bandId)
      .eq('user_id', joinerUserId)
      .maybeSingle(),
    // Owner OR anyone with can_manage_members flag. `.or()` uses the PostgREST
    // OR syntax: "filter1,filter2" means "filter1 OR filter2".
    supabase
      .from('band_members')
      .select('user_id, role, can_manage_members')
      .eq('band_id', bandId)
      .or('role.eq.owner,can_manage_members.eq.true'),
  ]);

  const band = bandRes.data as { id: string; display_name: string } | null;
  if (!band) return;

  const joinerMember = joinerMemberRes.data as
    | { role: 'admin' | 'member'; stage_name: string | null }
    | null;
  const joinerRole = joinerMember?.role === 'admin' ? 'admin' : 'member';

  // Collect recipient user_ids (everyone except the joiner themselves).
  const managerRows = (managerRowsRes.data || []) as Array<{
    user_id: string;
    role: string;
    can_manage_members: boolean;
  }>;
  const recipientUserIds = managerRows
    .filter((r) => r.user_id !== joinerUserId)
    .map((r) => r.user_id);

  // Also grab the joiner's profile in the same batch to get their display_name.
  const lookupIds = Array.from(new Set([...recipientUserIds, joinerUserId]));
  if (lookupIds.length === 0) return;

  const { data: profileRows } = await supabase
    .from('profiles')
    .select('user_id, display_name, email')
    .in('user_id', lookupIds);

  const profileByUserId = new Map<string, { display_name: string | null; email: string | null }>();
  for (const row of (profileRows || []) as Array<{
    user_id: string;
    display_name: string | null;
    email: string | null;
  }>) {
    profileByUserId.set(row.user_id, { display_name: row.display_name, email: row.email });
  }

  // Prefer stage_name (band-specific identity), then profile display_name.
  // We skip falling back to the joiner's email because leaking PII into every
  // band manager's inbox isn't the kind of notification we want.
  const joinerProfile = profileByUserId.get(joinerUserId);
  const joinerName = joinerMember?.stage_name || joinerProfile?.display_name || 'A new member';

  // Dedupe recipient emails (case-insensitive) and drop any blanks.
  const recipients = new Set<string>();
  for (const userId of recipientUserIds) {
    const email = profileByUserId.get(userId)?.email?.trim().toLowerCase();
    if (email) recipients.add(email);
  }
  if (recipients.size === 0) return;

  await sendBandMemberJoinedNotification(Array.from(recipients), {
    bandName: band.display_name,
    bandId: band.id,
    joinerName,
    joinerRole,
  });
}
