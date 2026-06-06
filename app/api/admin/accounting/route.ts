import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  // Fetch all bookings (with optional date range)
  // Round 7c: extends select with band_id + booking_group_id + sweet_spot_addon
  // so the accounting panel can break out band-session revenue separately
  // from solo-session revenue without an N+1 join.
  let bookingsQuery = supabase
    .from('bookings')
    .select('id, customer_name, customer_email, start_time, duration, total_amount, service_value_cents, reward_grant_id, deposit_amount, remainder_amount, actual_deposit_paid, status, engineer_name, room, band_id, booking_group_id, sweet_spot_addon, created_at')
    .not('status', 'eq', 'cancelled')
    .order('created_at', { ascending: false });

  if (from) bookingsQuery = bookingsQuery.gte('start_time', from);
  if (to) bookingsQuery = bookingsQuery.lte('start_time', `${to}T23:59:59`);

  const { data: bookings } = await bookingsQuery;

  // Fetch cancelled bookings with deposits (kept revenue)
  let cancelledQuery = supabase
    .from('bookings')
    .select('id, customer_name, start_time, total_amount, deposit_amount, actual_deposit_paid, status, created_at')
    .eq('status', 'cancelled')
    .order('created_at', { ascending: false });

  if (from) cancelledQuery = cancelledQuery.gte('start_time', from);
  if (to) cancelledQuery = cancelledQuery.lte('start_time', `${to}T23:59:59`);

  const { data: cancelledBookings } = await cancelledQuery;

  // Fetch all beat purchases (with optional date range)
  let purchasesQuery = supabase
    .from('beat_purchases')
    .select('id, beat_id, buyer_email, license_type, amount_paid, created_at, beats(title, producer)')
    .order('created_at', { ascending: false });

  if (from) purchasesQuery = purchasesQuery.gte('created_at', from);
  if (to) purchasesQuery = purchasesQuery.lte('created_at', `${to}T23:59:59`);

  const { data: beatPurchases } = await purchasesQuery;

  // Fetch media sales (with optional date range)
  let mediaSalesQuery = supabase
    .from('media_sales')
    .select('*')
    .order('created_at', { ascending: false });

  if (from) mediaSalesQuery = mediaSalesQuery.gte('created_at', from);
  if (to) mediaSalesQuery = mediaSalesQuery.lte('created_at', `${to}T23:59:59`);

  const { data: mediaSales } = await mediaSalesQuery;

  // Phase E follow-up: media_session_bookings payouts. Returned as a parallel
  // array (not merged into mediaSales) because the shape and accounting
  // semantics differ — these are admin-typed dollar amounts on completed
  // shoots, not commission-on-sale entries. The payroll calculator merges
  // them into per-engineer mediaWorkerPay so engineers get credit for media
  // shoots paid via the new flow.
  let mediaSessionsQuery = supabase
    .from('media_session_bookings')
    .select('id, parent_booking_id, engineer_id, starts_at, ends_at, session_kind, location, status, engineer_payout_cents, engineer_payout_paid_at')
    .eq('status', 'completed')
    .not('engineer_payout_cents', 'is', null)
    .order('starts_at', { ascending: false });

  if (from) mediaSessionsQuery = mediaSessionsQuery.gte('starts_at', from);
  if (to) mediaSessionsQuery = mediaSessionsQuery.lte('starts_at', `${to}T23:59:59`);

  const { data: mediaSessions } = await mediaSessionsQuery;

  // Round 7b: media_bookings (the package-level orders). Distinct from
  // media_sales (legacy line items) and media_session_bookings (per-shoot
  // payouts). Returned as its own array because the accounting semantics
  // are package-level: deposits paid, remainder owed, fully-paid stamp.
  // is_test rows are excluded — they're QA bookings with no real money.
  let mediaBookingsQuery = supabase
    .from('media_bookings')
    .select(`
      id, offering_id, user_id, status,
      final_price_cents, deposit_cents, actual_deposit_paid,
      deposit_paid_at, final_paid_at,
      created_by, created_at
    `)
    .eq('is_test', false)
    .not('status', 'eq', 'cancelled')
    .order('created_at', { ascending: false });

  if (from) mediaBookingsQuery = mediaBookingsQuery.gte('created_at', from);
  if (to) mediaBookingsQuery = mediaBookingsQuery.lte('created_at', `${to}T23:59:59`);

  const { data: mediaBookings } = await mediaBookingsQuery;

  // Package salesperson commissions. When an admin attributes a
  // salesperson to a package quote, the commission is snapshotted onto
  // the entitlement at mint time (sales_commission_cents). Commission
  // is earned ON PAYMENT — so we date-filter by created_at (the mint
  // timestamp = when the customer paid). Only rows with a salesperson
  // and a positive commission matter to payroll.
  let packageCommissionsQuery = supabase
    .from('package_entitlements')
    .select('id, salesperson_name, sales_commission_cents, created_at, quote_id, template_id')
    .not('salesperson_name', 'is', null)
    .gt('sales_commission_cents', 0)
    .order('created_at', { ascending: false });

  if (from) packageCommissionsQuery = packageCommissionsQuery.gte('created_at', from);
  if (to) packageCommissionsQuery = packageCommissionsQuery.lte('created_at', `${to}T23:59:59`);

  const { data: packageCommissions } = await packageCommissionsQuery;

  // Hydrate offering titles in one batch — avoids N+1 client-side joins
  // and lets the Accounting page render a "what was sold" column.
  const mediaOfferingIds = Array.from(
    new Set((mediaBookings || []).map((b: { offering_id: string }) => b.offering_id)),
  );
  const mediaOfferingMap: Record<string, string> = {};
  if (mediaOfferingIds.length > 0) {
    const { data: offerings } = await supabase
      .from('media_offerings')
      .select('id, title')
      .in('id', mediaOfferingIds);
    for (const o of (offerings || []) as Array<{ id: string; title: string }>) {
      mediaOfferingMap[o.id] = o.title;
    }
  }

  // Hydrate band display_names so the Accounting band-revenue panel can
  // show "Band X earned $Y this month" without joining on the client.
  const bandIds = Array.from(
    new Set((bookings || [])
      .map((b: { band_id: string | null }) => b.band_id)
      .filter((id: string | null): id is string => !!id)),
  );
  const bandMap: Record<string, string> = {};
  if (bandIds.length > 0) {
    const { data: bandsData } = await supabase
      .from('bands')
      .select('id, display_name')
      .in('id', bandIds);
    for (const b of (bandsData || []) as Array<{ id: string; display_name: string }>) {
      bandMap[b.id] = b.display_name;
    }
  }

  // Resolve engineer_id → display_name so the payroll calculator can
  // merge these into the same per-engineer buckets it uses for
  // bookings.engineer_name and media_sales.filmed_by/edited_by.
  const engineerIds = Array.from(
    new Set((mediaSessions || []).map((r: { engineer_id: string }) => r.engineer_id)),
  );
  const engineerNameMap: Record<string, string> = {};
  if (engineerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, display_name, email')
      .in('user_id', engineerIds);
    const { ENGINEERS } = await import('@/lib/constants');
    for (const p of (profiles || []) as Array<{ user_id: string; display_name: string | null; email: string | null }>) {
      // Prefer the canonical name from ENGINEERS (matches what bookings/media_sales
      // store) over profile display_name. Fall back to display_name if not in roster.
      const matchedRoster = p.email
        ? ENGINEERS.find((e) => e.email.toLowerCase() === p.email!.toLowerCase())
        : null;
      engineerNameMap[p.user_id] = matchedRoster?.name || p.display_name || 'Unknown';
    }
  }

  // Staff cash bonuses (reward_grants). These add to a person's payroll like any
  // other earnings, funded from the studio's cut. 'approved'/'issued' = owed (not
  // yet paid); 'redeemed' = already paid out. We resolve owner_user_id → the
  // canonical roster name so it lands in the SAME per-person bucket as sessions.
  const { data: bonusGrants } = await supabase
    .from('reward_grants')
    .select('id, owner_user_id, value_cents, status, period_key, rule_key, created_at, redeemed_at')
    .eq('reward_type', 'cash_bonus')
    .in('status', ['approved', 'issued', 'redeemed']);

  const bonusOwnerIds = Array.from(new Set((bonusGrants || []).map((g: { owner_user_id: string | null }) => g.owner_user_id).filter((x): x is string => !!x)));
  const bonusNameMap: Record<string, string> = {};
  if (bonusOwnerIds.length > 0) {
    const { data: bprofiles } = await supabase.from('profiles').select('user_id, display_name, email').in('user_id', bonusOwnerIds);
    const { ENGINEERS } = await import('@/lib/constants');
    for (const p of (bprofiles || []) as Array<{ user_id: string; display_name: string | null; email: string | null }>) {
      const roster = p.email ? ENGINEERS.find((e) => e.email.toLowerCase() === p.email!.toLowerCase()) : null;
      bonusNameMap[p.user_id] = roster?.name || p.display_name || 'Unknown';
    }
  }
  const rewardBonuses = (bonusGrants || []).map((g: { id: string; owner_user_id: string | null; value_cents: number | null; status: string; period_key: string; rule_key: string; created_at: string; redeemed_at: string | null }) => ({
    id: g.id,
    person_name: g.owner_user_id ? (bonusNameMap[g.owner_user_id] || 'Unknown') : 'Unknown',
    value_cents: g.value_cents || 0,
    status: g.status,            // approved|issued = owed; redeemed = paid
    period_key: g.period_key,
    rule_key: g.rule_key,
    created_at: g.created_at,
    redeemed_at: g.redeemed_at,
  }));

  return NextResponse.json({
    bookings: bookings || [],
    cancelledBookings: cancelledBookings || [],
    beatPurchases: beatPurchases || [],
    mediaSales: mediaSales || [],
    mediaSessions: mediaSessions || [],
    mediaBookings: mediaBookings || [],
    packageCommissions: packageCommissions || [],
    rewardBonuses,
    mediaOfferingMap,
    bandMap,
    engineerNameMap,
  });
}
