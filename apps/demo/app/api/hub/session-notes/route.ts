import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const bookingId = searchParams.get('booking_id');

  const service = createServiceClient();

  if (bookingId) {
    // Verify booking belongs to this user
    const { data: booking } = await service
      .from('bookings')
      .select('id')
      .eq('id', bookingId)
      .eq('customer_email', user.email!)
      .single();

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const { data: notes, error } = await service
      .from('session_notes')
      .select('*, bookings(start_time, room)')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ notes: notes || [] });
  }

  // Get all notes for user's bookings
  // First get all booking IDs for this user
  const { data: bookings } = await service
    .from('bookings')
    .select('id')
    .eq('customer_email', user.email!);

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ notes: [] });
  }

  const bookingIds = bookings.map((b) => b.id);

  const { data: notes, error } = await service
    .from('session_notes')
    .select('*, bookings(start_time, room)')
    .in('booking_id', bookingIds)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: notes || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { booking_id, content, what_was_worked_on, next_steps, linked_project_id, is_visible_to_client } = body;

  if (!booking_id) return NextResponse.json({ error: 'booking_id required' }, { status: 400 });
  if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 });

  // Verify booking belongs to this user
  const service = createServiceClient();
  const { data: booking } = await service
    .from('bookings')
    .select('id')
    .eq('id', booking_id)
    .eq('customer_email', user.email!)
    .single();

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found or not yours' }, { status: 404 });
  }

  const { data: note, error } = await supabase
    .from('session_notes')
    .insert({
      booking_id,
      author_type: 'artist',
      author_id: user.id,
      content: content.trim(),
      what_was_worked_on: what_was_worked_on || null,
      next_steps: next_steps || null,
      linked_project_id: linked_project_id || null,
      is_visible_to_client: is_visible_to_client !== undefined ? is_visible_to_client : true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await request.json();
  const { id, content, what_was_worked_on, next_steps, linked_project_id, is_visible_to_client } = body;

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (content !== undefined) updates.content = content.trim();
  if (what_was_worked_on !== undefined) updates.what_was_worked_on = what_was_worked_on;
  if (next_steps !== undefined) updates.next_steps = next_steps;
  if (linked_project_id !== undefined) updates.linked_project_id = linked_project_id || null;
  if (is_visible_to_client !== undefined) updates.is_visible_to_client = is_visible_to_client;

  const { data: note, error } = await supabase
    .from('session_notes')
    .update(updates)
    .eq('id', id)
    .eq('author_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note });
}
