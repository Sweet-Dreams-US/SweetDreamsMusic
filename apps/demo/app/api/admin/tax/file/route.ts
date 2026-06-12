// GET /api/admin/tax/file?expense=<id> | ?contractor=<id> — short-TTL signed
// download URL for a stored receipt or W-9 from the PRIVATE tax-documents
// bucket. The audit found storage was write-only ("the CPA gets the W-9" had
// no fulfillment path). Admin only; paths come from the DB row, never the query.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

const BUCKET = 'tax-documents';

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const expenseId = params.get('expense');
  const contractorId = params.get('contractor');
  const db = createServiceClient();

  let path: string | null = null;
  let label = 'document';
  if (expenseId) {
    const { data } = await db.from('business_expenses')
      .select('receipt_storage_path,vendor,incurred_on').eq('id', expenseId).maybeSingle();
    path = (data as any)?.receipt_storage_path ?? null;
    label = `receipt-${(data as any)?.incurred_on ?? ''}${(data as any)?.vendor ? `-${(data as any).vendor}` : ''}`;
  } else if (contractorId) {
    const { data } = await db.from('contractors')
      .select('w9_storage_path,legal_name').eq('id', contractorId).maybeSingle();
    path = (data as any)?.w9_storage_path ?? null;
    label = `W9-${(data as any)?.legal_name ?? ''}`;
  } else {
    return NextResponse.json({ error: 'expense or contractor id required' }, { status: 400 });
  }
  if (!path) return NextResponse.json({ error: 'No file on record' }, { status: 404 });

  const { data: signed, error } = await db.storage.from(BUCKET)
    .createSignedUrl(path, 3600, { download: label.replace(/[^\w.-]+/g, '_') });
  if (error || !signed) return NextResponse.json({ error: error?.message || 'Could not sign URL' }, { status: 500 });
  return NextResponse.json({ url: signed.signedUrl });
}
