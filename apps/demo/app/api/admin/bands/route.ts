// app/api/admin/bands/route.ts
//
// GET — admin list of all bands. Two response shapes share this endpoint:
//
//   • ?q=<query>          — lightweight search (id + display_name only).
//                           Used by GenerateQuoteModal to pick a quote
//                           recipient. Cap 50.
//   • (no q, no params)   — full admin roster. Returns each band with
//                           slug, picture, genre, hometown, is_public,
//                           created_at, member_count (subquery), and a
//                           snapshot of the creator's profile. Cap 1000.
//
// Splitting on `q` keeps the existing GenerateQuoteModal call cheap
// (no extra joins) while letting the Users → Bands admin tab pull
// the full picture in one shot.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();
  const service = createServiceClient();

  // Lightweight search path — preserves the original lean response so
  // GenerateQuoteModal stays unchanged.
  if (q.length >= 2) {
    const { data, error } = await service
      .from('bands')
      .select('id, display_name')
      .ilike('display_name', `%${q}%`)
      .order('display_name', { ascending: true })
      .limit(50);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ bands: data ?? [] });
  }

  // Full admin roster.
  const { data: bands, error } = await service
    .from('bands')
    .select(`
      id,
      slug,
      display_name,
      profile_picture_url,
      genre,
      hometown,
      is_public,
      created_at,
      created_by
    `)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = bands ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ bands: [] });
  }

  // Two parallel auxiliary lookups: (1) member counts per band; (2) the
  // creator's profile snapshot so admins can see who set the band up.
  // Both keyed off the same row set so we issue exactly two extra queries
  // regardless of band count.
  const bandIds = rows.map((b) => b.id);
  const creatorIds = Array.from(
    new Set(rows.map((b) => b.created_by).filter((id): id is string => !!id)),
  );

  const [memberCountsResult, creatorsResult] = await Promise.all([
    service
      .from('band_members')
      .select('band_id')
      .in('band_id', bandIds),
    creatorIds.length > 0
      ? service
          .from('profiles')
          .select('user_id, display_name, email, public_profile_slug')
          .in('user_id', creatorIds)
      : Promise.resolve({ data: [] as Array<{ user_id: string; display_name: string | null; email: string | null; public_profile_slug: string | null }>, error: null }),
  ]);

  const memberCountByBand = new Map<string, number>();
  for (const row of (memberCountsResult.data ?? []) as { band_id: string }[]) {
    memberCountByBand.set(row.band_id, (memberCountByBand.get(row.band_id) ?? 0) + 1);
  }

  type CreatorSnapshot = {
    user_id: string;
    display_name: string | null;
    email: string | null;
    public_profile_slug: string | null;
  };
  const creatorByUserId = new Map<string, CreatorSnapshot>();
  for (const p of (creatorsResult.data ?? []) as CreatorSnapshot[]) {
    creatorByUserId.set(p.user_id, p);
  }

  const enriched = rows.map((b) => ({
    ...b,
    member_count: memberCountByBand.get(b.id) ?? 0,
    creator: b.created_by ? creatorByUserId.get(b.created_by) ?? null : null,
  }));

  return NextResponse.json({ bands: enriched });
}
