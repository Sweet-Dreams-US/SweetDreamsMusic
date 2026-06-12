import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';

/**
 * /api/admin/cash-deposits
 *
 * Admin-only. Records a bank-deposit event that moves one or more
 * `cash_ledger` rows from status='collected' to status='deposited'.
 *
 * Invariant (hard enforced): every entry submitted must currently be in
 * status='collected'. If any entry is in 'owed' or already 'deposited', the
 * entire batch is rejected with a clear accounting-error warning — we will
 * NOT silently skip or "fix up" state, because that would hide a real
 * bookkeeping problem (e.g., a collection that was never recorded, or a
 * duplicate deposit attempt).
 *
 * Body (POST):
 *   {
 *     entryIds: string[],     // one or more cash_ledger row ids
 *     reference?: string,     // check # / slip # / "ATM 04-20", freetext
 *     note?: string,          // admin-visible note
 *   }
 *
 * Response:
 *   201 { event, entries }  on success
 *   400 { error, issues }   on validation failure (includes per-entry issues)
 *   401 on non-admin
 *   500 on DB failure (with compensating delete of the event row if it landed)
 */

type SubmittedEntry = {
  id: string;
  status: 'owed' | 'collected' | 'deposited';
  amount: number;
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  const actorEmail = user?.email || 'unknown-admin';

  let body: { entryIds?: unknown; reference?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { entryIds, reference, note } = body;

  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return NextResponse.json(
      { error: 'entryIds must be a non-empty array of cash_ledger ids' },
      { status: 400 }
    );
  }

  if (!entryIds.every((x): x is string => typeof x === 'string' && x.length > 0)) {
    return NextResponse.json(
      { error: 'entryIds must contain only non-empty string ids' },
      { status: 400 }
    );
  }

  const refText = typeof reference === 'string' ? reference.trim() || null : null;
  const noteText = typeof note === 'string' ? note.trim() || null : null;

  const service = createServiceClient();

  // --- 1. Load all submitted entries and validate state ---
  // We load in one round-trip so a concurrent deposit on one of these rows
  // doesn't produce partial results. The CHECK constraint on cash_ledger
  // will also stop a double-deposit at the DB layer as a last line of defense.
  const { data: entriesData, error: loadErr } = await service
    .from('cash_ledger')
    .select('id, status, amount, engineer_name, client_name, deposit_event_id')
    .in('id', entryIds);

  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }

  const entries: SubmittedEntry[] = (entriesData || []).map(e => ({
    id: e.id,
    status: e.status,
    amount: e.amount,
  }));

  // Check for missing ids (requested but not found).
  const foundIds = new Set(entries.map(e => e.id));
  const missing = entryIds.filter(id => !foundIds.has(id));

  // Check for non-collected state.
  const notCollected = entries.filter(e => e.status !== 'collected');

  if (missing.length > 0 || notCollected.length > 0) {
    const issues: Array<{ entryId: string; reason: string }> = [
      ...missing.map(id => ({ entryId: id, reason: 'entry not found' })),
      ...notCollected.map(e => ({
        entryId: e.id,
        reason:
          e.status === 'owed'
            ? 'entry is still owed by engineer — record collection first'
            : e.status === 'deposited'
            ? 'entry is already marked deposited'
            : `entry has unexpected status: ${e.status}`,
      })),
    ];

    return NextResponse.json(
      {
        error:
          'Cannot record deposit — accounting issues detected. Resolve each issue before retrying.',
        warning:
          'Your ledger contains entries that do not cleanly fit the deposit flow. This usually means a collection was skipped, an entry was duplicated, or the same batch was already deposited. Review and fix before depositing.',
        issues,
      },
      { status: 400 }
    );
  }

  // --- 2. Create the cash_events row ---
  const totalCents = entries.reduce((sum, e) => sum + (e.amount || 0), 0);

  const { data: eventRow, error: eventErr } = await service
    .from('cash_events')
    .insert({
      event_type: 'deposit',
      performed_by: actorEmail,
      reference: refText,
      note: noteText,
      total_cents: totalCents,
    })
    .select('*')
    .single();

  if (eventErr || !eventRow) {
    return NextResponse.json(
      { error: eventErr?.message || 'Failed to create deposit event' },
      { status: 500 }
    );
  }

  // --- 3. Flip every entry to 'deposited' linked to this event ---
  // The DB CHECK constraint requires deposit_event_id + deposited_at + status
  // to be consistent, so we set all three in the same update.
  const depositedAt = new Date().toISOString();

  const { data: updatedEntries, error: updateErr } = await service
    .from('cash_ledger')
    .update({
      status: 'deposited',
      deposit_event_id: eventRow.id,
      deposited_at: depositedAt,
    })
    .in('id', entryIds)
    .select('*');

  if (updateErr) {
    // Compensating delete — the event row is now orphaned. If this delete
    // also fails we log loudly so someone can clean up manually; the DB is
    // still consistent because no cash_ledger row references the orphan.
    const { error: cleanupErr } = await service
      .from('cash_events')
      .delete()
      .eq('id', eventRow.id);
    if (cleanupErr) {
      console.error(
        '[CASH-DEPOSITS] CRITICAL: orphan cash_events row could not be cleaned up:',
        { eventId: eventRow.id, updateErr: updateErr.message, cleanupErr: cleanupErr.message }
      );
    }
    return NextResponse.json(
      { error: `Failed to mark entries deposited: ${updateErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { event: eventRow, entries: updatedEntries ?? [] },
    { status: 201 }
  );
}

/**
 * GET — list all deposit events with their linked cash_ledger entries.
 *
 * Not paginated yet; deposit events accrue slowly (a handful per month) so
 * this is fine for the foreseeable future. Revisit if list grows past ~500.
 */
export async function GET() {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 401 });

  const service = createServiceClient();

  const { data: events, error: eventsErr } = await service
    .from('cash_events')
    .select('*')
    .eq('event_type', 'deposit')
    .order('created_at', { ascending: false });

  if (eventsErr) return NextResponse.json({ error: eventsErr.message }, { status: 500 });

  const eventIds = (events || []).map(e => e.id);
  if (eventIds.length === 0) {
    return NextResponse.json({ deposits: [] });
  }

  const { data: entries, error: entriesErr } = await service
    .from('cash_ledger')
    .select('id, engineer_name, client_name, amount, note, created_at, deposited_at, deposit_event_id, booking_id')
    .in('deposit_event_id', eventIds)
    .order('created_at', { ascending: false });

  if (entriesErr) return NextResponse.json({ error: entriesErr.message }, { status: 500 });

  // Group entries under their event so the client doesn't have to. Keeps the
  // UI cheap to render for a large deposit history.
  const byEvent = new Map<string, typeof entries>();
  for (const e of entries || []) {
    if (!e.deposit_event_id) continue;
    const list = byEvent.get(e.deposit_event_id) ?? [];
    list.push(e);
    byEvent.set(e.deposit_event_id, list);
  }

  const deposits = (events || []).map(ev => ({
    ...ev,
    entries: byEvent.get(ev.id) ?? [],
  }));

  return NextResponse.json({ deposits });
}
