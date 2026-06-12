// POST /api/admin/tax/expenses/upload-url — signed upload to the PRIVATE
// tax-documents bucket for receipts. Returns filePath only (never a public URL);
// downloads go through short-TTL signed URLs. Admin only.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

const BUCKET = 'tax-documents';
const ALLOWED = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic']);

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: { fileName?: string; kind?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const ext = String(body.fileName || '').split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED.has(ext)) return NextResponse.json({ error: 'Allowed: PDF or image' }, { status: 400 });

  const db = createServiceClient();
  // Lazy-create the private bucket (mirrors the session-prep-files pattern).
  await db.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 26214400 }).catch(() => {});
  // kind 'w9' stores under w9/ (contractor W-9 PDFs); everything else is a receipt.
  const prefix = body.kind === 'w9' ? 'w9' : 'receipts';
  const filePath = `${prefix}/${user.id}-${Date.now()}.${ext}`;
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(filePath);
  if (error || !data) return NextResponse.json({ error: error?.message || 'Could not create upload URL' }, { status: 500 });
  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, filePath });
}
