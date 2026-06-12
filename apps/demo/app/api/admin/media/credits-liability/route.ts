// app/api/admin/media/credits-liability/route.ts
//
// Admin-side accounting view of the prepaid studio credit liability.
// Returns:
//   - totalOutstandingHours       — sum of (granted - used)
//   - totalLiabilityCents         — sum of cost_basis_cents on rows with
//                                    a positive remaining balance
//   - perOwner: array of { ownerType, ownerId, ownerName, hours, cents }
//
// The number that matters most is `totalLiabilityCents` — that's the
// deferred-revenue figure on the books. When credits drain (engineer
// works the hours), liability becomes earned revenue.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const service = createServiceClient();

  const { data, error } = await service
    .from('studio_credits')
    .select('id, user_id, band_id, hours_granted, hours_used, cost_basis_cents, created_at');
  if (error) {
    console.error('[admin/credits-liability] read error:', error);
    return NextResponse.json({ error: 'Could not load credits' }, { status: 500 });
  }

  type CreditRow = {
    id: string;
    user_id: string | null;
    band_id: string | null;
    hours_granted: number;
    hours_used: number;
    cost_basis_cents: number | null;
    created_at: string;
  };
  const rows = (data || []) as CreditRow[];
  const outstanding = rows.filter(
    (r) => Number(r.hours_granted) - Number(r.hours_used) > 0,
  );

  // Hydrate owner names for the per-owner breakdown.
  const userIds = Array.from(
    new Set(outstanding.map((r) => r.user_id).filter((u): u is string => !!u)),
  );
  const bandIds = Array.from(
    new Set(outstanding.map((r) => r.band_id).filter((b): b is string => !!b)),
  );
  const [profileRes, bandRes] = await Promise.all([
    userIds.length
      ? service.from('profiles').select('user_id, display_name, email').in('user_id', userIds)
      : Promise.resolve({ data: [], error: null }),
    bandIds.length
      ? service.from('bands').select('id, display_name').in('id', bandIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const profileMap = new Map<string, string>();
  for (const p of (profileRes.data || []) as Array<{ user_id: string; display_name: string | null; email: string | null }>) {
    profileMap.set(p.user_id, p.display_name || p.email || 'User');
  }
  const bandMap = new Map<string, string>();
  for (const b of (bandRes.data || []) as Array<{ id: string; display_name: string }>) {
    bandMap.set(b.id, b.display_name);
  }

  // Aggregate per owner so the list displays one row per credit holder.
  const perOwnerKey = (r: CreditRow) =>
    r.band_id ? `band:${r.band_id}` : `user:${r.user_id ?? ''}`;
  const perOwner = new Map<
    string,
    {
      ownerType: 'user' | 'band';
      ownerId: string;
      ownerName: string;
      hoursRemaining: number;
      liabilityCents: number;
    }
  >();
  for (const r of outstanding) {
    const key = perOwnerKey(r);
    const remaining = Number(r.hours_granted) - Number(r.hours_used);
    const cents = r.cost_basis_cents ?? 0;
    if (!perOwner.has(key)) {
      const isBand = !!r.band_id;
      perOwner.set(key, {
        ownerType: isBand ? 'band' : 'user',
        ownerId: isBand ? r.band_id! : r.user_id!,
        ownerName: isBand
          ? bandMap.get(r.band_id!) ?? 'Band'
          : profileMap.get(r.user_id!) ?? 'User',
        hoursRemaining: 0,
        liabilityCents: 0,
      });
    }
    const agg = perOwner.get(key)!;
    agg.hoursRemaining += remaining;
    agg.liabilityCents += cents;
  }

  let totalHours = 0;
  let totalCents = 0;
  for (const v of perOwner.values()) {
    totalHours += v.hoursRemaining;
    totalCents += v.liabilityCents;
  }

  return NextResponse.json({
    totalOutstandingHours: totalHours,
    totalLiabilityCents: totalCents,
    perOwner: Array.from(perOwner.values()).sort(
      (a, b) => b.liabilityCents - a.liabilityCents,
    ),
    creditCount: outstanding.length,
  });
}
