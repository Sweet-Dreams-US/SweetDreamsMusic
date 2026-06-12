// app/api/admin/media/bookings/[id]/route.ts
//
// Admin updates to a single media booking. PATCH handles five things:
//   1. status transitions (deposited → scheduled → in_production → delivered;
//      use 'cancelled' to cancel a row — there's no hard delete because
//      audit + Stripe refund flows need the row to stick around)
//   2. deliverables JSONB updates (admin paste video URLs, file links, etc)
//   3. final_price_cents adjustments (scope creep — admin bumps the total
//      mid-project; the Charge remainder modal collects the new delta)
//   4. project_details edits (the buyer's questionnaire — admin cleans up
//      typos, refines song titles, fills in missing details after a phone
//      call). Whole-object replace; small enough that a delta API isn't
//      worth it.
//   5. notes_to_us edits (admin shorthand notes from a planning call that
//      the buyer didn't capture in the original questionnaire)
//
// Why combined: admin typically marks a booking 'delivered' AT the same
// moment they paste the final deliverables. One PATCH = one round-trip.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sendMediaDeliverablesReady } from '@/lib/email';

const ALLOWED_STATUSES = new Set([
  'inquiry',
  'deposited',
  'scheduled',
  'in_production',
  'delivered',
  'cancelled',
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'media_manager') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  // Status — whitelist only
  if (typeof body.status === 'string') {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    update.status = body.status;
  }

  // Deliverables — must be a plain object or null. We stash it verbatim;
  // the agreed shape is `{ items: [{ label, url, kind, added_at }] }` but
  // we don't validate item-level structure here so admins can experiment.
  if ('deliverables' in body) {
    if (body.deliverables === null || (typeof body.deliverables === 'object' && !Array.isArray(body.deliverables))) {
      update.deliverables = body.deliverables;
    } else {
      return NextResponse.json(
        { error: 'deliverables must be an object or null' },
        { status: 400 },
      );
    }
  }

  // project_details — buyer's questionnaire snapshot. Admin can edit
  // after a planning call to clean up typos or fill in missing fields.
  // Whole-object replace; small enough that a delta API isn't worth it.
  if ('project_details' in body) {
    if (body.project_details === null || (typeof body.project_details === 'object' && !Array.isArray(body.project_details))) {
      update.project_details = body.project_details;
    } else {
      return NextResponse.json(
        { error: 'project_details must be an object or null' },
        { status: 400 },
      );
    }
  }

  // notes_to_us — short admin notes (free text). Empty string normalizes
  // to null so accounting reports don't show empty stub rows.
  if ('notes_to_us' in body) {
    if (body.notes_to_us === null) {
      update.notes_to_us = null;
    } else if (typeof body.notes_to_us === 'string') {
      update.notes_to_us = body.notes_to_us.trim() || null;
    } else {
      return NextResponse.json(
        { error: 'notes_to_us must be a string or null' },
        { status: 400 },
      );
    }
  }

  // final_price_cents — non-negative integer. Floor enforcement (can't go
  // below already-paid) happens after we read the row so we have the
  // authoritative paid figure to compare against.
  let priceAdjustment: { newCents: number } | null = null;
  if ('final_price_cents' in body) {
    if (
      typeof body.final_price_cents !== 'number' ||
      !Number.isInteger(body.final_price_cents) ||
      body.final_price_cents < 0
    ) {
      return NextResponse.json(
        { error: 'final_price_cents must be a non-negative integer' },
        { status: 400 },
      );
    }
    priceAdjustment = { newCents: body.final_price_cents };
  }

  if (Object.keys(update).length === 0 && !priceAdjustment) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const service = createServiceClient();

  // Read the row before updating so we can detect "first deliverable"
  // transitions for the buyer-notification email + emit audit-log
  // entries for every state change. Single row read; cheap.
  const { data: prevRow } = await service
    .from('media_bookings')
    .select('status, deliverables, project_details, notes_to_us, user_id, offering_id, final_price_cents, deposit_cents, actual_deposit_paid, final_paid_at')
    .eq('id', id)
    .maybeSingle();

  if (priceAdjustment) {
    const prev = prevRow as
      | {
          final_price_cents: number;
          deposit_cents: number | null;
          actual_deposit_paid: number | null;
          final_paid_at: string | null;
        }
      | null;
    const paid = prev?.actual_deposit_paid ?? prev?.deposit_cents ?? 0;
    if (priceAdjustment.newCents < paid) {
      return NextResponse.json(
        { error: `New total can't be less than already-paid (${paid} cents)` },
        { status: 400 },
      );
    }
    update.final_price_cents = priceAdjustment.newCents;
    // If admin bumps total to match paid, the row becomes fully paid.
    if (priceAdjustment.newCents === paid && !prev?.final_paid_at && paid > 0) {
      update.final_paid_at = new Date().toISOString();
    }
  }

  const { data, error } = await service
    .from('media_bookings')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    console.error('[admin/media/bookings] PATCH error:', error);
    return NextResponse.json({ error: 'Could not update booking' }, { status: 400 });
  }

  // ── Audit log emission ────────────────────────────────────────────
  // Every PATCH change earns a row so the history panel can reconstruct
  // the booking's life. Some entries are higher-signal than others:
  //   • status flips → action='status_changed'
  //   • cancellation → action='order_cancelled' (separate verb so it
  //     pops in the admin scan)
  //   • price → action='total_adjusted' with deltas
  //   • project_details / notes_to_us → action='details_edited'
  //   • deliverables → action='deliverables_edited'
  //
  // Audit failures don't break the PATCH — they're logged and skipped
  // so admin recovery from a transient DB issue doesn't double-fail.
  const auditRows: Array<{
    booking_id: string;
    action: string;
    performed_by: string;
    details: Record<string, unknown>;
  }> = [];

  if (prevRow) {
    const prev = prevRow as {
      status: string;
      final_price_cents: number;
      deliverables: unknown;
      project_details: unknown;
      notes_to_us: string | null;
    };

    if (priceAdjustment && prev.final_price_cents !== priceAdjustment.newCents) {
      auditRows.push({
        booking_id: id,
        action: 'total_adjusted',
        performed_by: user.email,
        details: {
          previous_total: prev.final_price_cents,
          new_total: priceAdjustment.newCents,
          delta: priceAdjustment.newCents - prev.final_price_cents,
        },
      });
    }

    if ('status' in update && typeof update.status === 'string' && update.status !== prev.status) {
      auditRows.push({
        booking_id: id,
        action: update.status === 'cancelled' ? 'order_cancelled' : 'status_changed',
        performed_by: user.email,
        details: {
          previous_status: prev.status,
          new_status: update.status,
        },
      });
    }

    if ('project_details' in update) {
      auditRows.push({
        booking_id: id,
        action: 'details_edited',
        performed_by: user.email,
        details: { field: 'project_details' },
      });
    }

    if ('notes_to_us' in update && update.notes_to_us !== prev.notes_to_us) {
      auditRows.push({
        booking_id: id,
        action: 'details_edited',
        performed_by: user.email,
        details: { field: 'notes_to_us', new_value: update.notes_to_us },
      });
    }

    if ('deliverables' in update) {
      auditRows.push({
        booking_id: id,
        action: 'deliverables_edited',
        performed_by: user.email,
        details: {},
      });
    }
  }

  if (auditRows.length > 0) {
    try {
      await service.from('media_booking_audit_log').insert(auditRows);
    } catch (e) {
      console.error('[admin/media/bookings] audit log error:', e);
    }
  }

  // Phase E follow-up: first-deliverable notification.
  // Trigger conditions:
  //   1. This PATCH actually touched the deliverables field
  //   2. Previous state had no items (null, missing, or items=[])
  //   3. New state has at least 1 item
  // Subsequent additions don't fire — admin can email batch updates manually.
  // Fire-and-forget: any email failure is logged but never breaks the PATCH.
  if ('deliverables' in update && prevRow) {
    type DeliverablesShape = { items?: Array<{ label: string; url: string }> } | null;
    const prevItems = ((prevRow as { deliverables?: DeliverablesShape }).deliverables?.items ?? []);
    const newItems = ((update.deliverables as DeliverablesShape)?.items ?? []);
    if (prevItems.length === 0 && newItems.length > 0) {
      try {
        const buyerId = (prevRow as { user_id: string }).user_id;
        const offeringId = (prevRow as { offering_id: string }).offering_id;
        const [{ data: buyerProfile }, { data: offeringRow }] = await Promise.all([
          service.from('profiles').select('display_name, email').eq('user_id', buyerId).maybeSingle(),
          service.from('media_offerings').select('title').eq('id', offeringId).maybeSingle(),
        ]);
        const buyer = buyerProfile as { display_name?: string; email?: string } | null;
        const offering = offeringRow as { title?: string } | null;
        const buyerEmail = buyer?.email;
        if (buyerEmail) {
          await sendMediaDeliverablesReady(buyerEmail, {
            buyerName: buyer?.display_name || buyerEmail.split('@')[0] || 'there',
            offeringTitle: offering?.title || 'your media order',
            bookingId: id,
            itemCount: newItems.length,
          });
        }
      } catch (e) {
        console.error('[admin/media/bookings] deliverables ready email error:', e);
      }
    }
  }

  return NextResponse.json({ booking: data });
}
