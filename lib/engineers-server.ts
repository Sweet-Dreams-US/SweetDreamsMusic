// lib/engineers-server.ts — load the engineer roster from the `engineers` table
// (DB-driven, replaces the ENGINEERS constant for display + booking pickers).
// Falls back to the constant if the table is empty. The canonical `name` is the
// immutable payroll identity (the Zion-rename lesson) — the admin editor never
// changes it, only display fields.

import { cache } from 'react';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { ENGINEERS } from '@/lib/constants';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

export interface EngineerRec {
  id: string;
  name: string;          // canonical payroll identity (immutable)
  displayName: string;
  email: string;
  specialties: string[];
  photoUrl: string | null;
  bio: string | null;
  active: boolean;
  sortOrder: number;
  studios: string[];     // assigned room slugs
}

export function engineersFromConstants(): EngineerRec[] {
  return ENGINEERS.map((e, i) => ({
    id: `const-${i}`, name: e.name, displayName: e.displayName, email: e.email,
    specialties: [...e.specialties], photoUrl: null, bio: null, active: true, sortOrder: i,
    studios: [...e.studios],
  }));
}

function rowsToRecs(rows: any[], assigns: any[]): EngineerRec[] {
  return rows.map((r) => ({
    id: r.id, name: r.name, displayName: r.display_name || r.name, email: r.email,
    specialties: r.specialties ?? [], photoUrl: r.photo_url ?? null, bio: r.bio ?? null,
    active: r.active, sortOrder: r.sort_order ?? 0,
    studios: assigns.filter((a) => a.engineer_id === r.id).map((a) => a.studio_rooms?.slug).filter(Boolean),
  }));
}

/** DI'd: all engineers (admin) or active-only (public/pickers). Fallback to constant. */
export async function loadEngineers(db: Client, opts?: { activeOnly?: boolean }): Promise<EngineerRec[]> {
  try {
    let q = db.from('engineers').select('id,name,display_name,email,specialties,photo_url,bio,active,sort_order').order('sort_order');
    if (opts?.activeOnly) q = q.eq('active', true);
    const { data: rows } = await q;
    if (!rows || rows.length === 0) return engineersFromConstants();
    const { data: assigns } = await db.from('studio_room_engineers').select('engineer_id, studio_rooms(slug)').in('engineer_id', rows.map((r: any) => r.id));
    return rowsToRecs(rows, assigns ?? []);
  } catch {
    return engineersFromConstants();
  }
}

/** Cached active roster for public page + booking pickers. */
export const getEngineers = cache(async (): Promise<EngineerRec[]> => loadEngineers(createServiceClient(), { activeOnly: true }));

export function revalidateEngineers() {
  revalidatePath('/', 'layout');
}
