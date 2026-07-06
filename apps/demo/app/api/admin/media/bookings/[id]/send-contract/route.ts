// app/api/admin/media/bookings/[id]/send-contract/route.ts
//
// Media Projects — manager SIGNS the contract ON SEND, and emails the artist a
// "your contract is ready to review & sign" link.
//
// This is the manager half of the dual-signature lifecycle. The manager
// reviews + signs by sending: we stamp manager_agreed_at / manager_agreed_by
// (idempotent) and email the artist a deep link to their order page where they
// add their signature via /api/media/bookings/[id]/agree.
//
// After stamping, we call finalizeIfBothSigned — if the artist had ALREADY
// signed (unusual ordering, but possible), the manager's signature completes
// the contract and finalize runs here. Normally the artist signs second and
// finalize runs from the agree route. Either order is covered.
//
// Auth: verifyMediaManagerAccess (media managers + admins).
// Idempotent: re-sending re-emails the artist but does not re-stamp/re-audit
// the manager signature.
// Guard: refuses if there are no contract terms to send.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyMediaManagerAccess } from '@/lib/admin-auth';
import { sendMediaContractForSignature } from '@/lib/email';
import { finalizeIfBothSigned } from '@/lib/media-contract-finalize';
import { generateContractPublicToken } from '@/lib/contract-token';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Media-team gate ────────────────────────────────────────────────
  const supabase = await createClient();
  if (!(await verifyMediaManagerAccess(supabase))) {
    return NextResponse.json({ error: 'Media team only' }, { status: 403 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  // ── Load booking ───────────────────────────────────────────────────
  const { data: row, error: bErr } = await service
    .from('media_bookings')
    .select('id, user_id, offering_id, contract_terms, manager_agreed_at, contract_agreed_at, public_token')
    .eq('id', id)
    .maybeSingle();
  if (bErr || !row) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }
  const booking = row as {
    id: string;
    user_id: string;
    offering_id: string | null;
    contract_terms: string | null;
    manager_agreed_at: string | null;
    contract_agreed_at: string | null;
    public_token: string | null;
  };

  // Nothing to send if there are no terms authored yet.
  if (!booking.contract_terms || !booking.contract_terms.trim()) {
    return NextResponse.json(
      { error: 'Write the contract terms before sending it to the artist.' },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();
  let stamped = false;

  // ── Stamp the manager signature (idempotent) ───────────────────────
  if (!booking.manager_agreed_at) {
    const { error: updErr } = await service
      .from('media_bookings')
      .update({
        manager_agreed_at: nowIso,
        manager_agreed_by: user.id,
      })
      .eq('id', id)
      // Race guard: only stamp if still unsigned by the manager.
      .is('manager_agreed_at', null);
    if (updErr) {
      console.error('[media/send-contract] manager sign update error:', updErr);
      return NextResponse.json(
        { error: 'Could not record the manager signature' },
        { status: 500 },
      );
    }
    stamped = true;

    await service.from('media_booking_audit_log').insert({
      booking_id: id,
      action: 'contract_sent',
      performed_by: user.email,
      details: {
        manager_agreed_at: nowIso,
        manager_agreed_by: user.id,
      },
    });
  }

  // ── Ensure a no-login public token exists ──────────────────────────
  // The emailed "REVIEW & SIGN" button points the customer at the PUBLIC
  // /contract/<token> page (a brand-new customer has no account, so the
  // account-bound order page would 404 / wall them at login). Mint a strong
  // token here the first time and persist it; reuse it on every resend so the
  // link in any previously-sent email keeps working.
  let publicToken = booking.public_token;
  if (!publicToken) {
    publicToken = generateContractPublicToken();
    const { error: tokErr } = await service
      .from('media_bookings')
      .update({ public_token: publicToken })
      .eq('id', id)
      // Race guard: only set if still null. If a concurrent send already minted
      // one, fall back to re-reading it so we email a valid (existing) token.
      .is('public_token', null);
    if (tokErr) {
      const { data: reread } = await service
        .from('media_bookings')
        .select('public_token')
        .eq('id', id)
        .maybeSingle();
      publicToken =
        (reread as { public_token: string | null } | null)?.public_token ||
        publicToken;
    }
  }

  // ── Email the artist a review-&-sign link ──────────────────────────
  const [{ data: buyerRow }, { data: offeringRow }] = await Promise.all([
    service
      .from('profiles')
      .select('email, display_name')
      .eq('user_id', booking.user_id)
      .maybeSingle(),
    booking.offering_id
      ? service
          .from('media_offerings')
          .select('title')
          .eq('id', booking.offering_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const buyer = buyerRow as
    | { email: string | null; display_name: string | null }
    | null;
  const offeringTitle =
    (offeringRow as { title?: string } | null)?.title || 'your media project';

  if (buyer?.email) {
    try {
      await sendMediaContractForSignature(buyer.email, {
        buyerName: buyer.display_name || 'there',
        offeringTitle,
        bookingId: id,
        publicToken,
      });
    } catch (e) {
      console.error('[media/send-contract] email error:', e);
    }
  }

  // ── Finalize if the artist had already signed (covers either order) ──
  let finalize;
  try {
    finalize = await finalizeIfBothSigned(service, id);
  } catch (e) {
    console.error('[media/send-contract] finalize error:', e);
  }

  return NextResponse.json({
    success: true,
    managerSigned: true,
    newlyStamped: stamped,
    emailedArtist: !!buyer?.email,
    finalized: finalize?.finalized ?? false,
    sessionsCreated: finalize?.sessionsCreated ?? 0,
    warnings: finalize?.warnings ?? [],
  });
}
