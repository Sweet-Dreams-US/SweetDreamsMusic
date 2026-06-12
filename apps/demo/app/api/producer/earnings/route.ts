import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyProducerAccess } from '@/lib/admin-auth';
import { PRODUCER_COMMISSION } from '@/lib/constants';

export async function GET() {
  const supabase = await createClient();
  const { isProducer, profileId } = await verifyProducerAccess(supabase);
  if (!isProducer || !profileId) return NextResponse.json({ error: 'Producer access required' }, { status: 401 });

  const serviceClient = createServiceClient();

  // Get all beats by this producer
  const { data: producerBeats } = await serviceClient
    .from('beats')
    .select('id, total_lease_revenue')
    .eq('producer_id', profileId);

  if (!producerBeats || producerBeats.length === 0) {
    return NextResponse.json({
      totalGross: 0,
      platformFee: 0,
      netEarnings: 0,
      totalPaid: 0,
      pendingPayout: 0,
      totalBeats: 0,
      totalLeases: 0,
    });
  }

  const beatIds = producerBeats.map((b) => b.id);

  // Get all purchases for these beats
  const { data: purchases } = await serviceClient
    .from('beat_purchases')
    .select('amount_paid, producer_pct')
    .in('beat_id', beatIds);

  const totalGross = purchases?.reduce((sum, p) => sum + p.amount_paid, 0) || 0;
  // Per-row (frozen snapshot producer_pct ?? constant), summed — byte-identical to
  // admin payroll's beat math (lib/earnings-core.ts, called with constants + no live
  // overrides). platformFee is the exact complement so net + fee === gross.
  const netEarnings = purchases?.reduce((sum, p) =>
    sum + Math.round(p.amount_paid * (p.producer_pct != null ? Number(p.producer_pct) / 100 : PRODUCER_COMMISSION)), 0) || 0;
  const platformFee = totalGross - netEarnings;

  // Get payouts from both tables (producer_payouts legacy + payroll_payouts new)
  const { data: legacyPayouts } = await serviceClient
    .from('producer_payouts')
    .select('amount, status')
    .eq('producer_id', profileId)
    .eq('status', 'paid');

  // Also check payroll_payouts (admin records payouts here)
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('display_name, producer_name')
    .eq('id', profileId)
    .single();

  const producerName = profile?.producer_name || profile?.display_name || '';
  const { data: payrollPayouts } = producerName ? await serviceClient
    .from('payroll_payouts')
    .select('amount')
    .eq('person_name', producerName) : { data: null };

  const legacyPaid = legacyPayouts?.reduce((sum, p) => sum + p.amount, 0) || 0;
  const payrollPaid = payrollPayouts?.reduce((sum, p) => sum + p.amount, 0) || 0;
  const totalPaid = legacyPaid + payrollPaid;

  return NextResponse.json({
    totalGross,
    platformFee,
    netEarnings,
    totalPaid,
    pendingPayout: netEarnings - totalPaid,
    totalBeats: producerBeats.length,
    totalLeases: purchases?.length || 0,
  });
}
