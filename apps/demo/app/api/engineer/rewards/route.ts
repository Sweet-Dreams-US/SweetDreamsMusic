// GET /api/engineer/rewards — the signed-in engineer's bonus progress.
// Monthly milestone (one total: 30hr→$150, 60hr→$350) + quarterly $1/hr kicker.
// Counters are clamped to the rewards launch date (no back-pay for pre-launch
// work). Read-only — payout happens via the admin/payroll flow. Engineer/admin.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { ENGINEERS } from '@/lib/constants';
import { engineerProgress, getLaunchDate } from '@/lib/rewards-server';
import { REWARD_RULES } from '@/lib/rewards';

export async function GET() {
  const supabase = await createClient();
  if (!(await verifyEngineerAccess(supabase))) {
    return NextResponse.json({ error: 'Engineer only' }, { status: 403 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const roster = ENGINEERS.find((e) => e.email.toLowerCase() === user.email.toLowerCase());
  const engineerName = roster?.name || null;
  if (!engineerName) {
    // Admin without a roster entry — nothing to show.
    return NextResponse.json({ engineerName: null, monthHours: 0, quarterHours: 0, monthlyBonusCents: 0, quarterlyKickerCents: 0, launched: false });
  }

  const db = createServiceClient();
  const launchDate = await getLaunchDate(db);
  const { monthHours, quarterHours } = await engineerProgress(db, engineerName, new Date(), launchDate);

  // Monthly milestone = highest tier reached (one total).
  const monthlyTiers = REWARD_RULES
    .filter((r) => r.track === 'engineer' && r.window === 'monthly' && r.reward_type === 'cash_bonus')
    .sort((a, b) => a.threshold - b.threshold);
  let monthlyBonusCents = 0; let monthlyTierHrs = 0;
  for (const t of monthlyTiers) if (monthHours >= t.threshold) { monthlyBonusCents = t.reward_value; monthlyTierHrs = t.threshold; }
  const nextMonthly = monthlyTiers.find((t) => monthHours < t.threshold) || null;

  // Quarterly kicker = $1/hour (rate from the rule), no milestone.
  const kicker = REWARD_RULES.find((r) => r.track === 'engineer' && r.reward_type === 'cash_per_hour');
  const quarterlyKickerCents = kicker ? Math.round(quarterHours * kicker.reward_value) : 0;

  return NextResponse.json({
    engineerName,
    launched: !!launchDate,
    launchDate: launchDate ? launchDate.toISOString().slice(0, 10) : null,
    monthHours, quarterHours,
    monthlyBonusCents, monthlyTierHrs,
    nextMonthly: nextMonthly ? { threshold: nextMonthly.threshold, bonusCents: nextMonthly.reward_value } : null,
    quarterlyKickerCents,
  });
}
