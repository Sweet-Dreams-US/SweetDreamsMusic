import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { memberHasFlag } from '@/lib/bands';
import { getMembership } from '@/lib/bands-server';

/**
 * DELETE /api/bands/[id]/invites/[inviteId] — cancel a pending invite.
 *
 * We mark it rejected (rather than hard-delete) so the partial unique index
 * allows a new invite to the same email, and so there's a paper trail.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; inviteId: string }> }
) {
  const { id: bandId, inviteId } = await params;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const membership = await getMembership(bandId, user.id);
  if (!membership || !memberHasFlag(membership, 'can_manage_members')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = createServiceClient();

  // Ensure the invite belongs to this band (prevents cross-band manipulation).
  const { data: invite } = await supabase
    .from('band_invites')
    .select('id, band_id, accepted_at, rejected_at')
    .eq('id', inviteId)
    .maybeSingle();
  if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  if (invite.band_id !== bandId) {
    return NextResponse.json({ error: 'Invite does not belong to this band' }, { status: 400 });
  }
  if (invite.accepted_at) {
    return NextResponse.json({ error: 'Invite has already been accepted' }, { status: 400 });
  }

  const { error } = await supabase
    .from('band_invites')
    .update({ rejected_at: new Date().toISOString() })
    .eq('id', inviteId);

  if (error) {
    console.error('[bands:invite:cancel] failed:', error);
    return NextResponse.json({ error: 'Failed to cancel invite' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
