// app/api/media/bookings/[id]/package/route.ts
//
// Round 8c: GET fetches the package + line items for any viewer role
// allowed by RLS. PUT lets admin replace the package — line items get
// truncated and re-inserted in a single batch with auto-injection of
// a planning_call when the rule fires.
//
// Approval-frozen guard: once status === 'approved', PUT is rejected so
// admin can't silently change a contracted scope. Live edit is fine in
// 'draft' and 'sent' states.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import {
  type LineItem,
  type LineItemKind,
  LINE_ITEM_KINDS,
  ensurePlanningCallInjection,
  computePackageTotalCents,
  lineItemTotalCents,
} from '@/lib/media-packages';

interface IncomingLineItem {
  id?: string;
  kind: LineItemKind;
  source_slot_key?: string | null;
  label: string;
  qty: number;
  unit_cents: number;
  notes?: string | null;
  sort_order?: number;
}

async function userHasReadAccess(
  service: ReturnType<typeof createServiceClient>,
  user: { id: string; role: string },
  bookingId: string,
): Promise<boolean> {
  if (user.role === 'admin') return true;
  const { data: bookingRow } = await service
    .from('media_bookings')
    .select('user_id, band_id')
    .eq('id', bookingId)
    .maybeSingle();
  if (!bookingRow) return false;
  const b = bookingRow as { user_id: string; band_id: string | null };
  if (b.user_id === user.id) return true;
  if (b.band_id) {
    const { data: m } = await service
      .from('band_members')
      .select('id')
      .eq('band_id', b.band_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (m) return true;
  }
  const { data: s } = await service
    .from('media_session_bookings')
    .select('id')
    .eq('parent_booking_id', bookingId)
    .eq('engineer_id', user.id)
    .limit(1)
    .maybeSingle();
  return !!s;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  if (!(await userHasReadAccess(service, user, id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: pkgRow } = await service
    .from('media_booking_packages')
    .select('*')
    .eq('booking_id', id)
    .maybeSingle();
  if (!pkgRow) {
    return NextResponse.json({ package: null, line_items: [] });
  }

  const { data: items } = await service
    .from('media_booking_line_items')
    .select('*')
    .eq('package_id', (pkgRow as { id: string }).id)
    .order('sort_order', { ascending: true });

  return NextResponse.json({
    package: pkgRow,
    line_items: items ?? [],
  });
}

// Admin replaces the package (notes + entire line item list).
// Idempotent: re-running with the same shape yields the same DB state.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'media_manager') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const incoming = Array.isArray(body.line_items) ? body.line_items : null;
  if (!incoming) {
    return NextResponse.json({ error: 'line_items array required' }, { status: 400 });
  }
  const notes = typeof body.notes === 'string' ? body.notes : null;

  // Validate each line item shape.
  const validated: IncomingLineItem[] = [];
  for (let i = 0; i < incoming.length; i++) {
    const raw = incoming[i] as Record<string, unknown>;
    const kind = typeof raw.kind === 'string' ? raw.kind : '';
    if (!LINE_ITEM_KINDS.includes(kind as LineItemKind)) {
      return NextResponse.json(
        { error: `Line item ${i + 1}: invalid kind '${kind}'` },
        { status: 400 },
      );
    }
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    if (!label) {
      return NextResponse.json(
        { error: `Line item ${i + 1}: label required` },
        { status: 400 },
      );
    }
    const qty = Number(raw.qty);
    const unit = Number(raw.unit_cents);
    if (!Number.isInteger(qty) || qty < 1) {
      return NextResponse.json(
        { error: `Line item ${i + 1}: qty must be positive integer` },
        { status: 400 },
      );
    }
    if (!Number.isInteger(unit) || unit < 0) {
      return NextResponse.json(
        { error: `Line item ${i + 1}: unit_cents must be non-negative integer` },
        { status: 400 },
      );
    }
    validated.push({
      kind: kind as LineItemKind,
      source_slot_key: typeof raw.source_slot_key === 'string' ? raw.source_slot_key : null,
      label,
      qty,
      unit_cents: unit,
      notes: typeof raw.notes === 'string' ? raw.notes : null,
      sort_order: Number(raw.sort_order) || i,
    });
  }

  // Auto-inject planning_call if rule fires.
  const { items: withInjection, injected } = ensurePlanningCallInjection(
    validated,
    (): IncomingLineItem => ({
      kind: 'planning_call',
      label: 'Planning call (initial scope + storyboard)',
      qty: 1,
      unit_cents: 0,
      notes:
        'Auto-added because this package includes a music video or more than 2 shorts. Required before scheduling.',
      sort_order: -1,
    }),
  );

  const service = createServiceClient();

  // Read existing package to enforce frozen status.
  const { data: existing } = await service
    .from('media_booking_packages')
    .select('id, status')
    .eq('booking_id', id)
    .maybeSingle();
  const existingPkg = existing as { id: string; status: string } | null;

  if (existingPkg?.status === 'approved') {
    return NextResponse.json(
      { error: 'Package is approved — cannot edit. Open a new conversation if scope needs to change.' },
      { status: 409 },
    );
  }

  // Compute totals + insert/update.
  const itemsForInsert = withInjection.map((it, i) => ({
    kind: it.kind,
    source_slot_key: it.source_slot_key ?? null,
    label: it.label,
    qty: it.qty,
    unit_cents: it.unit_cents,
    total_cents: lineItemTotalCents(it.qty, it.unit_cents),
    notes: it.notes ?? null,
    sort_order: typeof it.sort_order === 'number' ? it.sort_order : i,
  }));
  const totalCents = computePackageTotalCents(itemsForInsert);

  let pkgId: string;
  // Track how many line items had been previously approved so we can
  // surface that to the buyer (and audit it). Editing a sent package
  // wipes the approval state — the buyer should see why.
  let priorApprovedCount = 0;
  if (existingPkg) {
    pkgId = existingPkg.id;
    const { error: pkgUpdErr } = await service.from('media_booking_packages').update({
      total_cents: totalCents,
      notes,
    }).eq('id', pkgId);
    if (pkgUpdErr) {
      return NextResponse.json(
        { error: `Could not update package: ${pkgUpdErr.message}` },
        { status: 500 },
      );
    }
    // Count approved items before we wipe them.
    const { data: priorItems } = await service
      .from('media_booking_line_items')
      .select('approval_status')
      .eq('package_id', pkgId)
      .eq('approval_status', 'approved');
    priorApprovedCount = (priorItems ?? []).length;

    // Truncate + re-insert. Approval state from previous draft is wiped — by
    // design: editing a sent package re-sends for approval anyway. The chat
    // thread + audit log preserve the diff for human review.
    const { error: delErr } = await service
      .from('media_booking_line_items')
      .delete()
      .eq('package_id', pkgId);
    if (delErr) {
      return NextResponse.json(
        { error: `Could not clear old line items: ${delErr.message}` },
        { status: 500 },
      );
    }
  } else {
    const { data: created, error: createErr } = await service
      .from('media_booking_packages')
      .insert({ booking_id: id, status: 'draft', total_cents: totalCents, notes })
      .select('id')
      .single();
    if (createErr || !created) {
      return NextResponse.json(
        { error: `Could not create package: ${createErr?.message}` },
        { status: 500 },
      );
    }
    pkgId = (created as { id: string }).id;
  }

  if (itemsForInsert.length > 0) {
    const { error: insErr } = await service
      .from('media_booking_line_items')
      .insert(itemsForInsert.map((it) => ({ package_id: pkgId, ...it })));
    if (insErr) {
      return NextResponse.json(
        { error: `Could not insert line items: ${insErr.message}` },
        { status: 500 },
      );
    }
  }

  await service.from('media_booking_audit_log').insert({
    booking_id: id,
    action: existingPkg ? 'package_edited' : 'package_created',
    performed_by: user.email,
    details: {
      package_id: pkgId,
      line_item_count: itemsForInsert.length,
      planning_call_auto_injected: injected,
      total_cents: totalCents,
      prior_approved_count_cleared: priorApprovedCount,
    },
  });

  // If the buyer had approved any items before this edit, drop a system
  // message into the chat so they don't quietly find their approvals
  // wiped without explanation. Round 8b chat thread is the right surface.
  if (existingPkg && priorApprovedCount > 0) {
    const adminName = user.profile?.display_name ?? user.email.split('@')[0];
    await service.from('media_booking_messages').insert({
      booking_id: id,
      author_user_id: null,
      author_role: 'system',
      body: `${adminName} edited the package. ${priorApprovedCount} previously-approved line item${priorApprovedCount === 1 ? '' : 's'} need to be re-approved.`,
      attachments: [],
    });
  }

  // Return the fresh package for the UI.
  const { data: freshPkg } = await service
    .from('media_booking_packages')
    .select('*')
    .eq('id', pkgId)
    .single();
  const { data: freshItems } = await service
    .from('media_booking_line_items')
    .select('*')
    .eq('package_id', pkgId)
    .order('sort_order', { ascending: true });

  return NextResponse.json({
    package: freshPkg,
    line_items: (freshItems ?? []) as LineItem[],
    planning_call_auto_injected: injected,
  });
}
