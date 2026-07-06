import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';
import {
  listAudiences,
  createCustomerAudience,
  getPlatformCustomers,
  AudienceWriteError,
  type CustomerSource,
} from '@/lib/meta-audiences';

// /api/admin/marketing/audiences — Custom Audiences for the Marketing tab.
//   GET  → list the ad account's audiences + platform customer counts per source
//   POST → create a customer-list audience from platform customers
//          ({ name, source }) — 409 with instructions while Meta write access
//          (Advanced Access + Custom Audience ToS) is pending.

const SOURCES: CustomerSource[] = ['all_customers', 'booking_customers', 'beat_buyers'];

export async function GET() {
  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const service = createServiceClient();
  try {
    const [audiences, all, bookings, beats] = await Promise.all([
      listAudiences(),
      getPlatformCustomers(service, 'all_customers'),
      getPlatformCustomers(service, 'booking_customers'),
      getPlatformCustomers(service, 'beat_buyers'),
    ]);
    const count = (c: { emails: string[]; phones: string[] }) => c.emails.length + c.phones.length;
    return NextResponse.json({
      audiences,
      sources: {
        all_customers: count(all),
        booking_customers: count(bookings),
        beat_buyers: count(beats),
      },
    });
  } catch (e) {
    console.error('[admin/marketing/audiences] list failed:', e);
    return NextResponse.json({ error: 'Could not load audiences' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  if (!(await verifyAdminAccess(supabase))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const source = SOURCES.includes(body?.source) ? (body.source as CustomerSource) : null;
  if (!name || !source) {
    return NextResponse.json({ error: 'name and source required' }, { status: 400 });
  }

  const service = createServiceClient();
  try {
    const result = await createCustomerAudience(service, name, source);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    if (e instanceof AudienceWriteError) {
      // Known setup state, not a server fault — the UI renders the checklist.
      return NextResponse.json({ error: e.message, writeAccess: false }, { status: 409 });
    }
    console.error('[admin/marketing/audiences] create failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Audience creation failed' },
      { status: 502 },
    );
  }
}
