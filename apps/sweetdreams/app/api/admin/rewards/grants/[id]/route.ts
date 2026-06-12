// POST /api/admin/rewards/grants/[id] — approve or deny a reward grant.
// Body: { action: 'approve' | 'deny', reason?: string }. Approving issues the
// real credit (free hours/media) or stamps inline rewards (discounts/cash).
// Admin-only.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { approveGrant, denyGrant } from '@/lib/rewards-issue';

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const action = String(body.action || '');
  const reason = body.reason ? String(body.reason) : undefined;

  const db = createServiceClient();
  const res = action === 'approve'
    ? await approveGrant(db, id, user.id)
    : action === 'deny'
      ? await denyGrant(db, id, user.id, reason)
      : { ok: false, reason: 'action must be approve or deny' };

  if (!res.ok) return NextResponse.json({ error: res.reason || 'Failed' }, { status: 400 });
  return NextResponse.json({ success: true, ...res });
}
