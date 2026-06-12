// app/api/admin/cash-corrections/route.ts
//
// GET — admin-only list of all post-completion cash corrections.
// Hydrates booking customer name + room + session date so admin
// can scan the log without per-row fetches.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const service = createServiceClient();

  const { data: rows, error } = await service
    .from('booking_cash_corrections')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('[admin/cash-corrections GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string; booking_id: string;
    previous_total_cents: number; new_total_cents: number;
    previous_cash_ledger_amount_cents: number | null;
    new_cash_ledger_amount_cents: number | null;
    reason: string;
    corrected_by_email: string; corrected_by_role: 'admin' | 'engineer';
    created_at: string;
  };
  const corrections = (rows ?? []) as Row[];

  if (corrections.length === 0) return NextResponse.json({ corrections: [] });

  // Hydrate booking context.
  const bookingIds = Array.from(new Set(corrections.map((r) => r.booking_id)));
  const { data: bookings } = await service
    .from('bookings')
    .select('id, customer_name, customer_email, room, start_time, engineer_name, status')
    .in('id', bookingIds);
  type Booking = {
    id: string; customer_name: string; customer_email: string;
    room: string | null; start_time: string;
    engineer_name: string | null; status: string;
  };
  const bookingMap = new Map<string, Booking>();
  for (const b of (bookings ?? []) as Booking[]) {
    bookingMap.set(b.id, b);
  }

  const hydrated = corrections.map((c) => {
    const b = bookingMap.get(c.booking_id);
    return {
      ...c,
      delta_cents: c.new_total_cents - c.previous_total_cents,
      booking_customer_name: b?.customer_name ?? null,
      booking_customer_email: b?.customer_email ?? null,
      booking_room: b?.room ?? null,
      booking_start_time: b?.start_time ?? null,
      booking_engineer: b?.engineer_name ?? null,
      booking_status: b?.status ?? null,
    };
  });

  return NextResponse.json({ corrections: hydrated });
}
