import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { loadSiteSettings, ensureSiteSettingsRow } from '@/lib/site-settings-server';
import { LOCKED_FEATURES } from '@/lib/site-settings';

// Only these columns are writable. studio_sessions / beats are deliberately NOT
// here (and have no DB column) — so a crafted body can never disable a locked
// feature. This allow-list IS the server-side locked-on guard.
const EDITABLE = new Set([
  'bands_enabled', 'events_enabled', 'media_enabled',
  'nav_about_enabled', 'nav_contact_enabled', 'nav_engineers_enabled', 'nav_blog_enabled',
  'notes',
]);

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
  const settings = await loadSiteSettings(db);
  return NextResponse.json({ settings, locked: LOCKED_FEATURES });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Allow-list filter: silently DROP any non-editable key (incl. any attempt to
  // write a locked feature by guessing a column name).
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!EDITABLE.has(k)) continue;
    updates[k] = k === 'notes' ? (v == null ? null : String(v)) : Boolean(v);
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields' }, { status: 400 });
  }

  const db = createServiceClient();
  await ensureSiteSettingsRow(db); // belt-and-suspenders if the migration seed was skipped
  const { error } = await db.from('site_settings').update(updates as never).is('studio_id', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Bust the public shell (Header/Footer) + gated pages so the change is live.
  revalidatePath('/', 'layout');
  const settings = await loadSiteSettings(db);
  return NextResponse.json({ success: true, settings });
}
