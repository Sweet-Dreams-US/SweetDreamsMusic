import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyAdminAccess } from '@/lib/admin-auth';

// GET - list all payouts
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const person = searchParams.get('person');

  const serviceClient = createServiceClient();
  let query = serviceClient.from('payroll_payouts').select('*').order('created_at', { ascending: false });
  if (person) query = query.eq('person_name', person);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payouts: data });
}

// POST - record a payout
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const isAdmin = await verifyAdminAccess(supabase);
  if (!isAdmin) return NextResponse.json({ error: 'Admins only' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  const body = await request.json();
  const { personName, amount, method, note, periodLabel, earnings } = body;

  if (!personName || !amount) {
    return NextResponse.json({ error: 'personName and amount required' }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const amountCents = Math.round(amount * 100);

  // Tax Center (079): link every payout to its contractor row so 1099 YTD
  // totals are complete. Find-or-create by display name — a brand-new payee
  // gets a contractor shell the compliance dashboard can flag for a W-9.
  let contractorId: string | null = null;
  try {
    const { data: existing } = await serviceClient.from('contractors')
      .select('id').eq('display_name', personName).eq('active', true).maybeSingle();
    if (existing) contractorId = (existing as { id: string }).id;
    else {
      const { data: created } = await serviceClient.from('contractors')
        .insert({ studio_id: null, legal_name: personName, display_name: personName })
        .select('id').single();
      contractorId = (created as { id: string } | null)?.id ?? null;
    }
  } catch { /* linkage is best-effort — the dashboard's name fallback still counts the payout */ }

  const { data, error } = await serviceClient
    .from('payroll_payouts')
    .insert({
      person_name: personName,
      amount: amountCents,
      method: method || 'cash',
      note: note || null,
      period_label: periodLabel || null,
      created_by: user?.email || null,
      contractor_id: contractorId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Send paystub email to the person
  if (earnings) {
    try {
      // Find the person's email from ENGINEERS constant or profiles
      const { ENGINEERS } = await import('@/lib/constants');
      const engineerConfig = ENGINEERS.find(e => e.name === personName || e.displayName === personName);
      let recipientEmail = engineerConfig?.email;

      if (!recipientEmail) {
        const { data: profile } = await serviceClient
          .from('profiles')
          .select('email')
          .or(`display_name.eq.${personName},producer_name.eq.${personName}`)
          .limit(1)
          .maybeSingle();
        recipientEmail = profile?.email;
      }

      if (recipientEmail) {
        const { sendPaystubEmail } = await import('@/lib/email');
        await sendPaystubEmail(recipientEmail, {
          recipientName: personName,
          payoutAmount: amountCents,
          method: method || 'cash',
          note: note || null,
          periodLabel: periodLabel || null,
          sessionPay: earnings.sessionPay || 0,
          sessionCount: earnings.sessionCount || 0,
          sessionHours: earnings.sessionHours || 0,
          mediaCommission: earnings.mediaCommission || 0,
          mediaWorkerPay: earnings.mediaWorkerPay || 0,
          beatProducerPay: earnings.beatProducerPay || 0,
          packageCommission: earnings.packageCommission || 0,
          totalEarned: earnings.totalEarned || 0,
          totalPaid: (earnings.totalPaid || 0) + amountCents,
          balanceAfter: Math.max(0, (earnings.totalEarned || 0) - (earnings.totalPaid || 0) - amountCents),
        });
      }
    } catch (e) {
      console.error('Paystub email error:', e);
      // Don't fail the payout recording if email fails
    }
  }

  return NextResponse.json({ payout: data, success: true });
}
