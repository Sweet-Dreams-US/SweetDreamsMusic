// app/api/engineer/blocks/route.ts
//
// Engineer self-service availability blocks. The signed-in engineer can:
//   • GET    list their own upcoming blocks
//   • POST   create a new block (date + start + end + optional reason)
//   • DELETE remove one of their own blocks
//
// Blocks are stored in `studio_blocks` with `engineer_name` set to the
// engineer's canonical roster name (per `lib/constants.ts`). The booking
// flow checks this column in /api/booking/create — if the requested
// engineer is blocked during the requested window, the booking is rejected.
//
// Studio-wide blocks (admin-created, engineer_name=NULL) still apply to
// every engineer and continue to flow through /api/admin/blocks.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { findEngineerByEmail } from '@/lib/constants';

// Resolve the engineer's canonical roster name from their session email.
// We never trust the body for engineer identity — that would let any
// signed-in engineer block someone else's calendar. Email comes from the
// auth session (Supabase-verified) only.
async function resolveEngineerName(email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const fromRoster = findEngineerByEmail(email);
  if (fromRoster) return fromRoster.name;
  // Engineer not in the static roster (e.g., a contractor or new hire) —
  // fall back to their profile.display_name. Admin engineers may have
  // edited display_name, so we read it as the canonical handle for them.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('user_id', user.id)
    .maybeSingle();
  return (profile as { display_name: string } | null)?.display_name ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const isEngineer = await verifyEngineerAccess(supabase);
  if (!isEngineer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: { user } } = await supabase.auth.getUser();
  const engineerName = await resolveEngineerName(user?.email);
  if (!engineerName) {
    return NextResponse.json({ error: 'Could not resolve engineer identity' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: blocks, error } = await service
    .from('studio_blocks')
    .select('id, start_time, end_time, reason, created_by, engineer_name, created_at')
    .eq('engineer_name', engineerName)
    .gte('end_time', new Date().toISOString())
    .order('start_time', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ blocks: blocks ?? [], engineer_name: engineerName });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const isEngineer = await verifyEngineerAccess(supabase);
  if (!isEngineer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: { user } } = await supabase.auth.getUser();
  const engineerName = await resolveEngineerName(user?.email);
  if (!engineerName) {
    return NextResponse.json({ error: 'Could not resolve engineer identity' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const date = typeof body.date === 'string' ? body.date : '';
  const startTime = typeof body.startTime === 'string' ? body.startTime : '';
  const endTime = typeof body.endTime === 'string' ? body.endTime : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() || null : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (!/^\d{1,2}:\d{2}$/.test(startTime) || !/^\d{1,2}:\d{2}$/.test(endTime)) {
    return NextResponse.json({ error: 'times must be HH:MM' }, { status: 400 });
  }

  // Build start/end timestamps using the same Fort-Wayne-wall-clock-as-UTC
  // convention the rest of the booking system uses. This keeps engineer
  // blocks in lockstep with how booking.start_time / end_time are stored.
  const startISO = `${date}T${startTime.padStart(5, '0')}:00+00:00`;
  const endISO = `${date}T${endTime.padStart(5, '0')}:00+00:00`;
  if (Date.parse(endISO) <= Date.parse(startISO)) {
    return NextResponse.json({ error: 'endTime must be after startTime' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: block, error } = await service
    .from('studio_blocks')
    .insert({
      start_time: startISO,
      end_time: endISO,
      reason,
      engineer_name: engineerName,
      created_by: user?.email || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ block });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const isEngineer = await verifyEngineerAccess(supabase);
  if (!isEngineer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: { user } } = await supabase.auth.getUser();
  const engineerName = await resolveEngineerName(user?.email);
  if (!engineerName) {
    return NextResponse.json({ error: 'Could not resolve engineer identity' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Ownership check — engineer can only delete their own blocks. Admin
  // can use /api/admin/blocks for any block (studio-wide or engineer-
  // scoped). This route is engineer-scoped only.
  const service = createServiceClient();
  const { data: existing } = await service
    .from('studio_blocks')
    .select('id, engineer_name')
    .eq('id', id)
    .maybeSingle();
  const block = existing as { id: string; engineer_name: string | null } | null;
  if (!block) return NextResponse.json({ error: 'Block not found' }, { status: 404 });
  if (block.engineer_name !== engineerName) {
    return NextResponse.json(
      { error: 'You can only delete your own blocks. Studio-wide blocks are admin-only.' },
      { status: 403 },
    );
  }

  const { error } = await service.from('studio_blocks').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

