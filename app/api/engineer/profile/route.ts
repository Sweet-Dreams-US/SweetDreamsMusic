import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { getSessionUser } from '@/lib/auth';
import { revalidateEngineers } from '@/lib/engineers-server';

// Engineer self-service profile. SECURITY: the engineer row is ALWAYS resolved by
// the SESSION user's email (engineers.email == auth user.email, lowercased) — never
// by a client-supplied id. An engineer can therefore only ever read/edit their OWN
// record. Edits are limited to photo_url / display_name / bio; the canonical
// name/email (payroll identity), active, sort_order, etc. are never touched here.

const SELECT = 'id, name, display_name, photo_url, bio';

export async function GET() {
  const supabase = await createClient();
  if (!(await verifyEngineerAccess(supabase))) return NextResponse.json({ error: 'Engineers only' }, { status: 401 });

  const sessionUser = await getSessionUser();
  if (!sessionUser?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = createServiceClient();
  const { data: engineer } = await db
    .from('engineers')
    .select(SELECT)
    .eq('email', sessionUser.email.toLowerCase())
    .maybeSingle();

  // No linked engineer row → 200 with engineer: null so the UI can show a friendly message.
  return NextResponse.json({ engineer: engineer ?? null });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  if (!(await verifyEngineerAccess(supabase))) return NextResponse.json({ error: 'Engineers only' }, { status: 401 });

  const sessionUser = await getSessionUser();
  if (!sessionUser?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { photo_url?: string | null; display_name?: string | null; bio?: string | null };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Resolve the row to update by the SESSION user's email — NEVER a client id.
  const db = createServiceClient();
  const { data: engineer } = await db
    .from('engineers')
    .select('id')
    .eq('email', sessionUser.email.toLowerCase())
    .maybeSingle();
  if (!engineer) return NextResponse.json({ error: 'No engineer profile is linked to your account.' }, { status: 404 });

  // Whitelist: only the three self-editable display fields. Anything else is ignored.
  const updates: Record<string, string | null> = {};
  if ('photo_url' in body) updates.photo_url = body.photo_url == null ? null : String(body.photo_url);
  if ('display_name' in body) updates.display_name = body.display_name == null ? null : String(body.display_name);
  if ('bio' in body) updates.bio = body.bio == null ? null : String(body.bio);
  if (!Object.keys(updates).length) return NextResponse.json({ error: 'No editable fields' }, { status: 400 });

  // The id here is the email-resolved one — the engineer can only ever update their own row.
  const { error } = await db.from('engineers').update(updates as never).eq('id', (engineer as { id: string }).id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidateEngineers();
  return NextResponse.json({ success: true });
}
