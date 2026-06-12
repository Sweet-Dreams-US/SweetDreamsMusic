// app/api/packages/entitlements/[id]/addon-request/route.ts
//
// POST — customer requests more of a package element. Body:
//   {
//     request_type: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom',
//     quantity: number,
//     media_offering_id?: string,
//     notes?: string
//   }
//
// Auth: logged-in user must own the entitlement (user_id) or be a member
// of the band that owns it (any band member can request — admin will
// confirm with the band before fulfilling).
//
// Side effects: inserts a row in package_addon_requests with status='pending',
// notifies admins via Sweet Dreams thread mirror + email so they can
// generate a follow-up quote.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { mirrorToThread } from '@/lib/messaging-mirror';
import { Resend } from 'resend';
import { SUPER_ADMINS, SITE_URL } from '@/lib/constants';
import { emailIdentity } from '@/lib/email';

const resend = new Resend(process.env.RESEND_API_KEY);

interface AddonRequestBody {
  request_type?: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
  quantity?: number;
  media_offering_id?: string | null;
  notes?: string | null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id: entitlementId } = await params;
  if (!entitlementId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: AddonRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.request_type || !['studio_hours', 'media_offering', 'beat_credit', 'custom'].includes(body.request_type)) {
    return NextResponse.json({ error: 'request_type required' }, { status: 400 });
  }
  if (typeof body.quantity !== 'number' || body.quantity <= 0) {
    return NextResponse.json({ error: 'quantity must be > 0' }, { status: 400 });
  }

  const service = createServiceClient();

  // Pull entitlement + verify ownership/membership.
  const { data: entRow, error: entErr } = await service
    .from('package_entitlements')
    .select('id, user_id, band_id, template_id, status, ends_at')
    .eq('id', entitlementId)
    .maybeSingle();
  if (entErr || !entRow) {
    return NextResponse.json({ error: 'Entitlement not found' }, { status: 404 });
  }
  type Ent = { id: string; user_id: string | null; band_id: string | null; template_id: string; status: string; ends_at: string };
  const ent = entRow as Ent;

  if (ent.status !== 'active') {
    return NextResponse.json({ error: 'Cannot request add-ons for an inactive entitlement.' }, { status: 400 });
  }

  // Authorize: user owns it OR is a band member.
  let authorized = false;
  if (ent.user_id && ent.user_id === user.id) {
    authorized = true;
  } else if (ent.band_id) {
    const { data: membership } = await service
      .from('band_members')
      .select('role')
      .eq('band_id', ent.band_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membership) authorized = true;
  }
  if (!authorized) {
    return NextResponse.json({ error: 'Not authorized to request add-ons for this entitlement.' }, { status: 403 });
  }

  // Insert the request.
  const { data: created, error: insertErr } = await service
    .from('package_addon_requests')
    .insert({
      entitlement_id: entitlementId,
      requested_by_user_id: user.id,
      request_type: body.request_type,
      quantity: body.quantity,
      media_offering_id: body.media_offering_id ?? null,
      notes: body.notes?.trim() || null,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertErr || !created) {
    console.error('[addon-request] insert:', insertErr);
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  // Notify admins. We do this best-effort — the request is already
  // saved, so a notification failure doesn't roll it back.
  try {
    // Look up the template name for context.
    const { data: tpl } = await service
      .from('package_templates')
      .select('name')
      .eq('id', ent.template_id)
      .maybeSingle();
    const tplName = (tpl as { name: string } | null)?.name ?? 'package';

    const requesterName = user.profile?.display_name ?? user.email.split('@')[0];
    const qtyLabel =
      body.request_type === 'studio_hours' ? `${body.quantity} more studio hour${body.quantity === 1 ? '' : 's'}` :
      body.request_type === 'beat_credit' ? `${body.quantity} more beat credit${body.quantity === 1 ? '' : 's'}` :
      body.request_type === 'media_offering' ? `1 more media offering` :
      `${body.quantity} more (custom)`;

    // In-app: drop a system message into requester's Sweet Dreams thread.
    await mirrorToThread({
      userId: user.id,
      kind: 'update',
      subject: 'Add-on request submitted',
      body: `Your request for ${qtyLabel} on "${tplName}" has been sent to admin. They'll generate a follow-up quote at your discounted rate.${body.notes ? `\n\nYour note: ${body.notes}` : ''}`,
    });

    // Email admins. Reply-to the requester so admin's reply lands in
    // their inbox.
    await resend.emails.send({
      from: await emailIdentity(),
      to: [...SUPER_ADMINS],
      replyTo: user.email,
      subject: `Add-on request: ${qtyLabel} on ${tplName}`,
      html: `
        <h2 style="font-family:monospace;color:#F4C430">PACKAGE ADD-ON REQUEST</h2>
        <p><strong>${requesterName}</strong> wants <strong>${qtyLabel}</strong> on their <em>${tplName}</em>.</p>
        ${body.notes ? `<blockquote style="border-left:3px solid #F4C430;padding:10px 16px;background:#f8f8f8"><p style="margin:0;white-space:pre-wrap">${body.notes}</p></blockquote>` : ''}
        <p style="font-size:12px;color:#666">Reply to this email to talk to ${requesterName} directly.</p>
        <p><a href="${SITE_URL}/admin#packages" style="display:inline-block;background:#F4C430;color:#000;padding:12px 24px;text-decoration:none;font-weight:bold">Open admin</a></p>
      `,
    });
  } catch (e) {
    // Non-fatal.
    console.error('[addon-request] notify error:', e);
  }

  return NextResponse.json({ ok: true, id: (created as { id: string }).id });
}
