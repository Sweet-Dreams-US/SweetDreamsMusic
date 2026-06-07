// lib/earnings-data-server.ts — fetch the EarningsInput (the rows computeEarningsCore
// needs) from the DB. Mirrors /api/admin/accounting's queries; used by the what-if
// simulator. Client-injected so it's importable from routes.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ENGINEERS } from '@/lib/constants';
import type { EarningsInput } from '@/lib/earnings-core';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

export async function fetchEarningsInput(db: Client): Promise<EarningsInput> {
  const [{ data: bookings }, { data: beats }, { data: media }, { data: mediaSessions }, { data: pkg }, { data: grants }] = await Promise.all([
    db.from('bookings').select('status, engineer_name, service_value_cents, total_amount, duration, reward_grant_id, engineer_split_pct').not('status', 'eq', 'cancelled'),
    db.from('beat_purchases').select('amount_paid, producer_pct, beats(producer)'),
    db.from('media_sales').select('*'),
    db.from('media_session_bookings').select('engineer_id, engineer_payout_cents').eq('status', 'completed').not('engineer_payout_cents', 'is', null),
    db.from('package_entitlements').select('salesperson_name, sales_commission_cents').not('salesperson_name', 'is', null).gt('sales_commission_cents', 0),
    db.from('reward_grants').select('owner_user_id, value_cents, status').eq('reward_type', 'cash_bonus').in('status', ['approved', 'issued', 'redeemed']),
  ]);

  const engIds = Array.from(new Set((mediaSessions ?? []).map((r: any) => r.engineer_id)));
  const engineerNames: Record<string, string> = {};
  if (engIds.length) {
    const { data: profs } = await db.from('profiles').select('user_id, display_name, email').in('user_id', engIds);
    for (const p of (profs ?? []) as any[]) {
      const roster = p.email ? ENGINEERS.find((e) => e.email.toLowerCase() === p.email.toLowerCase()) : null;
      engineerNames[p.user_id] = roster?.name || p.display_name || 'Unknown';
    }
  }

  const ownerIds = Array.from(new Set((grants ?? []).map((g: any) => g.owner_user_id).filter(Boolean)));
  const bonusName: Record<string, string> = {};
  if (ownerIds.length) {
    const { data: bprofs } = await db.from('profiles').select('user_id, display_name, email').in('user_id', ownerIds);
    for (const p of (bprofs ?? []) as any[]) {
      const roster = p.email ? ENGINEERS.find((e) => e.email.toLowerCase() === p.email.toLowerCase()) : null;
      bonusName[p.user_id] = roster?.name || p.display_name || 'Unknown';
    }
  }
  const bonuses = (grants ?? []).map((g: any) => ({ person_name: g.owner_user_id ? (bonusName[g.owner_user_id] || 'Unknown') : 'Unknown', value_cents: g.value_cents || 0, status: g.status }));

  return {
    bookings: (bookings ?? []) as any,
    media: (media ?? []) as any,
    beats: (beats ?? []) as any,
    mediaSessions: (mediaSessions ?? []) as any,
    engineerNames,
    packageCommissions: (pkg ?? []) as any,
    bonuses,
  };
}
