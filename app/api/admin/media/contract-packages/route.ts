// app/api/admin/media/contract-packages/route.ts
//
// GET — normalized package presets for the contract builder's "Start from a
// package" picker. Returns BOTH admin package_templates and catalog
// media_offerings (kind='package'), flattened into the builder's line-item
// shape by lib/media-contract-packages. Read-only; media-manager gated (same
// gate as the contract create route).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyMediaManagerAccess } from '@/lib/admin-auth';
import { getContractPackageOptions } from '@/lib/media-contract-packages';

export async function GET() {
  const supabase = await createClient();
  if (!(await verifyMediaManagerAccess(supabase))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const options = await getContractPackageOptions();
  return NextResponse.json({ options });
}
