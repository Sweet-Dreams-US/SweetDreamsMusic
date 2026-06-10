// /api/hub/share-links — artist-side management of private listening links.
// GET: links + per-link feedback summary. POST: create (token, optional
// expiry, pick one of YOUR session files). PATCH: revoke / add a feedback
// email to contacts (the s3_list feed).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { grantAchievement } from '@/lib/achievements-server';
import { CAREER_ACHIEVEMENTS } from '@/lib/career';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const db = createServiceClient();
  const { data: links } = await db.from('track_share_links').select('*')
    .eq('user_id', user.id).order('created_at', { ascending: false });
  const ids = ((links ?? []) as any[]).map((l) => l.id);
  const { data: feedback } = ids.length
    ? await db.from('track_share_feedback').select('*').in('share_link_id', ids).order('created_at', { ascending: false })
    : { data: [] };

  const byLink = new Map<string, any[]>();
  for (const f of ((feedback ?? []) as any[])) {
    if (!byLink.has(f.share_link_id)) byLink.set(f.share_link_id, []);
    byLink.get(f.share_link_id)!.push(f);
  }
  return NextResponse.json({
    links: ((links ?? []) as any[]).map((l) => {
      const fb = byLink.get(l.id) ?? [];
      return {
        ...l,
        feedback: fb,
        feedbackCount: fb.length,
        avgVibe: fb.length ? Math.round((fb.reduce((s, f) => s + f.vibe_score, 0) / fb.length) * 10) / 10 : null,
        favoriteMoments: fb.map((f) => f.favorite_moment_seconds).filter((s) => s != null),
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const trackLabel = String(body.track_label || '').trim();
  const deliverableId = body.deliverable_id ? String(body.deliverable_id) : null;
  if (!trackLabel) return NextResponse.json({ error: 'Track label required' }, { status: 400 });
  if (!deliverableId) return NextResponse.json({ error: 'Pick a track from your files' }, { status: 400 });

  const db = createServiceClient();
  // The file must be the artist's own.
  const { data: file } = await db.from('deliverables')
    .select('id,user_id').eq('id', deliverableId).maybeSingle();
  if (!file || (file as any).user_id !== user.id) {
    return NextResponse.json({ error: 'That file is not in your library' }, { status: 403 });
  }

  const { data: link, error } = await db.from('track_share_links').insert({
    user_id: user.id,
    project_id: body.project_id ? String(body.project_id) : null,
    deliverable_id: deliverableId,
    track_label: trackLabel,
    token: crypto.randomUUID(),
    expires_at: body.expires_at ? String(body.expires_at) : null,
  } as never).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await grantAchievement(db, user.id, CAREER_ACHIEVEMENTS.sharing.firstLink);
  return NextResponse.json({ link });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const db = createServiceClient();

  // One-click: feedback email → artist contacts (feeds the owned-list habit).
  if (body.action === 'add_contact' && body.feedback_id) {
    const { data: fb } = await db.from('track_share_feedback')
      .select('id,listener_name,listener_email,added_to_contacts,track_share_links!inner(user_id)')
      .eq('id', String(body.feedback_id)).maybeSingle();
    if (!fb || (fb as any).track_share_links.user_id !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!(fb as any).added_to_contacts) {
      await db.from('artist_contacts').insert({
        user_id: user.id, name: (fb as any).listener_name, email: (fb as any).listener_email,
        role: 'fan', source: 'listen_feedback', met_at: 'Private listening link',
      } as never);
      await db.from('track_share_feedback').update({ added_to_contacts: true } as never).eq('id', (fb as any).id);
    }
    return NextResponse.json({ success: true });
  }

  // Revoke — kills playback immediately (the listen route checks this flag).
  if (body.action === 'revoke' && body.id) {
    const { error } = await db.from('track_share_links').update({ revoked: true } as never)
      .eq('id', String(body.id)).eq('user_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
