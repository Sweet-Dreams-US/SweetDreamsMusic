// app/api/admin/media/bookings/contract/route.ts
//
// CONTRACT BUILDER — one cohesive create path for a full media project.
//
// This is the "New Project as a CONTRACT" backend. It composes the four
// existing systems (buyer pick-or-invite, the package/line-item deliverable
// system, the installment plan, and the free-text contract terms) into a
// single transactional-feeling POST so the new contract-builder UI can
// create everything in one round trip:
//
//   1. PRODUCTION LOGISTICS  → media_bookings.project_details.planned_shoots
//                              (+ project_details.total_duration_hours sum).
//                              NO media_session_bookings are created here —
//                              the finalize step (separate agent) materializes
//                              real calendar sessions once BOTH parties sign
//                              (contract_agreed_at + manager_agreed_at).
//   2. DELIVERABLES          → a media_booking_packages row + its
//                              media_booking_line_items (reuses lib/media-packages
//                              shape + the exact persistence path PUT
//                              /api/media/bookings/[id]/package uses).
//   3. TOTAL INVESTMENT      → sum of line-item total_cents = package.total_cents.
//                              media_bookings.final_price_cents is set to that
//                              total so the installment plan validates against it.
//   4. INSTALLMENTS          → media_payment_installments rows. SUM must equal
//                              final_price_cents (same rule as
//                              POST /api/admin/media/bookings/[id]/installments).
//   5. CONTRACT TERMS        → media_bookings.contract_terms (free text).
//
// Buyer selection mirrors /manual: user_id (existing) OR buyer_email (invite).
//
// Auth: verifyMediaManagerAccess (media managers + admins), same gate as
// /manual and /installments.
//
// The booking is created as an UNPAID 'inquiry' shell (like /manual's 'plan'
// mode): no charge, no payment email here. Per-stint payment links are sent
// later from the project detail panel after both parties sign the contract.
//
// FREE ADD-ONS: a line item with unit_cents === 0 OR is_free_addon === true is
// a free deliverable. Its note is augmented with the standard
// "subject to SD socials collaboration" clause so the artist sees the terms.
//
// ── REQUEST BODY ──────────────────────────────────────────────────────
// {
//   // Buyer — exactly one of:
//   user_id?: string,                 // existing buyer
//   buyer_email?: string,             // OR invite by email
//   buyer_name?: string,              // optional display name for a new artist
//
//   offering_id: string,              // which offering this project is under
//   band_id?: string | null,
//   notes_to_us?: string | null,
//   customer_phone?: string | null,
//   contract_terms?: string,          // free-text terms (section 5)
//
//   // Section 1 — production logistics:
//   planned_shoots?: [{
//     date: 'YYYY-MM-DD',
//     start_time: 'HH:MM',
//     duration_hours: number,
//     location: 'studio' | 'external',
//     external_location_text?: string | null,
//     engineer_name?: string | null,
//     session_kind?: string | null,
//   }],
//
//   // Section 2 — deliverables (persisted via the package system):
//   lineItems: [{
//     kind: LineItemKind,
//     label: string,
//     qty: number,
//     unit_cents: number,
//     source_slot_key?: string | null,
//     notes?: string | null,
//     is_free_addon?: boolean,
//   }],
//   package_notes?: string | null,
//
//   // Section 4 — installments (optional; if omitted, no plan is created):
//   installments?: [{
//     label: string,
//     amount_cents: number,
//     due_date?: 'YYYY-MM-DD' | null,
//   }],
// }
//
// ── RESPONSE ──────────────────────────────────────────────────────────
// 200 {
//   success: true,
//   bookingId: string,
//   userId: string,
//   final_price_cents: number,       // = package total = installment sum
//   package: { id, total_cents, line_item_count },
//   planned_shoots_count: number,
//   total_duration_hours: number,
//   installments_count: number,
//   planning_call_auto_injected: boolean,
//   artistInvited: boolean,
//   artistCreated: boolean,
// }
// 4xx { error: string, ...context }

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyMediaManagerAccess } from '@/lib/admin-auth';
import { resolveOrInviteArtist } from '@/lib/media-installments-server';
import {
  type LineItemKind,
  LINE_ITEM_KINDS,
  ensurePlanningCallInjection,
  computePackageTotalCents,
  lineItemTotalCents,
} from '@/lib/media-packages';

// Standard clause appended to a free add-on's note.
const FREE_ADDON_CLAUSE = 'subject to SD socials collaboration';

const SHOOT_LOCATIONS = ['studio', 'external'] as const;
type ShootLocation = (typeof SHOOT_LOCATIONS)[number];

interface PlannedShoot {
  date: string;
  start_time: string;
  duration_hours: number;
  location: ShootLocation;
  external_location_text: string | null;
  // Media manager IN CHARGE of this shoot. We store the chosen manager's
  // user_id (re-verified + resolved to media_manager_id at finalize) plus a
  // display name for the contract/UI. engineer_name is retained for backward
  // compatibility with any older stashed shoots.
  manager_user_id: string | null;
  manager_name: string | null;
  engineer_name: string | null;
  session_kind: string | null;
}

interface NormalizedLineItem {
  kind: LineItemKind;
  source_slot_key: string | null;
  label: string;
  qty: number;
  unit_cents: number;
  notes: string | null;
  sort_order: number;
  is_free_addon: boolean;
}

interface NormalizedStint {
  label: string;
  amount_cents: number;
  due_date: string | null;
}

export async function POST(request: NextRequest) {
  // ── Media-team gate (media managers + admins) ──────────────────────
  const supabase = await createClient();
  if (!(await verifyMediaManagerAccess(supabase))) {
    return NextResponse.json({ error: 'Media team only' }, { status: 403 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  // ── Parse ───────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // ── Buyer selection (mirror /manual) ───────────────────────────────
  const userIdInput = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  const buyerEmailInput =
    typeof body.buyer_email === 'string' ? body.buyer_email.trim().toLowerCase() : '';
  const buyerNameInput =
    typeof body.buyer_name === 'string' && body.buyer_name.trim() ? body.buyer_name.trim() : null;

  if (!userIdInput && !buyerEmailInput) {
    return NextResponse.json(
      { error: 'Provide either user_id (existing buyer) or buyer_email (invite)' },
      { status: 400 },
    );
  }

  const offeringId = typeof body.offering_id === 'string' ? body.offering_id.trim() : '';
  if (!offeringId) {
    return NextResponse.json({ error: 'offering_id is required' }, { status: 400 });
  }

  const bandId = typeof body.band_id === 'string' && body.band_id.trim() ? body.band_id.trim() : null;
  const notesToUs = typeof body.notes_to_us === 'string' ? body.notes_to_us.trim() || null : null;
  const customerPhone =
    typeof body.customer_phone === 'string' ? body.customer_phone.trim() || null : null;
  const contractTerms =
    typeof body.contract_terms === 'string' && body.contract_terms.trim()
      ? body.contract_terms.trim()
      : null;
  const packageNotes =
    typeof body.package_notes === 'string' ? body.package_notes.trim() || null : null;

  // ── Section 1: validate planned_shoots ─────────────────────────────
  const rawShoots = Array.isArray(body.planned_shoots) ? body.planned_shoots : [];
  const plannedShoots: PlannedShoot[] = [];
  for (let i = 0; i < rawShoots.length; i++) {
    const raw = rawShoots[i] as Record<string, unknown>;
    const date = typeof raw?.date === 'string' ? raw.date.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: `Shoot #${i + 1}: date must be YYYY-MM-DD` },
        { status: 400 },
      );
    }
    const startTime = typeof raw?.start_time === 'string' ? raw.start_time.slice(0, 5) : '';
    if (!/^\d{2}:\d{2}$/.test(startTime)) {
      return NextResponse.json(
        { error: `Shoot #${i + 1}: start_time must be HH:MM` },
        { status: 400 },
      );
    }
    const dur = Number(raw?.duration_hours);
    if (!Number.isFinite(dur) || dur <= 0) {
      return NextResponse.json(
        { error: `Shoot #${i + 1}: duration_hours must be a positive number` },
        { status: 400 },
      );
    }
    const location = (typeof raw?.location === 'string' ? raw.location : '') as ShootLocation;
    if (!SHOOT_LOCATIONS.includes(location)) {
      return NextResponse.json(
        { error: `Shoot #${i + 1}: location must be 'studio' or 'external'` },
        { status: 400 },
      );
    }
    const externalText =
      typeof raw?.external_location_text === 'string' && raw.external_location_text.trim()
        ? raw.external_location_text.trim()
        : null;
    if (location === 'external' && !externalText) {
      return NextResponse.json(
        { error: `Shoot #${i + 1}: external_location_text is required for external shoots` },
        { status: 400 },
      );
    }
    plannedShoots.push({
      date,
      start_time: startTime,
      duration_hours: dur,
      location,
      external_location_text: externalText,
      manager_user_id:
        typeof raw?.manager_user_id === 'string' && raw.manager_user_id.trim()
          ? raw.manager_user_id.trim()
          : null,
      manager_name:
        typeof raw?.manager_name === 'string' && raw.manager_name.trim()
          ? raw.manager_name.trim()
          : null,
      engineer_name:
        typeof raw?.engineer_name === 'string' && raw.engineer_name.trim()
          ? raw.engineer_name.trim()
          : null,
      session_kind:
        typeof raw?.session_kind === 'string' && raw.session_kind.trim()
          ? raw.session_kind.trim()
          : null,
    });
  }
  const totalDurationHours = plannedShoots.reduce((s, sh) => s + sh.duration_hours, 0);

  // ── Section 2: validate lineItems (deliverables) ───────────────────
  const rawItems = Array.isArray(body.lineItems) ? body.lineItems : null;
  if (!rawItems || rawItems.length === 0) {
    return NextResponse.json(
      { error: 'lineItems must be a non-empty array — a contract needs at least one deliverable' },
      { status: 400 },
    );
  }
  const normalizedItems: NormalizedLineItem[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i] as Record<string, unknown>;
    const kind = typeof raw?.kind === 'string' ? raw.kind : '';
    if (!LINE_ITEM_KINDS.includes(kind as LineItemKind)) {
      return NextResponse.json(
        { error: `Deliverable #${i + 1}: invalid kind '${kind}'` },
        { status: 400 },
      );
    }
    const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
    if (!label) {
      return NextResponse.json(
        { error: `Deliverable #${i + 1}: label is required` },
        { status: 400 },
      );
    }
    const qty = Number(raw?.qty);
    if (!Number.isInteger(qty) || qty < 1) {
      return NextResponse.json(
        { error: `Deliverable #${i + 1}: qty must be a positive integer` },
        { status: 400 },
      );
    }
    // is_free_addon OR unit_cents 0 ⇒ free deliverable (unit_cents forced to 0).
    const isFreeAddon = raw?.is_free_addon === true;
    let unit = Number(raw?.unit_cents);
    if (!Number.isInteger(unit) || unit < 0) {
      return NextResponse.json(
        { error: `Deliverable #${i + 1}: unit_cents must be a non-negative integer` },
        { status: 400 },
      );
    }
    const free = isFreeAddon || unit === 0;
    if (free) unit = 0;

    // Build the note: caller note + the standard free-addon clause.
    const baseNote =
      typeof raw?.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : null;
    let note = baseNote;
    if (free) {
      note =
        baseNote && baseNote.toLowerCase().includes(FREE_ADDON_CLAUSE.toLowerCase())
          ? baseNote
          : baseNote
            ? `${baseNote} (${FREE_ADDON_CLAUSE})`
            : `Free add-on — ${FREE_ADDON_CLAUSE}`;
    }

    normalizedItems.push({
      kind: kind as LineItemKind,
      source_slot_key:
        typeof raw?.source_slot_key === 'string' && raw.source_slot_key.trim()
          ? raw.source_slot_key.trim()
          : null,
      label,
      qty,
      unit_cents: unit,
      notes: note,
      sort_order: typeof raw?.sort_order === 'number' ? raw.sort_order : i,
      is_free_addon: free,
    });
  }

  // Auto-inject planning_call when the rule fires (parity with PUT /package).
  const { items: itemsWithInjection, injected: planningCallInjected } =
    ensurePlanningCallInjection<NormalizedLineItem>(normalizedItems, () => ({
      kind: 'planning_call',
      source_slot_key: null,
      label: 'Planning call (initial scope + storyboard)',
      qty: 1,
      unit_cents: 0,
      notes:
        'Auto-added because this package includes a music video or more than 2 shorts. Required before scheduling.',
      sort_order: -1,
      is_free_addon: false,
    }));

  // ── Section 3: TOTAL INVESTMENT = sum of line-item totals ──────────
  const itemsForInsert = itemsWithInjection.map((it, i) => ({
    kind: it.kind,
    source_slot_key: it.source_slot_key,
    label: it.label,
    qty: it.qty,
    unit_cents: it.unit_cents,
    total_cents: lineItemTotalCents(it.qty, it.unit_cents),
    notes: it.notes,
    sort_order: typeof it.sort_order === 'number' ? it.sort_order : i,
  }));
  const finalPriceCents = computePackageTotalCents(itemsForInsert);

  // ── Section 4: validate installments (optional) ────────────────────
  const rawStints = Array.isArray(body.installments) ? body.installments : [];
  const stints: NormalizedStint[] = [];
  for (let i = 0; i < rawStints.length; i++) {
    const raw = rawStints[i] as Record<string, unknown>;
    const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
    if (!label) {
      return NextResponse.json(
        { error: `Installment #${i + 1}: label is required` },
        { status: 400 },
      );
    }
    const amount = raw?.amount_cents;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
      return NextResponse.json(
        { error: `Installment #${i + 1}: amount_cents must be a non-negative integer` },
        { status: 400 },
      );
    }
    let dueDate: string | null = null;
    if (raw?.due_date != null && raw.due_date !== '') {
      const ds = String(raw.due_date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
        return NextResponse.json(
          { error: `Installment #${i + 1}: due_date must be YYYY-MM-DD or omitted` },
          { status: 400 },
        );
      }
      dueDate = ds;
    }
    stints.push({ label, amount_cents: amount, due_date: dueDate });
  }
  if (stints.length > 0) {
    const sum = stints.reduce((acc, s) => acc + s.amount_cents, 0);
    if (sum !== finalPriceCents) {
      return NextResponse.json(
        {
          error: `Installment amounts must sum to the project total. Plan sums to ${sum} cents but the deliverables total is ${finalPriceCents} cents (off by ${sum - finalPriceCents}).`,
          sum_cents: sum,
          final_price_cents: finalPriceCents,
        },
        { status: 400 },
      );
    }
  }

  const service = createServiceClient();

  // ── Resolve / invite the buyer (mirror /manual) ────────────────────
  const resolved = await resolveOrInviteArtist(service, {
    userId: userIdInput || null,
    email: buyerEmailInput || null,
    displayName: buyerNameInput,
  });
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  const userId = resolved.userId;

  // ── Confirm the offering exists (404 otherwise) ────────────────────
  const { data: offeringRow } = await service
    .from('media_offerings')
    .select('id, title')
    .eq('id', offeringId)
    .maybeSingle();
  const offering = offeringRow as { id: string; title: string } | null;
  if (!offering) {
    return NextResponse.json({ error: 'Offering not found' }, { status: 404 });
  }

  // ── Build project_details (carry section 1 + any caller-supplied) ───
  const incomingDetails =
    body.project_details && typeof body.project_details === 'object' && !Array.isArray(body.project_details)
      ? (body.project_details as Record<string, unknown>)
      : {};
  const projectDetails: Record<string, unknown> = {
    ...incomingDetails,
    planned_shoots: plannedShoots,
    total_duration_hours: totalDurationHours,
  };

  // ── 1) Create the booking shell (UNPAID inquiry, like /manual 'plan') ──
  const { data: bookingRow, error: bookingErr } = await service
    .from('media_bookings')
    .insert({
      offering_id: offeringId,
      user_id: userId,
      band_id: bandId,
      status: 'inquiry',
      configured_components: null,
      project_details: projectDetails,
      contract_terms: contractTerms,
      final_price_cents: finalPriceCents,
      deposit_cents: finalPriceCents,
      actual_deposit_paid: 0,
      notes_to_us: notesToUs,
      customer_phone: customerPhone,
      is_test: false,
      created_by: user.email,
    })
    .select('id')
    .single();
  if (bookingErr || !bookingRow) {
    console.error('[admin/media/bookings/contract] booking insert error:', bookingErr);
    return NextResponse.json(
      { error: `Could not create project: ${bookingErr?.message || 'unknown error'}` },
      { status: 500 },
    );
  }
  const bookingId = (bookingRow as { id: string }).id;

  // ── 2) Create the package + line items (deliverables) ──────────────
  const { data: pkgRow, error: pkgErr } = await service
    .from('media_booking_packages')
    .insert({ booking_id: bookingId, status: 'draft', total_cents: finalPriceCents, notes: packageNotes })
    .select('id')
    .single();
  if (pkgErr || !pkgRow) {
    console.error('[admin/media/bookings/contract] package insert error:', pkgErr);
    return NextResponse.json(
      { error: `Project created but package failed: ${pkgErr?.message || 'unknown'}`, bookingId },
      { status: 500 },
    );
  }
  const packageId = (pkgRow as { id: string }).id;

  if (itemsForInsert.length > 0) {
    const { error: liErr } = await service
      .from('media_booking_line_items')
      .insert(itemsForInsert.map((it) => ({ package_id: packageId, ...it })));
    if (liErr) {
      console.error('[admin/media/bookings/contract] line items insert error:', liErr);
      return NextResponse.json(
        { error: `Project created but deliverables failed: ${liErr.message}`, bookingId },
        { status: 500 },
      );
    }
  }

  // ── 4) Create the installment plan (only if stints were supplied) ──
  let installmentsCount = 0;
  if (stints.length > 0) {
    const { error: instErr } = await service.from('media_payment_installments').insert(
      stints.map((s, idx) => ({
        booking_id: bookingId,
        sort_order: idx,
        label: s.label,
        amount_cents: s.amount_cents,
        due_date: s.due_date,
        status: 'pending' as const,
      })),
    );
    if (instErr) {
      console.error('[admin/media/bookings/contract] installments insert error:', instErr);
      return NextResponse.json(
        { error: `Project created but installment plan failed: ${instErr.message}`, bookingId },
        { status: 500 },
      );
    }
    installmentsCount = stints.length;
  }

  // ── Audit: one entry capturing the whole contract create ───────────
  await service.from('media_booking_audit_log').insert({
    booking_id: bookingId,
    action: 'contract_created',
    performed_by: user.email,
    details: {
      offering_id: offeringId,
      offering_title: offering.title,
      final_price_cents: finalPriceCents,
      package_id: packageId,
      line_item_count: itemsForInsert.length,
      planning_call_auto_injected: planningCallInjected,
      free_addon_count: itemsWithInjection.filter((it) => it.is_free_addon).length,
      planned_shoots_count: plannedShoots.length,
      total_duration_hours: totalDurationHours,
      installments_count: installmentsCount,
      has_contract_terms: !!contractTerms,
    },
  });

  return NextResponse.json({
    success: true,
    bookingId,
    userId,
    final_price_cents: finalPriceCents,
    package: {
      id: packageId,
      total_cents: finalPriceCents,
      line_item_count: itemsForInsert.length,
    },
    planned_shoots_count: plannedShoots.length,
    total_duration_hours: totalDurationHours,
    installments_count: installmentsCount,
    planning_call_auto_injected: planningCallInjected,
    artistInvited: resolved.invited,
    artistCreated: resolved.created,
  });
}
