import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { seedSiteContentFromRegistry, revalidateSiteContent } from '@/lib/site-content-server';

// POST /api/admin/content/seed — populate site_content from the registry defaults
// (idempotent; skips keys that already exist so admin edits are never clobbered).
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const result = await seedSiteContentFromRegistry(createServiceClient());
  revalidateSiteContent();
  return NextResponse.json({ success: true, ...result });
}
