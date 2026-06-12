import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { memberHasFlag } from '@/lib/bands';
import { getMembership } from '@/lib/bands-server';

/**
 * DELETE /api/bands/[id]/members/[memberId] — remove a member from the band.
 *
 * Guardrails:
 *   - Caller must have `can_manage_members`
 *   - Owners cannot be removed via this endpoint (ownership transfer is separate)
 *   - A user cannot remove themselves via this endpoint ("leave the band" is a
 *     different flow TBD)
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const { id: bandId, memberId } = await params;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const membership = await getMembership(bandId, user.id);
  if (!membership || !memberHasFlag(membership, 'can_manage_members')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = createServiceClient();

  // Load the target member.
  const { data: target } = await supabase
    .from('band_members')
    .select('id, band_id, user_id, role')
    .eq('id', memberId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  if (target.band_id !== bandId) {
    return NextResponse.json({ error: 'Member does not belong to this band' }, { status: 400 });
  }
  if (target.role === 'owner') {
    return NextResponse.json(
      { error: 'Owners cannot be removed. Transfer ownership first.' },
      { status: 400 }
    );
  }
  if (target.user_id === user.id) {
    return NextResponse.json(
      { error: 'You can\'t remove yourself via this endpoint. Use "leave band" instead.' },
      { status: 400 }
    );
  }

  const { error } = await supabase.from('band_members').delete().eq('id', memberId);
  if (error) {
    console.error('[bands:member:remove] failed:', error);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
