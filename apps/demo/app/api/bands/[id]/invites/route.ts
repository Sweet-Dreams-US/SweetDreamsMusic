import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { memberHasFlag, generateInviteToken } from '@/lib/bands';
import { getMembership } from '@/lib/bands-server';
import { sendBandInviteEmail } from '@/lib/email';

/**
 * POST /api/bands/[id]/invites — create a new invite for the band.
 *
 * Gate: caller must be a member with `can_manage_members` (or owner). Email is
 * validated, an active invite to the same (band, email) pair is cleaned up
 * (re-invite flow), and an email is dispatched with the acceptance link.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bandId } = await params;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const membership = await getMembership(bandId, user.id);
  if (!membership) return NextResponse.json({ error: 'Not a member of this band' }, { status: 403 });
  if (!memberHasFlag(membership, 'can_manage_members')) {
    return NextResponse.json({ error: 'You don\'t have permission to invite members' }, { status: 403 });
  }

  let body: {
    invited_email?: string;
    role?: 'admin' | 'member';
    stage_name?: string | null;
    band_role?: string | null;
    can_edit_public_page?: boolean;
    can_book_sessions?: boolean;
    can_book_band_sessions?: boolean;
    can_manage_members?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const email = body.invited_email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  const role = body.role === 'admin' ? 'admin' : 'member';
  const supabase = createServiceClient();

  // Load the band so we can include the name in the email.
  const { data: band } = await supabase
    .from('bands')
    .select('id, display_name, slug')
    .eq('id', bandId)
    .single();
  if (!band) return NextResponse.json({ error: 'Band not found' }, { status: 404 });

  // Check: is the email already a member? (by joining profiles)
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('email', email)
    .maybeSingle();
  if (existingProfile) {
    const { data: existingMember } = await supabase
      .from('band_members')
      .select('id')
      .eq('band_id', bandId)
      .eq('user_id', existingProfile.user_id)
      .maybeSingle();
    if (existingMember) {
      return NextResponse.json(
        { error: 'That user is already a member of this band' },
        { status: 409 }
      );
    }
  }

  // Cancel any existing active invite for this (band, email) so the partial
  // unique index doesn't trip us up. Treat re-invite as "cancel + resend".
  await supabase
    .from('band_invites')
    .update({ rejected_at: new Date().toISOString() })
    .eq('band_id', bandId)
    .ilike('invited_email', email)
    .is('accepted_at', null)
    .is('rejected_at', null);

  // Admins get all permissions true by default, members inherit the checked
  // permissions passed in the request.
  const flagDefault = role === 'admin';
  const inviteRecord = {
    band_id: bandId,
    invited_email: email,
    invited_by: user.id,
    token: generateInviteToken(),
    role,
    stage_name: body.stage_name?.trim() || null,
    band_role: body.band_role?.trim() || null,
    can_edit_public_page: body.can_edit_public_page ?? flagDefault,
    can_book_sessions: body.can_book_sessions ?? flagDefault,
    can_book_band_sessions: body.can_book_band_sessions ?? flagDefault,
    can_manage_members: body.can_manage_members ?? flagDefault,
  };

  const { data: invite, error: insertErr } = await supabase
    .from('band_invites')
    .insert(inviteRecord)
    .select()
    .single();

  if (insertErr || !invite) {
    console.error('[bands:invite] insert failed:', insertErr);
    return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 });
  }

  // Fire and forget — don't block the response on email delivery.
  sendBandInviteEmail({
    toEmail: email,
    bandName: band.display_name,
    inviterName: user.profile?.display_name || user.email,
    role,
    token: invite.token,
  }).catch((err) => {
    console.error('[bands:invite] email send failed (non-fatal):', err);
  });

  return NextResponse.json({ invite });
}
