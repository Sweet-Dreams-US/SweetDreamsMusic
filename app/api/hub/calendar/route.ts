import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { formatDuration } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month'); // YYYY-MM
  if (!month) return NextResponse.json({ error: 'month required (YYYY-MM)' }, { status: 400 });

  const startDate = `${month}-01`;
  const endDate = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0)
    .toISOString().split('T')[0]; // last day of month

  // Manual calendar events
  const { data: events } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('user_id', user.id)
    .gte('event_date', startDate)
    .lte('event_date', endDate)
    .order('event_date', { ascending: true });

  // Booked sessions this month
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, start_time, duration, room, status, customer_name')
    .eq('customer_email', user.email!)
    .gte('start_time', `${startDate}T00:00:00`)
    .lte('start_time', `${endDate}T23:59:59`)
    .in('status', ['confirmed', 'completed', 'pending_deposit']);

  // Project release dates this month
  const { data: releases } = await supabase
    .from('artist_projects')
    .select('id, title, target_release_date')
    .eq('user_id', user.id)
    .gte('target_release_date', startDate)
    .lte('target_release_date', endDate)
    .neq('status', 'archived');

  // Merge into unified event list
  const allEvents = [
    ...(events || []).map((e) => ({
      id: e.id,
      title: e.title,
      event_type: e.event_type,
      event_date: e.event_date,
      event_time: e.event_time,
      description: e.description,
      color: e.color,
      is_auto_generated: e.is_auto_generated,
      source: 'manual' as const,
    })),
    ...(bookings || []).map((b) => ({
      id: `booking_${b.id}`,
      title: `Studio Session${b.room === 'studio_a' ? ' (A)' : b.room === 'studio_b' ? ' (B)' : ''}`,
      event_type: 'studio_session',
      event_date: b.start_time.split('T')[0],
      event_time: b.start_time.split('T')[1]?.slice(0, 5) || null,
      description: `${formatDuration(b.duration)} · ${b.status}`,
      color: '#000000',
      is_auto_generated: true,
      source: 'booking' as const,
    })),
    ...(releases || []).map((r) => ({
      id: `release_${r.id}`,
      title: `Release: ${r.title}`,
      event_type: 'release',
      event_date: r.target_release_date,
      event_time: null,
      description: null,
      color: '#F4C430',
      is_auto_generated: true,
      source: 'project' as const,
    })),
  ];

  return NextResponse.json({ events: allEvents });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { title, event_type, event_date, event_time, description, color, linked_project_id } = body;

  if (!title || !event_date) return NextResponse.json({ error: 'title and event_date required' }, { status: 400 });

  const { data: event, error } = await supabase
    .from('calendar_events')
    .insert({
      user_id: user.id,
      title,
      event_type: event_type || 'other',
      event_date,
      event_time: event_time || null,
      description: description || null,
      color: color || null,
      linked_project_id: linked_project_id || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { id, title, event_type, event_date, event_time, description, color, recurring_rule, recurring_end_date } = body;

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (event_type !== undefined) updates.event_type = event_type;
  if (event_date !== undefined) updates.event_date = event_date;
  if (event_time !== undefined) updates.event_time = event_time || null;
  if (description !== undefined) updates.description = description || null;
  if (color !== undefined) updates.color = color || null;
  if (recurring_rule !== undefined) updates.recurring_rule = recurring_rule || null;
  if (recurring_end_date !== undefined) updates.recurring_end_date = recurring_end_date || null;

  const { data: event, error } = await supabase
    .from('calendar_events')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await request.json();
  const { error } = await supabase.from('calendar_events').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
