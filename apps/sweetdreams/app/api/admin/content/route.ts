import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { CONTENT_REGISTRY, REGISTRY_BY_KEY } from '@/lib/site-content';
import { revalidateSiteContent } from '@/lib/site-content-server';

// Admin CMS editor API. GET returns every registry field joined with its current
// DB value (so the editor is usable even before the seed runs). PUT upserts one
// key (validated against the registry + coerced by kind) and busts the cache.

/* eslint-disable @typescript-eslint/no-explicit-any */

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: 'Login required' }, { status: 401 }) };
  if (user.role !== 'admin') return { error: NextResponse.json({ error: 'Admin only' }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const db = createServiceClient();
  const { data: rows } = await db.from('site_content').select('key, value');
  const byKey = new Map((rows ?? []).map((r: any) => [r.key, r.value?.v]));
  const fields = CONTENT_REGISTRY.map((f) => {
    const dbVal = byKey.get(f.key);
    return { key: f.key, group: f.group, label: f.label, kind: f.kind, value: dbVal !== undefined ? dbVal : f.default, isDefault: dbVal === undefined };
  });
  const groups = [...new Set(CONTENT_REGISTRY.map((f) => f.group))];
  return NextResponse.json({ fields, groups });
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const field = REGISTRY_BY_KEY[body.key];
  if (!field) return NextResponse.json({ error: 'Unknown content key' }, { status: 400 });

  // Coerce to the field's kind.
  let v: any = body.value;
  if (field.kind === 'number') { v = Number(v); if (!Number.isFinite(v)) return NextResponse.json({ error: 'Invalid number' }, { status: 400 }); }
  else if (field.kind === 'list') { v = Array.isArray(v) ? v.map((x) => String(x)) : []; }
  else { v = v == null ? '' : String(v); }

  const db = createServiceClient();
  const { data: loc } = await db.from('studios').select('id').eq('slug', 'sweet-dreams').maybeSingle();
  const { error } = await db.from('site_content').upsert({
    key: field.key, value: { v }, group_name: field.group, label: field.label, kind: field.kind,
    location_id: (loc as any)?.id ?? null, updated_by: gate.user!.email,
  } as any, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidateSiteContent();
  return NextResponse.json({ success: true });
}

// DELETE ?key= → reset to default (remove the row; loader falls back to registry).
export async function DELETE(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const key = new URL(request.url).searchParams.get('key');
  if (!key || !REGISTRY_BY_KEY[key]) return NextResponse.json({ error: 'Unknown key' }, { status: 400 });
  const db = createServiceClient();
  const { error } = await db.from('site_content').delete().eq('key', key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  revalidateSiteContent();
  return NextResponse.json({ success: true });
}
