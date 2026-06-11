// lib/achievements-server.ts — the ONE achievement grant path (extracted from
// the /api/hub/achievements/check sweep so server-side event hooks can grant
// too). Triple-idempotent: DB UNIQUE(user_id,achievement_key) + upsert
// ignoreDuplicates + xp_log dedup on reference_id 'achievement_<key>'.
// Badges and career gates can never disagree because both write through here.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ACHIEVEMENTS } from '@/lib/achievements';
import { calculateLevel } from '@/lib/xp-system';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

/**
 * Grant an achievement to a user (auth user id). Returns whether it was newly
 * granted. Safe to call repeatedly. XP comes from the registry definition.
 */
export async function grantAchievement(db: Client, userId: string, key: string):
  Promise<{ granted: boolean; xp: number }> {
  const def = ACHIEVEMENTS[key];
  if (!def) {
    console.error(`[achievements] unknown key: ${key}`);
    return { granted: false, xp: 0 };
  }

  // Was it already unlocked?
  const { data: existing } = await db.from('artist_achievements')
    .select('id').eq('user_id', userId).eq('achievement_key', key).limit(1);
  if (existing && existing.length > 0) return { granted: false, xp: 0 };

  const { error: insErr } = await db.from('artist_achievements')
    .upsert({ user_id: userId, achievement_key: key } as never,
      { onConflict: 'user_id,achievement_key', ignoreDuplicates: true });
  if (insErr) {
    console.error(`[achievements] grant failed (${key}):`, insErr.message);
    return { granted: false, xp: 0 };
  }

  // XP — dedup via xp_log reference_id (same scheme as the check route).
  const refId = `achievement_${key}`;
  const { data: xpDup } = await db.from('xp_log').select('id')
    .eq('user_id', userId).eq('action', 'unlock_achievement').eq('reference_id', refId).limit(1);
  if (xpDup && xpDup.length > 0) return { granted: true, xp: 0 };

  // The xp_log insert is the CONCURRENCY GATE: the partial unique index
  // (user, action, reference_id) from 083 means a racing grant loses here with
  // 23505. Only the winner bumps the profile total — no double-credit.
  const { error: xpErr } = await db.from('xp_log').insert({
    user_id: userId, action: 'unlock_achievement', xp_amount: def.xp,
    label: `Achievement: ${def.title}`, reference_id: refId,
    metadata: { achievement: key },
  } as never);
  if (xpErr) {
    // 23505 = another concurrent grant already logged this XP. Badge stands,
    // XP not re-credited. Any other error: log it, still don't double-bump.
    if ((xpErr as { code?: string }).code !== '23505') console.error(`[achievements] xp_log failed (${key}):`, xpErr.message);
    return { granted: true, xp: 0 };
  }

  // Bump profile totals (keyed by user_id; increment_xp RPC when available).
  try {
    const { error: rpcErr } = await db.rpc('increment_xp', { p_user_id: userId, p_xp_amount: def.xp });
    if (rpcErr) throw rpcErr;
    const { data: prof } = await db.from('profiles').select('total_xp').eq('user_id', userId).single();
    const level = calculateLevel(Number((prof as any)?.total_xp ?? 0)).level;
    await db.from('profiles').update({ artist_level: level } as never).eq('user_id', userId);
  } catch {
    const { data: prof } = await db.from('profiles').select('total_xp').eq('user_id', userId).single();
    const newTotal = Number((prof as any)?.total_xp ?? 0) + def.xp;
    await db.from('profiles').update({
      total_xp: newTotal, artist_level: calculateLevel(newTotal).level,
    } as never).eq('user_id', userId);
  }

  return { granted: true, xp: def.xp };
}
