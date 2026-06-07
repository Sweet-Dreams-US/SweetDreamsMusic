import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { computeEarningsCore, type RevenueConfig } from '@/lib/earnings-core';
import { getRevenueConfig, getRevenueOverrides } from '@/lib/revenue-config-server';
import { fetchEarningsInput } from '@/lib/earnings-data-server';

// What-if: recompute all-time payroll under hypothetical default shares vs the
// current defaults, applying BOTH to every row (ignoreSnapshot) so the only
// difference is the share %. Mutates nothing — pure preview / persuasion.

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: { hypothetical?: Record<string, number> };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const h = body.hypothetical ?? {};

  const db = createServiceClient();
  const [data, currentCfg, overrides] = await Promise.all([
    fetchEarningsInput(db),
    getRevenueConfig(db),
    getRevenueOverrides(db),
  ]);

  const hypCfg: RevenueConfig = {
    engineerSessionSplit: h.engineer_session_pct != null ? h.engineer_session_pct / 100 : currentCfg.engineerSessionSplit,
    producerCommission: h.producer_commission_pct != null ? h.producer_commission_pct / 100 : currentCfg.producerCommission,
    mediaSellerPct: h.media_seller_pct != null ? h.media_seller_pct / 100 : currentCfg.mediaSellerPct,
    mediaWorkerTotal: h.media_worker_pct != null ? h.media_worker_pct / 100 : currentCfg.mediaWorkerTotal,
  };

  // Both ignore snapshots so the delta isolates the share change (not freezing).
  const baseline = computeEarningsCore(data, currentCfg, { overrides, ignoreSnapshot: true });
  const sim = computeEarningsCore(data, hypCfg, { overrides, ignoreSnapshot: true });

  const names = Array.from(new Set([...Object.keys(baseline), ...Object.keys(sim)])).sort();
  const perPerson = names.map((name) => {
    const b = baseline[name]?.totalPay ?? 0;
    const s = sim[name]?.totalPay ?? 0;
    return { name, baseline: b, sim: s, delta: s - b };
  }).filter((p) => p.baseline !== 0 || p.sim !== 0);

  const totalBaseline = perPerson.reduce((s, p) => s + p.baseline, 0);
  const totalSim = perPerson.reduce((s, p) => s + p.sim, 0);

  return NextResponse.json({
    perPerson,
    totalBaseline,
    totalSim,
    payrollDelta: totalSim - totalBaseline,
    businessNetDelta: -(totalSim - totalBaseline), // gross fixed → business moves opposite payroll
  });
}
