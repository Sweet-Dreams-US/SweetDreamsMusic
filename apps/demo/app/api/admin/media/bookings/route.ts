// app/api/admin/media/bookings/route.ts
//
// Admin-side reads for the Media Orders tab. Returns every media_bookings
// row (regardless of status) plus joined offering title for display, sorted
// newest first. The component pages on the client side; for now we cap at
// 200 rows which is plenty for the MVP scale.
//
// Auth: admin-only.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const service = createServiceClient();
  const { data: bookings, error } = await service
    .from('media_bookings')
    .select(`
      id, offering_id, user_id, band_id, status,
      configured_components, project_details,
      final_price_cents, deposit_cents, actual_deposit_paid,
      final_paid_at, deposit_paid_at,
      stripe_payment_intent_id, stripe_session_id,
      deliverables, component_status, notes_to_us,
      customer_phone, is_test, created_by,
      created_at, updated_at
    `)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[admin/media/bookings] read error:', error);
    return NextResponse.json({ error: 'Could not load bookings' }, { status: 500 });
  }

  // Hydrate offering titles and buyer profiles in batches — N+1-free.
  const rows = (bookings || []) as Array<{
    id: string;
    offering_id: string;
    user_id: string;
    band_id: string | null;
  }>;
  const offeringIds = Array.from(new Set(rows.map((r) => r.offering_id)));
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const bandIds = Array.from(
    new Set(rows.map((r) => r.band_id).filter((b): b is string => !!b)),
  );

  const [offeringRes, profileRes, bandRes] = await Promise.all([
    // Round 7b: pull `components` too — admin needs the slot list to
    // render per-component completion checkboxes.
    offeringIds.length
      ? service.from('media_offerings').select('id, title, slug, components, price_cents').in('id', offeringIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? service.from('profiles').select('user_id, display_name, email, phone').in('user_id', userIds)
      : Promise.resolve({ data: [], error: null }),
    bandIds.length
      ? service.from('bands').select('id, display_name').in('id', bandIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const offerings = (offeringRes.data || []) as Array<{
    id: string;
    title: string;
    slug: string;
    components: { slots?: Array<{ key: string; label: string; kind?: string }> } | null;
    price_cents: number | null;
  }>;
  const profiles = (profileRes.data || []) as Array<{
    user_id: string;
    display_name: string | null;
    email: string | null;
    phone: string | null;
  }>;
  const bands = (bandRes.data || []) as Array<{ id: string; display_name: string }>;

  return NextResponse.json({ bookings: rows, offerings, profiles, bands });
}
