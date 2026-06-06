// GET /api/hub/rewards — the signed-in user's reward progress + earned rewards,
// for the Hub "Perks" surface. Returns current counters (for progress bars) and
// their grants (earned/pending/issued/redeemed), for themselves AND each band
// they're in. The client renders the ladder from lib/rewards (pure).

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { customerProgress, bandProgress } from '@/lib/rewards-server';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const db = createServiceClient();
  const now = new Date();

  const { data: prof } = await db.from('profiles').select('email,display_name').eq('user_id', user.id).maybeSingle();
  const email = String((prof as any)?.email || user.email || '').toLowerCase();

  // The user's bands.
  const { data: memberships } = await db.from('band_members').select('band_id').eq('user_id', user.id);
  const bandIds = (memberships ?? []).map((m: any) => m.band_id);
  const { data: bandRows } = bandIds.length
    ? await db.from('bands').select('id,display_name').in('id', bandIds)
    : { data: [] as any[] };

  // Their grants (self + bands).
  const ownerFilter = bandIds.length
    ? `owner_user_id.eq.${user.id},owner_band_id.in.(${bandIds.join(',')})`
    : `owner_user_id.eq.${user.id}`;
  const { data: grants } = await db.from('reward_grants')
    .select('id,rule_key,track,counter,period_key,reward_type,reward_value,value_cents,status,counter_value,threshold,expires_at,owner_user_id,owner_band_id,metadata')
    .or(ownerFilter)
    .order('created_at', { ascending: false });

  const counters = email ? await customerProgress(db, user.id, email, now) : { studio_hours: 0, dollars_spent: 0 };

  const bands = [];
  for (const b of (bandRows ?? []) as any[]) {
    bands.push({ id: b.id, name: b.display_name, counters: await bandProgress(db, b.id, now) });
  }

  const mine = (grants ?? []).filter((g: any) => g.owner_user_id === user.id);
  const bandGrants = (grants ?? []).filter((g: any) => !!g.owner_band_id);

  return NextResponse.json({ counters, grants: mine, bands, bandGrants });
}
