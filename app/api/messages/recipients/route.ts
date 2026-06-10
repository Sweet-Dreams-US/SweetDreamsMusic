// GET /api/messages/recipients?q= — the matrix-scoped recipient picker. Staff +
// producers search everyone; plain artists only ever SEE staff + producers, so
// an artist→artist thread can't even be attempted from the UI. Max 12 results.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveParty, searchRecipients } from '@/lib/messaging-server';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const q = new URL(request.url).searchParams.get('q') ?? '';
  const db = createServiceClient();
  const sender = await resolveParty(db, user.id);
  if (!sender) return NextResponse.json({ error: 'Profile lookup failed' }, { status: 500 });

  const results = await searchRecipients(db, sender, q);
  return NextResponse.json({
    recipients: results.map((p) => ({
      user_id: p.userId,
      name: p.name,
      email: p.email,
      role: p.role,
      is_producer: p.isProducer,
    })),
  });
}
