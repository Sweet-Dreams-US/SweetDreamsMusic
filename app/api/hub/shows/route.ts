// /api/hub/shows — semi-verified live shows.
// POST logs an UPCOMING show and creates the linked calendar event NOW — the
// pre-dated calendar entry is what makes post-show confirmation count.
// PATCH confirms after the show (photo optional but encouraged).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { evaluateGates } from '@/lib/career-rules';
import { grantAchievement } from '@/lib/achievements-server';
import { CAREER_ACHIEVEMENTS } from '@/lib/career';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data } = await supabase.from('shows').select('*')
    .eq('user_id', user.id).order('show_date', { ascending: false });
  return NextResponse.json({ shows: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const venue = String(body.venue || '').trim();
  const showDate = String(body.show_date || '').slice(0, 10);
  if (!venue) return NextResponse.json({ error: 'Venue required' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(showDate)) return NextResponse.json({ error: 'Valid date required' }, { status: 400 });

  // The calendar event is created NOW — its created_at predating show_date is
  // the semi-verification spine. Past-dated shows can be logged but will
  // never pre-date, so they never count toward show gates (by design).
  const { data: calEvent } = await supabase.from('calendar_events').insert({
    user_id: user.id, title: `Show: ${venue}`, event_type: 'live_show',
    event_date: showDate, description: body.city ? `Live show — ${body.city}` : 'Live show',
  } as never).select('id').single();

  const { data: show, error } = await supabase.from('shows').insert({
    user_id: user.id, venue, city: body.city ? String(body.city) : null,
    show_date: showDate, is_paid: !!body.is_paid, is_headline: !!body.is_headline,
    calendar_event_id: (calEvent as { id: string } | null)?.id ?? null,
  } as never).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ show });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (body.confirm === true) updates.confirmed_at = new Date().toISOString();
  if (body.photo_url != null) updates.photo_url = String(body.photo_url);
  if (body.is_paid != null) updates.is_paid = !!body.is_paid;
  if (body.is_headline != null) updates.is_headline = !!body.is_headline;
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 });

  const { data: show, error } = await supabase.from('shows').update(updates as never)
    .eq('id', id).eq('user_id', user.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Confirmation is the gate-moving event: achievements + gate re-evaluation.
  if (body.confirm === true) {
    try {
      const db = createServiceClient();
      const { data: all } = await db.from('shows').select('is_paid,is_headline,confirmed_at')
        .eq('user_id', user.id).not('confirmed_at', 'is', null);
      const confirmed = (all ?? []) as { is_paid: boolean; is_headline: boolean }[];
      if (confirmed.length >= 1) await grantAchievement(db, user.id, CAREER_ACHIEVEMENTS.shows.first);
      if (confirmed.length >= 5) await grantAchievement(db, user.id, CAREER_ACHIEVEMENTS.shows.five);
      if (confirmed.some((s) => s.is_paid)) await grantAchievement(db, user.id, CAREER_ACHIEVEMENTS.shows.paid);
      if (confirmed.some((s) => s.is_headline)) await grantAchievement(db, user.id, CAREER_ACHIEVEMENTS.shows.headline);
      await evaluateGates(db, user.id);
    } catch (e) { console.error('[career] show hook failed:', e); }
  }
  return NextResponse.json({ show });
}
