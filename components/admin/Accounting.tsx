'use client';

import { useState, useEffect, useMemo } from 'react';
import { DollarSign, TrendingUp, Calendar, Music, Users, Filter, ChevronDown } from 'lucide-react';
import { formatCents, formatDuration } from '@/lib/utils';
import { fmtSessionDate, fmtStampDate } from '@/lib/studio-time';
import { PRODUCER_COMMISSION, PLATFORM_COMMISSION, ENGINEER_SESSION_SPLIT, BUSINESS_SESSION_SPLIT, MEDIA_SELLER_COMMISSION, MEDIA_BUSINESS_CUT, MEDIA_WORKER_TOTAL } from '@/lib/constants';
import { computeEarningsCore, normalizeName, revenueConfigFromConstants, type PersonEarnings } from '@/lib/earnings-core';
import CreditsLiabilityPanel from './CreditsLiabilityPanel';
import PackageAccounting from './PackageAccounting';
import CashCorrectionsLog from './CashCorrectionsLog';
import TaxExpenses from './TaxExpenses';
import { depositCollectedCents } from '@/lib/deposit';

interface Booking {
  id: string;
  customer_name: string;
  customer_email: string;
  start_time: string;
  duration: number;
  total_amount: number;
  service_value_cents?: number | null; // full value of the work — staff paid on this
  reward_grant_id?: string | null;     // set when a reward funded/discounted this booking
  engineer_split_pct?: number | null;  // split snapshot stamped at completion (bands 70%, overrides)
  deposit_amount: number;
  remainder_amount: number;
  actual_deposit_paid: number | null;
  status: string;
  engineer_name: string | null;
  room: string | null;
  // Round 7c: surface band attribution + Sweet Spot bundle so the
  // accounting tab can split solo vs. band revenue.
  band_id: string | null;
  booking_group_id: string | null;
  sweet_spot_addon: { tier?: string; price_cents?: number } | null;
  created_at: string;
}

interface BeatPurchase {
  id: string;
  beat_id: string;
  buyer_email: string;
  license_type: string;
  amount_paid: number;
  created_at: string;
  beats: { title: string; producer: string } | null;
}

type View = 'overview' | 'profit' | 'payroll' | 'sessions' | 'beats' | 'media';
type DatePreset = 'thisMonth' | 'lastMonth' | 'month' | '30d' | '90d' | 'year' | 'custom';

function getMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    options.push({ value, label });
  }
  return options;
}

function getDateRange(preset: DatePreset, selectedMonth?: string): { from: string; to: string } | null {
  const now = new Date();
  if (preset === 'thisMonth') {
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const to = now.toISOString().split('T')[0];
    return { from, to };
  }
  if (preset === 'lastMonth') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
    return { from, to };
  }
  if (preset === 'month' && selectedMonth) {
    const [y, m] = selectedMonth.split('-').map(Number);
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(y, m, 0);
    const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
    return { from, to };
  }
  if (preset === '30d') {
    const from = new Date(now); from.setDate(from.getDate() - 30);
    return { from: from.toISOString().split('T')[0], to: now.toISOString().split('T')[0] };
  }
  if (preset === '90d') {
    const from = new Date(now); from.setDate(from.getDate() - 90);
    return { from: from.toISOString().split('T')[0], to: now.toISOString().split('T')[0] };
  }
  if (preset === 'year') {
    const from = new Date(now); from.setFullYear(from.getFullYear() - 1);
    return { from: from.toISOString().split('T')[0], to: now.toISOString().split('T')[0] };
  }
  return null;
}

const LICENSE_LABELS: Record<string, string> = {
  mp3_lease: 'MP3 Lease',
  wav_lease: 'WAV Lease',
  trackout_lease: 'Trackout Lease',
  unlimited: 'Unlimited',
  exclusive: 'Exclusive',
};

// NAME_MAP + normalizeName moved to lib/earnings-core.ts (imported above) so the
// payroll math + the golden test bucket names identically. Historical aliases
// (the Zion-rename lesson) live there now.

// URL/DOM-id-safe slug for names. Only used for scroll anchors on paystub
// cards — not shown to users, not stored in DB. Falls back to a generic
// token if the input is empty so we never emit `id=""`.
function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'unknown';
}

export default function Accounting() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [beatPurchases, setBeatPurchases] = useState<BeatPurchase[]>([]);
  const [mediaSales, setMediaSales] = useState<{ id: string; description: string; amount: number; sale_type: string; sold_by: string | null; filmed_by: string | null; edited_by: string | null; client_name: string | null; notes: string | null; created_at: string }[]>([]);
  // Round 7b: media_bookings (Hub package orders) — distinct from media_sales
  // (legacy line items). Date-filtered just like other Accounting data.
  const [mediaBookings, setMediaBookings] = useState<
    Array<{
      id: string;
      offering_id: string;
      user_id: string;
      status: string;
      final_price_cents: number;
      deposit_cents: number | null;
      actual_deposit_paid: number | null;
      deposit_paid_at: string | null;
      final_paid_at: string | null;
      created_by: string | null;
      created_at: string;
    }>
  >([]);
  // Paid installments for the period's media bookings. This ledger — not
  // media_bookings.actual_deposit_paid (untouched by installment payments) — is
  // the real "collected" source for installment-plan contracts.
  const [mediaInstallments, setMediaInstallments] = useState<
    Array<{ booking_id: string; amount_cents: number; status: string; paid_at: string | null }>
  >([]);
  const [mediaOfferingMap, setMediaOfferingMap] = useState<Record<string, string>>({});
  // Round 7c: band display_names so the band-revenue panel renders
  // human-readable band names without a separate fetch.
  const [bandMap, setBandMap] = useState<Record<string, string>>({});
  const [cancelledBookings, setCancelledBookings] = useState<{ id: string; customer_name: string; start_time: string; total_amount: number; deposit_amount: number; actual_deposit_paid: number | null }[]>([]);
  const [cashLedger, setCashLedger] = useState<{ id: string; engineer_name: string; amount: number; client_name: string; note: string | null; status: string; created_at: string; booking_id: string | null; deposit_event_id?: string | null; deposited_at?: string | null; collection_event_id?: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('overview');
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [engineerFilter, setEngineerFilter] = useState('all');
  const [producerFilter, setProducerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [payrollPeriodIndex, setPayrollPeriodIndex] = useState(1); // 0=current, 1=last completed

  // All-time data for payroll (never date-filtered)
  const [allTimeBookings, setAllTimeBookings] = useState<Booking[]>([]);
  const [allTimeMediaSales, setAllTimeMediaSales] = useState<typeof mediaSales>([]);
  // Period-filtered pay rows for the Overview's EXACT payroll figure
  const [periodMediaSessions, setPeriodMediaSessions] = useState<typeof allTimeMediaSessions>([]);
  const [periodPackageCommissions, setPeriodPackageCommissions] = useState<typeof allTimePackageCommissions>([]);
  const [periodRewardBonuses, setPeriodRewardBonuses] = useState<typeof allTimeRewardBonuses>([]);
  const [allTimeBeatPurchases, setAllTimeBeatPurchases] = useState<BeatPurchase[]>([]);
  const [allTimeCancelledBookings, setAllTimeCancelledBookings] = useState<typeof cancelledBookings>([]);
  // Phase E follow-up: media_session_bookings completed payouts. Kept as a
  // parallel array (vs. merged into mediaSales) because the shapes differ
  // and we want the data fed straight into computeEarnings without breaking
  // the legacy media_sales reading paths. The engineerNameMap translates
  // engineer_id → display name (matched against the ENGINEERS roster).
  const [allTimeMediaSessions, setAllTimeMediaSessions] = useState<
    Array<{
      id: string;
      engineer_id: string;
      starts_at: string;
      session_kind: string;
      location: string;
      engineer_payout_cents: number | null;
    }>
  >([]);
  const [engineerNameMap, setEngineerNameMap] = useState<Record<string, string>>({});
  // Package salesperson commissions — snapshotted onto entitlements at
  // mint time (when the customer paid). Each row credits one
  // salesperson with sales_commission_cents. Fed into computeEarnings
  // so package commissions land in the same per-person payroll buckets
  // as session/media/beat pay.
  const [allTimePackageCommissions, setAllTimePackageCommissions] = useState<
    Array<{
      id: string;
      salesperson_name: string | null;
      sales_commission_cents: number | null;
      created_at: string;
      quote_id: string;
      template_id: string;
    }>
  >([]);
  // Staff cash bonuses (reward_grants). 'approved'/'issued' = earned/owed (added to
  // payroll like sessions); paid is tracked via payroll_payouts. Funded from the
  // studio's cut, on top of base comp.
  const [allTimeRewardBonuses, setAllTimeRewardBonuses] = useState<
    Array<{ id: string; person_name: string; value_cents: number; status: string; period_key: string; rule_key: string; created_at: string; redeemed_at: string | null }>
  >([]);

  // Payout tracking
  const [payouts, setPayouts] = useState<{ id: string; person_name: string; amount: number; method: string; note: string | null; period_label: string | null; created_at: string }[]>([]);
  const [showPayoutForm, setShowPayoutForm] = useState<string | null>(null); // person name
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('cash');
  const [payoutNote, setPayoutNote] = useState('');
  // The pay period this payout is being recorded *for*. Defaults to the
  // currently-viewed pay period when the form opens, but the admin can
  // override — e.g., paying someone in April for work done in March. We
  // keep this separate from `payrollData.periodLabel` (the dropdown view)
  // so changing the view doesn't silently re-label an in-progress payout.
  const [payoutPeriodLabel, setPayoutPeriodLabel] = useState('');
  const [recordingPayout, setRecordingPayout] = useState(false);

  // Deposit modal state — admins use this to move cash from 'collected' to 'deposited'
  // in a single audit-trailed batch. The modal is rendered near the bottom of the
  // component; state lives here so the trigger button (inside the cash panel IIFE)
  // can open it and pre-populate with the engineer's collected-but-not-deposited rows.
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositSelectedIds, setDepositSelectedIds] = useState<Set<string>>(new Set());
  const [depositReference, setDepositReference] = useState('');
  const [depositNote, setDepositNote] = useState('');
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [depositError, setDepositError] = useState<{
    warning: string;
    issues: Array<{ entryId: string; reason: string }>;
  } | null>(null);

  const monthOptions = getMonthOptions();

  // Fetch all-time data for payroll on mount
  useEffect(() => {
    fetchPayrollData();
  }, []);

  // Fetch date-filtered data for overview/sessions/beats/media
  useEffect(() => {
    fetchData();
  }, [datePreset, selectedMonth, customFrom, customTo]);

  async function fetchPayrollData() {
    const [accountingRes, payoutsRes, cashRes] = await Promise.all([
      fetch('/api/admin/accounting'), // no date filter = all time
      fetch('/api/admin/payouts'),
      fetch('/api/admin/cash-ledger'),
    ]);
    const data = await accountingRes.json();
    const payoutsData = await payoutsRes.json();
    const cashData = await cashRes.json();
    setAllTimeBookings(data.bookings || []);
    setAllTimeBeatPurchases(data.beatPurchases || []);
    setAllTimeMediaSales(data.mediaSales || []);
    setAllTimeCancelledBookings(data.cancelledBookings || []);
    setAllTimeMediaSessions(data.mediaSessions || []);
    setAllTimePackageCommissions(data.packageCommissions || []);
    setAllTimeRewardBonuses(data.rewardBonuses || []);
    setEngineerNameMap(data.engineerNameMap || {});
    setPayouts(payoutsData.payouts || []);
    setCashLedger(cashData.entries || []);
  }

  async function fetchData() {
    setLoading(true);
    const range = datePreset === 'custom'
      ? (customFrom ? { from: customFrom, to: customTo || new Date().toISOString().split('T')[0] } : null)
      : getDateRange(datePreset, selectedMonth);

    const params = new URLSearchParams();
    if (range?.from) params.set('from', range.from);
    if (range?.to) params.set('to', range.to);

    const accountingRes = await fetch(`/api/admin/accounting?${params}`);
    const data = await accountingRes.json();
    setBookings(data.bookings || []);
    setBeatPurchases(data.beatPurchases || []);
    setMediaSales(data.mediaSales || []);
    setCancelledBookings(data.cancelledBookings || []);
    setMediaBookings(data.mediaBookings || []);
    setMediaInstallments(data.mediaInstallments || []);
    setMediaOfferingMap(data.mediaOfferingMap || {});
    setBandMap(data.bandMap || {});
    // Period-filtered pay rows — the route already returns these; the Overview
    // payroll figure runs the EXACT earnings engine over them (no estimates).
    setPeriodMediaSessions(data.mediaSessions || []);
    setPeriodPackageCommissions(data.packageCommissions || []);
    setPeriodRewardBonuses(data.rewardBonuses || []);
    if (data.engineerNameMap) setEngineerNameMap(data.engineerNameMap);
    setLoading(false);
  }

  async function recordPayout(personName: string, earningsData?: { sessionPay: number; sessionCount: number; sessionHours: number; mediaCommission: number; mediaWorkerPay: number; beatProducerPay: number; packageCommission: number; totalEarned: number; totalPaid: number }) {
    if (!payoutAmount) return;
    setRecordingPayout(true);
    const res = await fetch('/api/admin/payouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personName,
        amount: parseFloat(payoutAmount),
        method: payoutMethod,
        note: payoutNote || null,
        // Explicit period label chosen on the form; fall back to the
        // currently-viewed period for safety if the form never set one
        // (shouldn't happen via the real UI path, but defends the POST).
        periodLabel: payoutPeriodLabel || payrollData.periodLabel,
        earnings: earningsData || null,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setPayouts(prev => [data.payout, ...prev]);
      setShowPayoutForm(null);
      setPayoutAmount('');
      setPayoutNote('');
      setPayoutMethod('cash');
      setPayoutPeriodLabel('');
    } else {
      alert(`Failed: ${data.error}`);
    }
    setRecordingPayout(false);
  }

  /**
   * Submit a bank deposit for the currently selected cash_ledger entries.
   *
   * The server rejects the entire batch if any entry is not in status='collected'
   * (e.g., an entry that never had its collection recorded, or a double-deposit
   * attempt). We surface that warning inline rather than hiding it — the whole
   * point of this flow is to catch accounting errors, not paper over them.
   */
  async function submitDeposit() {
    if (depositSelectedIds.size === 0) return;
    setDepositSubmitting(true);
    setDepositError(null);
    try {
      const res = await fetch('/api/admin/cash-deposits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryIds: Array.from(depositSelectedIds),
          reference: depositReference.trim() || undefined,
          note: depositNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // The server speaks in 'issues' when the batch contains non-collected rows.
        // If issues exist, render them in the warning panel; otherwise show a
        // generic error.
        if (Array.isArray(data.issues)) {
          setDepositError({
            warning: data.warning || data.error || 'Accounting issues detected.',
            issues: data.issues,
          });
        } else {
          alert(`Deposit failed: ${data.error || 'Unknown error'}`);
        }
        return;
      }
      // Success — refresh cash ledger, close modal, reset form.
      await fetchPayrollData();
      setShowDepositModal(false);
      setDepositSelectedIds(new Set());
      setDepositReference('');
      setDepositNote('');
    } catch (e) {
      alert(`Deposit failed: ${e instanceof Error ? e.message : 'Network error'}`);
    } finally {
      setDepositSubmitting(false);
    }
  }

  // Derived data
  const filteredBookings = useMemo(() => {
    let result = bookings;
    if (engineerFilter !== 'all') {
      result = result.filter((b) => (normalizeName(b.engineer_name) || 'Unassigned') === engineerFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter((b) => b.status === statusFilter);
    }
    return result;
  }, [bookings, engineerFilter, statusFilter]);

  const filteredPurchases = useMemo(() => {
    if (producerFilter === 'all') return beatPurchases;
    return beatPurchases.filter((p) => (p.beats?.producer || 'Unknown') === producerFilter);
  }, [beatPurchases, producerFilter]);

  // Engineers list (normalized names)
  const engineers = useMemo(() => {
    const set = new Set(bookings.map((b) => normalizeName(b.engineer_name) || 'Unassigned'));
    return Array.from(set).sort();
  }, [bookings]);

  // Producers list
  const producers = useMemo(() => {
    const set = new Set(beatPurchases.map((p) => p.beats?.producer || 'Unknown'));
    return Array.from(set).sort();
  }, [beatPurchases]);

  // Session stats
  const sessionStats = useMemo(() => {
    const completed = filteredBookings.filter((b) => b.status === 'completed');
    const confirmed = filteredBookings.filter((b) => ['confirmed', 'pending', 'pending_approval'].includes(b.status));
    const totalBooked = filteredBookings.reduce((s, b) => s + b.total_amount, 0);
    const depositsCollected = filteredBookings.reduce((s, b) => s + (b.actual_deposit_paid || 0), 0);
    const completedRevenue = completed.reduce((s, b) => s + b.total_amount, 0);
    const remainderOutstanding = confirmed.reduce((s, b) => s + b.remainder_amount, 0);
    const totalHours = filteredBookings.reduce((s, b) => s + b.duration, 0);
    return { total: filteredBookings.length, completed: completed.length, totalBooked, depositsCollected, completedRevenue, remainderOutstanding, totalHours };
  }, [filteredBookings]);

  // Beat stats
  const beatStats = useMemo(() => {
    const totalRevenue = filteredPurchases.reduce((s, p) => s + p.amount_paid, 0);
    const byLicense: Record<string, { count: number; revenue: number }> = {};
    filteredPurchases.forEach((p) => {
      if (!byLicense[p.license_type]) byLicense[p.license_type] = { count: 0, revenue: 0 };
      byLicense[p.license_type].count++;
      byLicense[p.license_type].revenue += p.amount_paid;
    });
    const platformCut = Math.round(totalRevenue * PLATFORM_COMMISSION);
    const producerCut = Math.round(totalRevenue * PRODUCER_COMMISSION);
    return { total: filteredPurchases.length, totalRevenue, platformCut, producerCut, byLicense };
  }, [filteredPurchases]);

  // Breakdowns
  const sessionsByEngineer = useMemo(() => {
    const map: Record<string, { count: number; revenue: number; hours: number; deposits: number }> = {};
    filteredBookings.forEach((b) => {
      const eng = normalizeName(b.engineer_name) || 'Unassigned';
      if (!map[eng]) map[eng] = { count: 0, revenue: 0, hours: 0, deposits: 0 };
      map[eng].count++;
      map[eng].revenue += b.total_amount;
      map[eng].hours += b.duration;
      map[eng].deposits += (b.actual_deposit_paid || 0);
    });
    return Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue);
  }, [filteredBookings]);

  const sessionsByRoom = useMemo(() => {
    const map: Record<string, { count: number; revenue: number; hours: number }> = {};
    filteredBookings.forEach((b) => {
      const room = b.room || 'Unknown';
      if (!map[room]) map[room] = { count: 0, revenue: 0, hours: 0 };
      map[room].count++;
      map[room].revenue += b.total_amount;
      map[room].hours += b.duration;
    });
    return Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue);
  }, [filteredBookings]);

  const sessionsByStatus = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    filteredBookings.forEach((b) => {
      if (!map[b.status]) map[b.status] = { count: 0, revenue: 0 };
      map[b.status].count++;
      map[b.status].revenue += b.total_amount;
    });
    return Object.entries(map).sort((a, b) => b[1].count - a[1].count);
  }, [filteredBookings]);

  const sessionsByMonth = useMemo(() => {
    const map: Record<string, { count: number; revenue: number; hours: number }> = {};
    filteredBookings.forEach((b) => {
      const d = new Date(b.start_time);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!map[key]) map[key] = { count: 0, revenue: 0, hours: 0 };
      map[key].count++;
      map[key].revenue += b.total_amount;
      map[key].hours += b.duration;
    });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredBookings]);

  const beatsByProducer = useMemo(() => {
    const map: Record<string, { count: number; revenue: number; producerCut: number; platformCut: number }> = {};
    filteredPurchases.forEach((p) => {
      const prod = p.beats?.producer || 'Unknown';
      if (!map[prod]) map[prod] = { count: 0, revenue: 0, producerCut: 0, platformCut: 0 };
      map[prod].count++;
      map[prod].revenue += p.amount_paid;
      map[prod].producerCut += Math.round(p.amount_paid * PRODUCER_COMMISSION);
      map[prod].platformCut += Math.round(p.amount_paid * PLATFORM_COMMISSION);
    });
    return Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue);
  }, [filteredPurchases]);

  // Media stats
  const mediaStats = useMemo(() => {
    const totalRevenue = mediaSales.reduce((s, m) => s + m.amount, 0);
    const totalSellerCommissions = mediaSales.reduce((s, m) => s + (m.sold_by ? Math.round(m.amount * MEDIA_SELLER_COMMISSION) : 0), 0);
    // Workers split 50%: if both filmed_by and edited_by exist, each gets 25%. If only one, they get 50%.
    const totalFilmerPay = mediaSales.reduce((s, m) => {
      if (!m.filmed_by) return s;
      const workerCount = (m.filmed_by ? 1 : 0) + (m.edited_by ? 1 : 0);
      return s + Math.round(m.amount * MEDIA_WORKER_TOTAL / workerCount);
    }, 0);
    const totalEditorPay = mediaSales.reduce((s, m) => {
      if (!m.edited_by) return s;
      const workerCount = (m.filmed_by ? 1 : 0) + (m.edited_by ? 1 : 0);
      return s + Math.round(m.amount * MEDIA_WORKER_TOTAL / workerCount);
    }, 0);
    const totalWorkerPay = totalFilmerPay + totalEditorPay;
    const totalPayouts = totalSellerCommissions + totalWorkerPay;
    const businessRevenue = Math.round(totalRevenue * MEDIA_BUSINESS_CUT);

    const byType: Record<string, { count: number; revenue: number }> = {};
    mediaSales.forEach(m => {
      const type = m.sale_type || 'other';
      if (!byType[type]) byType[type] = { count: 0, revenue: 0 };
      byType[type].count++;
      byType[type].revenue += m.amount;
    });

    const personPayouts: Record<string, { soldCount: number; soldRevenue: number; sellerCommission: number; filmedCount: number; filmedPay: number; editedCount: number; editedPay: number; totalPay: number }> = {};
    const initPerson = () => ({ soldCount: 0, soldRevenue: 0, sellerCommission: 0, filmedCount: 0, filmedPay: 0, editedCount: 0, editedPay: 0, totalPay: 0 });
    mediaSales.forEach(m => {
      if (m.sold_by) {
        if (!personPayouts[m.sold_by]) personPayouts[m.sold_by] = initPerson();
        personPayouts[m.sold_by].soldCount++;
        personPayouts[m.sold_by].soldRevenue += m.amount;
        const comm = Math.round(m.amount * MEDIA_SELLER_COMMISSION);
        personPayouts[m.sold_by].sellerCommission += comm;
        personPayouts[m.sold_by].totalPay += comm;
      }
      // Workers split 50%: if both exist each gets 25%, if only one they get 50%
      const workerCount = (m.filmed_by ? 1 : 0) + (m.edited_by ? 1 : 0);
      if (m.filmed_by) {
        if (!personPayouts[m.filmed_by]) personPayouts[m.filmed_by] = initPerson();
        personPayouts[m.filmed_by].filmedCount++;
        const pay = Math.round(m.amount * MEDIA_WORKER_TOTAL / workerCount);
        personPayouts[m.filmed_by].filmedPay += pay;
        personPayouts[m.filmed_by].totalPay += pay;
      }
      if (m.edited_by) {
        if (!personPayouts[m.edited_by]) personPayouts[m.edited_by] = initPerson();
        personPayouts[m.edited_by].editedCount++;
        const pay = Math.round(m.amount * MEDIA_WORKER_TOTAL / workerCount);
        personPayouts[m.edited_by].editedPay += pay;
        personPayouts[m.edited_by].totalPay += pay;
      }
    });

    return {
      total: mediaSales.length, totalRevenue, totalSellerCommissions, totalFilmerPay, totalEditorPay, totalWorkerPay, totalPayouts, businessRevenue,
      byType, personPayouts: Object.entries(personPayouts).sort((a, b) => b[1].totalPay - a[1].totalPay),
    };
  }, [mediaSales]);

  // Round 7b: Media Bookings (Hub package orders) stats. Distinct from
  // mediaStats above which crunches the legacy line-item table.
  //
  // Definitions:
  //   - revenue: sum of final_price_cents (what the buyer is on the hook for)
  //   - collected: sum of actual_deposit_paid (real money in the door)
  //   - outstanding: sum of (final_price_cents - actual_deposit_paid) where
  //     not yet final_paid_at — the receivables balance
  //
  // is_test rows are already excluded server-side; cancelled rows too.
  const mediaBookingStats = useMemo(() => {
    // Sum PAID installments per booking. This ledger — NOT
    // media_bookings.actual_deposit_paid, which stays 0 for installment-plan
    // contracts — is where contract payments actually land.
    const paidByBooking: Record<string, number> = {};
    for (const inst of mediaInstallments) {
      if (inst.status !== 'paid') continue;
      paidByBooking[inst.booking_id] = (paidByBooking[inst.booking_id] || 0) + (inst.amount_cents || 0);
    }

    const total = mediaBookings.length;
    let revenue = 0;
    let collected = 0;
    let outstanding = 0;
    let depositsCount = 0;
    let fullyPaidCount = 0;
    const byOffering: Record<string, { count: number; revenue: number; collected: number }> = {};
    const byStatus: Record<string, number> = {};

    for (const b of mediaBookings) {
      const price = b.final_price_cents ?? 0;
      // Collected = paid installments when the booking has an installment plan;
      // otherwise the legacy actual_deposit_paid field. A booking uses one path
      // or the other, so this never double-counts.
      const paid = paidByBooking[b.id] !== undefined
        ? paidByBooking[b.id]
        : (b.actual_deposit_paid ?? 0);
      revenue += price;
      collected += paid;
      const owed = Math.max(0, price - paid);
      if (!b.final_paid_at) outstanding += owed;
      if (b.deposit_paid_at || paid > 0) depositsCount += 1;
      if (b.final_paid_at) fullyPaidCount += 1;
      const offeringTitle = mediaOfferingMap[b.offering_id] || 'Unknown offering';
      if (!byOffering[offeringTitle]) byOffering[offeringTitle] = { count: 0, revenue: 0, collected: 0 };
      byOffering[offeringTitle].count++;
      byOffering[offeringTitle].revenue += price;
      byOffering[offeringTitle].collected += paid;
      byStatus[b.status] = (byStatus[b.status] || 0) + 1;
    }
    const businessCut = Math.round(revenue * MEDIA_BUSINESS_CUT);
    return {
      total, revenue, collected, outstanding, depositsCount, fullyPaidCount,
      businessCut,
      byOffering: Object.entries(byOffering).sort((a, b) => b[1].revenue - a[1].revenue),
      byStatus,
    };
  }, [mediaBookings, mediaInstallments, mediaOfferingMap]);

  // Round 7c: Band-session revenue slice.
  //
  // Bands and solo sessions live on the same `bookings` table. We split
  // them by `band_id IS NOT NULL` to give admins a clean per-stream view.
  // The 3×8 booking_group_id fields let us count band PROJECTS (one per
  // group) separately from band sessions (one per day-row).
  //
  // Sweet Spot revenue is surfaced as its own line because the bundle
  // pricing tiers (standalone $2,500 / 8hr add-on $2,000 / 3×8 add-on
  // $1,000) carry different margins and admin wants visibility.
  const bandSessionStats = useMemo(() => {
    const bandBookings = bookings.filter((b) => !!b.band_id);
    const total = bandBookings.length;
    const bookedRevenue = bandBookings.reduce((s, b) => s + (b.total_amount || 0), 0);
    const collectedRevenue = bandBookings.reduce(
      (s, b) => s + depositCollectedCents(b),
      0,
    );
    const outstanding = bandBookings.reduce((s, b) => s + (b.remainder_amount || 0), 0);

    // Project-level grouping: 3×8 = three rows but ONE project. Count
    // unique booking_group_id values (NULL group_id = single-day = its
    // own project, counted as 1 per row).
    const projects = new Set<string>();
    for (const b of bandBookings) {
      projects.add(b.booking_group_id || `solo:${b.id}`);
    }

    // Sweet Spot bundle revenue (standalone tier added separately)
    let sweetSpotRevenue = 0;
    let sweetSpotCount = 0;
    for (const b of bandBookings) {
      const addon = b.sweet_spot_addon;
      if (addon && typeof addon.price_cents === 'number') {
        sweetSpotRevenue += addon.price_cents;
        sweetSpotCount += 1;
      }
    }

    // Per-band breakdown
    const byBand: Record<string, { count: number; booked: number; collected: number }> = {};
    for (const b of bandBookings) {
      const id = b.band_id!;
      const name = bandMap[id] || 'Unknown band';
      if (!byBand[name]) byBand[name] = { count: 0, booked: 0, collected: 0 };
      byBand[name].count += 1;
      byBand[name].booked += b.total_amount || 0;
      byBand[name].collected += depositCollectedCents(b);
    }

    return {
      total,
      projectCount: projects.size,
      bookedRevenue,
      collectedRevenue,
      outstanding,
      sweetSpotRevenue,
      sweetSpotCount,
      byBand: Object.entries(byBand).sort((a, b) => b[1].booked - a[1].booked),
    };
  }, [bookings, bandMap]);

  // ===== Per-person earnings — math lives in lib/earnings-core.ts =====
  // ACTUAL payroll resolves per row as: snapshot (frozen % stamped at
  // completion/sale) ?? constant. We pass the CONSTANTS (not the live DB config)
  // as the fallback ON PURPOSE — so an admin's share edit can never retroactively
  // move historical, un-snapshotted rows. The live DB config is applied only at
  // snapshot-write time (future work) and in the what-if simulator.
  function computeEarnings(
    bks: Booking[],
    media: typeof allTimeMediaSales,
    beats: BeatPurchase[],
    mediaSessions: typeof allTimeMediaSessions = [],
    engineerNames: Record<string, string> = {},
    packageCommissions: typeof allTimePackageCommissions = [],
    bonuses: typeof allTimeRewardBonuses = [],
  ): Record<string, PersonEarnings> {
    return computeEarningsCore(
      { bookings: bks, media, beats, mediaSessions, engineerNames, packageCommissions, bonuses },
      revenueConfigFromConstants(),
    );
  }

  // Generate pay period options (last 12 periods)
  const payPeriods = useMemo(() => {
    const periods: { label: string; start: string; end: string }[] = [];
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth();
    let isFirstHalf = now.getDate() <= 15;

    // Generate 12 periods going backwards from current
    for (let i = 0; i < 12; i++) {
      let start: Date, end: Date, label: string;
      const monthName = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'short' });

      if (isFirstHalf) {
        start = new Date(year, month, 1);
        end = new Date(year, month, 15, 23, 59, 59);
        label = `${monthName} 1–15, ${year}`;
      } else {
        start = new Date(year, month, 16);
        end = new Date(year, month + 1, 0, 23, 59, 59);
        label = `${monthName} 16–${end.getDate()}, ${year}`;
      }

      periods.push({ label, start: start.toISOString(), end: end.toISOString() });

      // Move to previous period
      if (isFirstHalf) {
        month--;
        if (month < 0) { month = 11; year--; }
        isFirstHalf = false;
      } else {
        isFirstHalf = true;
      }
    }
    return periods;
  }, []);

  // ===== PAYROLL: Selected period + all-time earnings =====
  const payrollData = useMemo(() => {
    // All-time earnings
    const allTimePeople = computeEarnings(
      allTimeBookings,
      allTimeMediaSales,
      allTimeBeatPurchases,
      allTimeMediaSessions,
      engineerNameMap,
      allTimePackageCommissions,
      allTimeRewardBonuses,
    );

    // All-time payouts by person (normalized)
    const normalizedPayouts: Record<string, number> = {};
    payouts.forEach(p => {
      const name = normalizeName(p.person_name) || p.person_name;
      normalizedPayouts[name] = (normalizedPayouts[name] || 0) + p.amount;
    });

    // Selected pay period
    const selectedPeriod = payPeriods[payrollPeriodIndex] || payPeriods[0];
    const periodLabel = selectedPeriod.label;
    const periodStartStr = selectedPeriod.start;
    const periodEndStr = selectedPeriod.end;

    // Filter data to current pay period
    const periodBookings = allTimeBookings.filter(b => b.start_time >= periodStartStr && b.start_time <= periodEndStr);
    const periodMedia = allTimeMediaSales.filter(m => m.created_at >= periodStartStr && m.created_at <= periodEndStr);
    const periodBeats = allTimeBeatPurchases.filter(p => p.created_at >= periodStartStr && p.created_at <= periodEndStr);
    // Phase E: media sessions filtered to the pay period by starts_at (when
    // the session happened, not when admin recorded the payout). This matches
    // how bookings are filtered — engineers earn for the period they worked.
    const periodMediaSessions = allTimeMediaSessions.filter(
      (s) => s.starts_at >= periodStartStr && s.starts_at <= periodEndStr,
    );
    // Package commissions filtered to the pay period by created_at (the
    // mint timestamp = when the customer paid = when the commission was
    // earned).
    const periodPackageCommissions = allTimePackageCommissions.filter(
      (pc) => pc.created_at >= periodStartStr && pc.created_at <= periodEndStr,
    );
    const periodRewardBonuses = allTimeRewardBonuses.filter(
      (bn) => bn.created_at >= periodStartStr && bn.created_at <= periodEndStr,
    );
    const periodPeople = computeEarnings(
      periodBookings,
      periodMedia,
      periodBeats,
      periodMediaSessions,
      engineerNameMap,
      periodPackageCommissions,
      periodRewardBonuses,
    );

    // Pending sessions this period — bookings scheduled within the period that
    // have NOT yet been marked completed. These don't add to earned/balance
    // (the engineer hasn't done the work yet in the accounting sense), but we
    // surface them so admins can see engineers who have upcoming/ongoing work.
    // Without this, an engineer whose sessions are still 'confirmed' is
    // invisible on the payroll screen even though their sessions are this
    // period — which caused the "Jay isn't showing up" bug.
    const pendingByEngineer: Record<string, { count: number; potentialPay: number; hours: number }> = {};
    periodBookings.forEach(b => {
      if (b.status === 'completed' || b.status === 'cancelled') return;
      const eng = normalizeName(b.engineer_name);
      if (!eng || eng === 'Unassigned') return;
      if (!pendingByEngineer[eng]) pendingByEngineer[eng] = { count: 0, potentialPay: 0, hours: 0 };
      pendingByEngineer[eng].count++;
      pendingByEngineer[eng].potentialPay += Math.round((b.total_amount || 0) * ENGINEER_SESSION_SPLIT);
      pendingByEngineer[eng].hours += (b.duration || 0);
    });

    // Payouts during this period
    const periodPayoutTotal = payouts
      .filter(p => p.created_at >= periodStartStr && p.created_at <= periodEndStr)
      .reduce((s, p) => s + p.amount, 0);

    // Build combined entries: all people who have either all-time earnings,
    // current period earnings, OR pending activity this period
    const allNames = new Set([
      ...Object.keys(allTimePeople),
      ...Object.keys(periodPeople),
      ...Object.keys(pendingByEngineer),
    ]);
    const initEmpty = (): PersonEarnings => ({ sessionCount: 0, sessionRevenue: 0, sessionPay: 0, sessionHours: 0, mediaCommission: 0, mediaSoldCount: 0, mediaWorkerPay: 0, mediaFilmedCount: 0, mediaEditedCount: 0, beatSales: 0, beatProducerPay: 0, beatCount: 0, packageCommission: 0, packageSoldCount: 0, rewardsCost: 0, bonusPay: 0, bonusCount: 0, totalPay: 0 });
    type PeriodPending = { count: number; potentialPay: number; hours: number };
    const entries: [string, PersonEarnings & { allTimeTotal: number; allTimePaid: number; balance: number; periodTotal: number; allTimeData: PersonEarnings; periodPending: PeriodPending }][] = [];

    for (const name of allNames) {
      const allTime = allTimePeople[name] || initEmpty();
      const period = periodPeople[name];
      const allTimePaid = normalizedPayouts[name] || 0;
      const allTimeTotal = allTime.totalPay;
      const balance = Math.max(0, allTimeTotal - allTimePaid);
      const periodTotal = period?.totalPay || 0;
      const periodPending = pendingByEngineer[name] || { count: 0, potentialPay: 0, hours: 0 };

      // Use period data for "this period" display, store allTime separately for full breakdown
      const display = period || allTime;

      entries.push([name, { ...display, allTimeTotal, allTimePaid, balance, periodTotal, allTimeData: allTime, periodPending }]);
    }

    // Sort by balance owed (most owed first), then by pending count so
    // engineers with upcoming sessions-to-complete surface above idle zeros
    entries.sort((a, b) => {
      if (b[1].balance !== a[1].balance) return b[1].balance - a[1].balance;
      if (b[1].periodTotal !== a[1].periodTotal) return b[1].periodTotal - a[1].periodTotal;
      if (b[1].periodPending.count !== a[1].periodPending.count) return b[1].periodPending.count - a[1].periodPending.count;
      return b[1].allTimeTotal - a[1].allTimeTotal;
    });

    // Show anyone who has a balance, earned this period, OR has pending work this period
    const activeEntries = entries.filter(
      ([, d]) => d.balance > 0 || d.periodTotal > 0 || d.periodPending.count > 0
    );

    const totalPayroll = entries.reduce((s, [, d]) => s + d.allTimeTotal, 0);
    const totalPaid = Object.values(normalizedPayouts).reduce((s, v) => s + v, 0);

    // Business keeps (all-time)
    const allTimeSessionRevenue = allTimeBookings.reduce((s, b) => s + b.total_amount, 0);
    const allTimeMediaRevenue = allTimeMediaSales.reduce((s, m) => s + m.amount, 0);
    const allTimeBeatRevenue = allTimeBeatPurchases.reduce((s, p) => s + p.amount_paid, 0);
    const totalGrossRevenue = allTimeSessionRevenue + allTimeMediaRevenue + allTimeBeatRevenue;
    const businessKeeps = totalGrossRevenue - totalPayroll;
    const keptDeposits = allTimeCancelledBookings.reduce((s, b) => s + (b.actual_deposit_paid || 0), 0);

    return {
      people: activeEntries,
      allPeople: entries,
      totalPayroll, totalPaid, normalizedPayouts,
      totalGrossRevenue, businessKeeps, keptDeposits,
      periodLabel, periodStart: periodStartStr, periodEnd: periodEndStr,
      periodPayoutTotal,
    };
  }, [allTimeBookings, allTimeMediaSales, allTimeBeatPurchases, allTimeCancelledBookings, allTimeMediaSessions, allTimePackageCommissions, allTimeRewardBonuses, engineerNameMap, payouts, payPeriods, payrollPeriodIndex]);

  // Payroll figure for the Overview — EXACT, not an estimate. Runs the same
  // earnings engine the Payroll tab pays from (per-row snapshot splits, the
  // service-value basis for comped sessions, media commissions, media-session
  // payouts, beat splits, package commissions, bonuses) over the period's
  // rows. Counts COMPLETED sessions only — staff aren't owed for sessions
  // that didn't happen. (The Profit tab's contract labor is what was PAID OUT
  // during the period — cash basis; bill pays lag, so the two can differ.)
  const filteredPayrollData = useMemo(() => {
    const totalBooked = filteredBookings.reduce((s, b) => s + b.total_amount, 0);
    const mediaRev = mediaSales.reduce((s, m) => s + m.amount, 0);
    const beatRev = filteredPurchases.reduce((s, p) => s + p.amount_paid, 0);
    const totalGross = totalBooked + mediaRev + beatRev;

    const earnings = computeEarnings(
      filteredBookings, mediaSales, filteredPurchases,
      periodMediaSessions, engineerNameMap, periodPackageCommissions, periodRewardBonuses,
    );
    const totalPayroll = Object.values(earnings).reduce((s, p) => s + p.totalPay, 0);
    const businessKeeps = totalGross - totalPayroll;
    const keptDeposits = cancelledBookings.reduce((s, b) => s + (b.actual_deposit_paid || 0), 0);

    return { totalGrossRevenue: totalGross, totalPayroll, businessKeeps, keptDeposits };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredBookings, mediaSales, filteredPurchases, cancelledBookings, periodMediaSessions, engineerNameMap, periodPackageCommissions, periodRewardBonuses]);

  const SALE_TYPE_LABELS: Record<string, string> = {
    video: 'Music Video',
    photo: 'Photo Shoot',
    content: 'Content Creation',
    other: 'Other',
  };

  const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    pending_approval: 'bg-orange-100 text-orange-800',
    confirmed: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-600',
  };

  const ROOM_LABELS: Record<string, string> = {
    studio_a: 'Studio A',
    studio_b: 'Studio B',
  };

  const views: { key: View; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'profit', label: 'Profit' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'sessions', label: 'Sessions' },
    { key: 'beats', label: 'Beat Sales' },
    { key: 'media', label: 'Media Sales' },
  ];

  function toggleSection(key: string) {
    setExpandedSection(expandedSection === key ? null : key);
  }

  return (
    <div>
      {/* View Tabs + Date Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div className="flex gap-1">
          {views.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 transition-colors ${
                view === v.key ? 'bg-black text-white' : 'bg-black/5 text-black/70 hover:bg-black/10'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Date presets — hidden on payroll because the pay-period dropdown
              inside that view IS the time control. Two time filters on the
              same screen was causing "why do I have a month selector AND a
              pay period AND they disagree?" confusion. */}
          {view !== 'payroll' && (
            <>
              <Filter className="w-4 h-4 text-black/30" />
              {([
                { key: 'thisMonth' as DatePreset, label: 'This Month' },
                { key: 'lastMonth' as DatePreset, label: 'Last Month' },
                { key: 'month' as DatePreset, label: 'Pick Month' },
                { key: '30d' as DatePreset, label: '30 Days' },
                { key: '90d' as DatePreset, label: '90 Days' },
                { key: 'year' as DatePreset, label: '1 Year' },
                { key: 'custom' as DatePreset, label: 'Custom' },
              ]).map((p) => (
                <button
                  key={p.key}
                  onClick={() => setDatePreset(p.key)}
                  className={`font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 transition-colors ${
                    datePreset === p.key ? 'bg-accent text-black' : 'bg-black/5 text-black/70 hover:bg-black/10'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </>
          )}
          {/* Engineer filter — visible on overview, sessions, payroll */}
          {(view === 'overview' || view === 'sessions' || view === 'payroll') && engineers.length > 0 && (
            <select
              value={engineerFilter}
              onChange={(e) => setEngineerFilter(e.target.value)}
              className="border border-black/20 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider focus:border-accent focus:outline-none bg-white"
            >
              <option value="all">All Engineers</option>
              {engineers.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          )}
        </div>
      </div>

      {view !== 'payroll' && datePreset === 'month' && (
        <div className="mb-6">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
          >
            <option value="">Select a month...</option>
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      )}

      {view !== 'payroll' && datePreset === 'custom' && (
        <div className="flex gap-3 mb-6 items-center">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
            className="border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none" />
          <span className="font-mono text-xs text-black/60">to</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
            className="border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none" />
        </div>
      )}

      {loading ? (
        <p className="font-mono text-sm text-black/70">Loading accounting data...</p>
      ) : (
        <>
          {/* ========= OVERVIEW ========= */}
          {view === 'overview' && (
            <div className="space-y-8">
              {/* Gross Revenue */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={DollarSign} label="Gross Revenue (All)" value={formatCents(filteredPayrollData.totalGrossRevenue)} accent />
                <StatCard icon={Calendar} label="Session Revenue" value={formatCents(sessionStats.totalBooked)} />
                <StatCard icon={Music} label="Beat Sales" value={formatCents(beatStats.totalRevenue)} />
                <StatCard icon={TrendingUp} label="Media Sales" value={formatCents(mediaStats.totalRevenue)} />
              </div>

              {/* Round 7b: Hub Orders revenue split — booked vs. collected vs. owed.
                  Shown as its own row so it doesn't muddy the legacy line-item math. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={TrendingUp} label="Hub Orders — Booked" value={formatCents(mediaBookingStats.revenue)} />
                <StatCard icon={DollarSign} label="Hub Orders — Collected" value={formatCents(mediaBookingStats.collected)} />
                <StatCard icon={DollarSign} label="Hub Orders — Outstanding" value={formatCents(mediaBookingStats.outstanding)} />
                <StatCard icon={Users} label="Hub Order Count" value={String(mediaBookingStats.total)} />
              </div>

              {/* Business Profit */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={DollarSign} label="Business Keeps" value={formatCents(filteredPayrollData.businessKeeps + filteredPayrollData.keptDeposits)} accent />
                <StatCard icon={Users} label="Staff Earnings (This Period's Work)" value={formatCents(filteredPayrollData.totalPayroll)} />
                <StatCard icon={DollarSign} label="Remainder Due" value={formatCents(sessionStats.remainderOutstanding)} />
                {filteredPayrollData.keptDeposits > 0 && (
                  <StatCard icon={DollarSign} label="Kept Deposits" value={formatCents(filteredPayrollData.keptDeposits)} />
                )}
              </div>

              {/* Business Profit Breakdown */}
              <div className="border border-black/10 p-4">
                <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3">Business Profit Breakdown</h3>
                <div className="space-y-2 font-mono text-sm">
                  <div className="flex justify-between py-1 border-b border-black/5">
                    <span className="text-black/60">Sessions — Business {Math.round(BUSINESS_SESSION_SPLIT * 100)}%</span>
                    <span className="font-bold">{formatCents(Math.round(sessionStats.totalBooked * BUSINESS_SESSION_SPLIT))}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-black/5">
                    <span className="text-black/60">Beat Sales — Platform {Math.round(PLATFORM_COMMISSION * 100)}%</span>
                    <span className="font-bold">{formatCents(beatStats.platformCut)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-black/5">
                    <span className="text-black/60">Media Sales — Business {Math.round(MEDIA_BUSINESS_CUT * 100)}%</span>
                    <span className="font-bold">{formatCents(mediaStats.businessRevenue)}</span>
                  </div>
                  {filteredPayrollData.keptDeposits > 0 && (
                    <div className="flex justify-between py-1 border-b border-black/5">
                      <span className="text-black/60">Kept Deposits (Cancelled Sessions)</span>
                      <span className="font-bold">{formatCents(filteredPayrollData.keptDeposits)}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-2 border-t-2 border-black/20">
                    <span className="font-bold text-accent">Total Business Profit</span>
                    <span className="font-bold text-accent text-lg">{formatCents(filteredPayrollData.businessKeeps + filteredPayrollData.keptDeposits)}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <StatCard icon={Calendar} label="Total Sessions" value={String(sessionStats.total)} />
                <StatCard icon={Calendar} label="Completed" value={`${sessionStats.completed} · ${formatCents(sessionStats.completedRevenue)}`} />
                <StatCard icon={Calendar} label="Upcoming" value={`${sessionStats.total - sessionStats.completed} · ${formatCents(sessionStats.totalBooked - sessionStats.completedRevenue)}`} />
                <StatCard icon={Calendar} label="Total Hours" value={`${sessionStats.totalHours}hr`} />
                <StatCard icon={DollarSign} label="Deposits Collected" value={formatCents(sessionStats.depositsCollected)} />
              </div>

              {cancelledBookings.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <StatCard icon={Calendar} label="Cancelled Sessions" value={String(cancelledBookings.length)} />
                  <StatCard icon={DollarSign} label="Deposits Kept (Card)" value={formatCents(cancelledBookings.reduce((s, b) => s + (b.actual_deposit_paid || 0), 0))} />
                  <StatCard icon={DollarSign} label="Total Kept from Cancelled" value={formatCents(cancelledBookings.reduce((s, b) => s + (b.actual_deposit_paid || 0), 0))} accent />
                </div>
              )}

              {/* Phase E — prepaid credits liability (deferred revenue) */}
              <CreditsLiabilityPanel />

              {/* Round F — packages & memberships rollup */}
              <div className="mt-6 border-t border-black/10 pt-6">
                <PackageAccounting />
              </div>

              {/* Cash corrections audit log — surfaces post-completion
                  edits engineers/admins make to cash totals. Appears
                  only when corrections exist. */}
              <CashCorrectionsLog />

              {/* Monthly breakdown */}
              {sessionsByMonth.length > 0 && (
                <BreakdownSection
                  title="Revenue by Month"
                  expanded={expandedSection === 'monthly'}
                  onToggle={() => toggleSection('monthly')}
                >
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-black/10">
                        <th className="text-left font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Month</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Sessions</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Hours</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessionsByMonth.map(([month, data]) => (
                        <tr key={month} className="border-b border-black/5">
                          <td className="font-mono text-sm py-2">{formatMonth(month)}</td>
                          <td className="font-mono text-sm text-right">{data.count}</td>
                          <td className="font-mono text-sm text-right">{data.hours}hr</td>
                          <td className="font-mono text-sm font-bold text-right">{formatCents(data.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </BreakdownSection>
              )}

              {/* By engineer */}
              {sessionsByEngineer.length > 0 && (
                <BreakdownSection
                  title="Sessions by Engineer"
                  expanded={expandedSection === 'engineer'}
                  onToggle={() => toggleSection('engineer')}
                >
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-black/10">
                        <th className="text-left font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Engineer</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Sessions</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Hours</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Deposits</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessionsByEngineer.map(([name, data]) => (
                        <tr key={name} className="border-b border-black/5">
                          <td className="font-mono text-sm font-semibold py-2">{name}</td>
                          <td className="font-mono text-sm text-right">{data.count}</td>
                          <td className="font-mono text-sm text-right">{data.hours}hr</td>
                          <td className="font-mono text-sm text-right text-black/70">{formatCents(data.deposits)}</td>
                          <td className="font-mono text-sm font-bold text-right">{formatCents(data.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </BreakdownSection>
              )}

              {/* By room */}
              {sessionsByRoom.length > 0 && (
                <BreakdownSection
                  title="Sessions by Studio"
                  expanded={expandedSection === 'room'}
                  onToggle={() => toggleSection('room')}
                >
                  {sessionsByRoom.map(([room, data]) => (
                    <div key={room} className="flex justify-between items-center py-2 border-b border-black/5">
                      <span className="font-mono text-sm font-semibold">{ROOM_LABELS[room] || room}</span>
                      <div className="flex gap-6 font-mono text-sm">
                        <span className="text-black/70">{data.count} sessions</span>
                        <span className="text-black/70">{data.hours}hr</span>
                        <span className="font-bold">{formatCents(data.revenue)}</span>
                      </div>
                    </div>
                  ))}
                </BreakdownSection>
              )}

              {/* Beat sales by producer */}
              {beatsByProducer.length > 0 && (
                <BreakdownSection
                  title="Beat Sales by Producer"
                  expanded={expandedSection === 'producer'}
                  onToggle={() => toggleSection('producer')}
                >
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-black/10">
                        <th className="text-left font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Producer</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Sales</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Gross</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Producer ({Math.round(PRODUCER_COMMISSION * 100)}%)</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Platform ({Math.round(PLATFORM_COMMISSION * 100)}%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {beatsByProducer.map(([name, data]) => (
                        <tr key={name} className="border-b border-black/5">
                          <td className="font-mono text-sm font-semibold py-2">{name}</td>
                          <td className="font-mono text-sm text-right">{data.count}</td>
                          <td className="font-mono text-sm text-right">{formatCents(data.revenue)}</td>
                          <td className="font-mono text-sm text-right text-black/70">{formatCents(data.producerCut)}</td>
                          <td className="font-mono text-sm font-bold text-right text-accent">{formatCents(data.platformCut)}</td>
                        </tr>
                      ))}
                      {beatsByProducer.length > 1 && (
                        <tr className="border-t-2 border-black/20">
                          <td className="font-mono text-sm font-bold py-2">TOTAL</td>
                          <td className="font-mono text-sm text-right font-bold">{beatStats.total}</td>
                          <td className="font-mono text-sm text-right font-bold">{formatCents(beatStats.totalRevenue)}</td>
                          <td className="font-mono text-sm text-right font-bold text-black/70">{formatCents(beatStats.producerCut)}</td>
                          <td className="font-mono text-sm text-right font-bold text-accent">{formatCents(beatStats.platformCut)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </BreakdownSection>
              )}
            </div>
          )}

          {/* ========= PAYROLL ========= */}
          {view === 'payroll' && (
            <div className="space-y-6">
              {/* Pay period selector + header */}
              <div className="border-2 border-accent/30 bg-accent/5 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Pay Period</p>
                    <select
                      value={payrollPeriodIndex}
                      onChange={(e) => setPayrollPeriodIndex(Number(e.target.value))}
                      className="border-2 border-black px-3 py-2 font-mono text-sm font-bold bg-white focus:border-accent focus:outline-none"
                    >
                      {payPeriods.map((p, i) => (
                        <option key={i} value={i}>
                          {p.label}{i === 0 ? ' (current)' : i === 1 ? ' (last completed)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider">Total Owed (All Time)</p>
                    <p className="font-mono text-2xl font-bold text-red-600">{formatCents(Math.max(0, payrollData.totalPayroll - payrollData.totalPaid))}</p>
                  </div>
                </div>
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MiniStat label="All-Time Earned" value={formatCents(payrollData.totalPayroll)} />
                <MiniStat label="All-Time Paid Out" value={formatCents(payrollData.totalPaid)} />
                <MiniStat label="This Period Earned" value={formatCents(payrollData.people.reduce((s, [, d]) => s + d.periodTotal, 0))} />
                <MiniStat label="People Owed" value={String(payrollData.people.filter(([, d]) => d.balance > 0).length)} />
              </div>

              {/* Per-Person Balances Table.
                  "This Period" = earnings from sessions/media/beats already
                  completed within the period. "Pending (period)" = scheduled
                  but not-yet-completed sessions in the period — money the
                  engineer *will* earn once the session is marked complete.
                  Engineers with only pending work still show up here so
                  admins can see they have upcoming activity and know to
                  mark sessions complete once done. */}
              <div className="border border-black/10 p-4">
                <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-4">What We Owe</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px]">
                    <thead>
                      <tr className="border-b-2 border-black/20">
                        <th className="text-left font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Person</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">This Period</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Pending (period)</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2 border-l border-black/10">All-Time Earned</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">All-Time Paid</th>
                        <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2 border-l-2 border-black/10">Balance Owed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payrollData.people.map(([name, data]) => (
                        <tr key={name} className="border-b border-black/5 hover:bg-black/[0.02]">
                          <td className="font-mono text-sm font-semibold py-3">{name}</td>
                          <td className="font-mono text-sm text-right">
                            {data.periodTotal > 0 ? formatCents(data.periodTotal) : <span className="text-black/30">—</span>}
                          </td>
                          <td className="font-mono text-xs text-right">
                            {data.periodPending.count > 0 ? (
                              <span className="text-amber-700" title={`${data.periodPending.count} session${data.periodPending.count !== 1 ? 's' : ''} · ${data.periodPending.hours}hr scheduled`}>
                                {formatCents(data.periodPending.potentialPay)}
                                <span className="text-[10px] text-amber-600/70 ml-1">({data.periodPending.count})</span>
                              </span>
                            ) : (
                              <span className="text-black/30">—</span>
                            )}
                          </td>
                          <td className="font-mono text-sm text-right border-l border-black/10">
                            {formatCents(data.allTimeTotal)}
                          </td>
                          <td className="font-mono text-sm text-right text-green-600">
                            {data.allTimePaid > 0 ? formatCents(data.allTimePaid) : <span className="text-black/30">—</span>}
                          </td>
                          <td className={`font-mono text-sm text-right font-bold border-l-2 border-black/10 ${data.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {data.balance > 0 ? (
                              <div className="flex items-center justify-end gap-2">
                                <span>{formatCents(data.balance)}</span>
                                {/* Quick-pay shortcut. Opens the paystub card,
                                    pre-fills the form with the balance +
                                    currently-viewed period as the default,
                                    and scrolls the card into view so the
                                    admin doesn't have to hunt for it.
                                    The period is a pre-fill, not a lock —
                                    the form has a dropdown to change it. */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const key = `payroll-${name}`;
                                    setExpandedSection(key);
                                    setShowPayoutForm(name);
                                    setPayoutAmount((data.balance / 100).toFixed(2));
                                    setPayoutPeriodLabel(payrollData.periodLabel);
                                    setPayoutMethod('cash');
                                    setPayoutNote('');
                                    // Defer scroll one frame so the card has
                                    // a chance to render expanded before we
                                    // try to anchor on it.
                                    requestAnimationFrame(() => {
                                      const el = document.getElementById(`paystub-${slugifyName(name)}`);
                                      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    });
                                  }}
                                  className="font-mono text-[10px] font-bold uppercase tracking-wider border border-green-600 text-green-700 px-2 py-0.5 hover:bg-green-50"
                                  title={`Record payout for ${name}`}
                                >
                                  Pay
                                </button>
                              </div>
                            ) : (
                              // Balance is $0 → the person is caught up. We
                              // never pre-pay, so scheduled-but-not-completed
                              // sessions don't mean "we owe them." They mean
                              // "future earnings." The Pending (period)
                              // column already surfaces that — keeping this
                              // column as a crisp PAID answer avoids the
                              // misleading AWAITING state from before.
                              <span className="text-green-600">PAID</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {payrollData.people.length === 0 && (
                        <tr>
                          <td colSpan={6} className="font-mono text-sm text-black/60 text-center py-12">No outstanding balances or scheduled sessions this period</td>
                        </tr>
                      )}
                    </tbody>
                    {payrollData.people.length > 1 && (
                      <tfoot>
                        <tr className="border-t-2 border-black/20">
                          <td className="font-mono text-sm font-bold py-3">TOTAL</td>
                          <td className="font-mono text-sm text-right font-bold">
                            {formatCents(payrollData.people.reduce((s, [, d]) => s + d.periodTotal, 0))}
                          </td>
                          <td className="font-mono text-xs text-right font-bold text-amber-700">
                            {(() => {
                              const t = payrollData.people.reduce((s, [, d]) => s + d.periodPending.potentialPay, 0);
                              return t > 0 ? formatCents(t) : '—';
                            })()}
                          </td>
                          <td className="font-mono text-sm text-right font-bold border-l border-black/10">
                            {formatCents(payrollData.totalPayroll)}
                          </td>
                          <td className="font-mono text-sm text-right font-bold text-green-600">
                            {formatCents(payrollData.totalPaid)}
                          </td>
                          <td className="font-mono text-sm text-right font-bold text-red-600 border-l-2 border-black/10">
                            {formatCents(Math.max(0, payrollData.totalPayroll - payrollData.totalPaid))}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                {payrollData.people.some(([, d]) => d.periodPending.count > 0) && (
                  <p className="font-mono text-[11px] text-black/50 mt-3">
                    <span className="text-amber-700 font-bold">Pending (period)</span> = scheduled sessions not yet marked completed. Mark sessions complete in the Sessions tab to move them into &quot;This Period&quot; earned.
                  </p>
                )}
              </div>

              {/* Per-Person Detail Cards — Paystub View */}
              {payrollData.people.map(([name, data]) => {
                const personPayouts = payouts.filter(p => (normalizeName(p.person_name) || p.person_name) === name);

                return (
                  <BreakdownSection
                    key={name}
                    id={`paystub-${slugifyName(name)}`}
                    title={`${name} — ${
                      // Primary state: are they owed money right now?
                      // Paid-in-full leads; scheduled work is informational,
                      // not a payment-pending state (we never pre-pay).
                      data.balance > 0
                        ? `${formatCents(data.balance)} owed`
                        : 'PAID IN FULL'
                    }${data.periodTotal > 0 ? ` · ${formatCents(data.periodTotal)} this period` : ''}${
                      // Scheduled-but-not-completed shows as secondary
                      // context in both "owed" and "paid" states. When the
                      // session is marked completed it'll move into the
                      // period total and (if unpaid) into the balance.
                      data.periodPending.count > 0
                        ? ` · ${formatCents(data.periodPending.potentialPay)} scheduled (${data.periodPending.count})`
                        : ''
                    }`}
                    expanded={expandedSection === `payroll-${name}`}
                    onToggle={() => toggleSection(`payroll-${name}`)}
                  >
                    <div className="space-y-3">
                      {/* Period earnings breakdown with individual line items */}
                      {(() => {
                        const ps = payrollData.periodStart;
                        const pe = payrollData.periodEnd;
                        const personSessions = allTimeBookings
                          .filter(b => b.status === 'completed' && (normalizeName(b.engineer_name) || '') === name && b.start_time >= ps && b.start_time <= pe)
                          .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
                        const sessionGross = personSessions.reduce((s, b) => s + b.total_amount, 0);
                        const sessionPay = Math.round(sessionGross * ENGINEER_SESSION_SPLIT);
                        const sessionHours = personSessions.reduce((s, b) => s + b.duration, 0);

                        // Combine all media sales where this person earned money (sold, filmed, or edited)
                        const personMediaAll = allTimeMediaSales
                          .filter(m => (normalizeName(m.sold_by) === name || normalizeName(m.filmed_by) === name || normalizeName(m.edited_by) === name) && m.created_at >= ps && m.created_at <= pe)
                          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

                        // Deduplicate (same sale can appear if person sold AND worked)
                        const seenMedia = new Set<string>();
                        const personMedia = personMediaAll.filter(m => {
                          if (seenMedia.has(m.id)) return false;
                          seenMedia.add(m.id);
                          return true;
                        });

                        // Calculate per-sale earnings for this person
                        const mediaItems = personMedia.map(m => {
                          const roles: string[] = [];
                          const isSeller = normalizeName(m.sold_by) === name;
                          const isFilmer = normalizeName(m.filmed_by) === name;
                          const isEditor = normalizeName(m.edited_by) === name;
                          if (isSeller) roles.push('sold');
                          if (isFilmer) roles.push('filmed');
                          if (isEditor) roles.push('edited');

                          // Simple: if one person did everything, they get 65% (seller 15% + worker 50%)
                          // If they only sold, 15%. If they only worked, 50% split by worker count.
                          let totalPay = 0;
                          if (isSeller) totalPay += Math.round(m.amount * MEDIA_SELLER_COMMISSION);
                          if (isFilmer || isEditor) {
                            // Worker gets 50% total. If both filmed_by and edited_by are different people, split 25/25.
                            // If same person filmed AND edited, they get the full 50%.
                            const filmer = normalizeName(m.filmed_by);
                            const editor = normalizeName(m.edited_by);
                            const bothSamePerson = filmer === editor;
                            if (bothSamePerson) {
                              totalPay += Math.round(m.amount * MEDIA_WORKER_TOTAL); // full 50%
                            } else {
                              // Different people — each gets 25%
                              totalPay += Math.round(m.amount * MEDIA_WORKER_TOTAL / 2);
                            }
                          }
                          const pct = Math.round((totalPay / m.amount) * 100);
                          return { ...m, totalPay, roles, pct };
                        });
                        const mediaTotal = mediaItems.reduce((s, m) => s + m.totalPay, 0);

                        // Package commissions this person closed in the period.
                        // Filtered by created_at (mint time = when the customer
                        // paid = when commission was earned).
                        const personPackages = allTimePackageCommissions
                          .filter((pc) => normalizeName(pc.salesperson_name) === name && pc.created_at >= ps && pc.created_at <= pe)
                          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                        const packageTotal = personPackages.reduce((s, pc) => s + (pc.sales_commission_cents ?? 0), 0);

                        // Staff cash bonuses (rewards) earned this period — owed
                        // (approved/issued), funded from the studio cut, on top of base pay.
                        const personBonuses = allTimeRewardBonuses
                          .filter((bn) => normalizeName(bn.person_name) === name && (bn.status === 'approved' || bn.status === 'issued') && bn.created_at >= ps && bn.created_at <= pe)
                          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                        const bonusTotal = personBonuses.reduce((s, bn) => s + (bn.value_cents || 0), 0);

                        // Pending (not-yet-completed) sessions in this period.
                        // Shown separately so admins can see upcoming work and
                        // know they need to mark sessions complete to move them
                        // into "earned." Doesn't count toward period total.
                        const personPendingSessions = allTimeBookings
                          .filter(b =>
                            b.status !== 'completed' &&
                            b.status !== 'cancelled' &&
                            (normalizeName(b.engineer_name) || '') === name &&
                            b.start_time >= ps &&
                            b.start_time <= pe
                          )
                          .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
                        const pendingGross = personPendingSessions.reduce((s, b) => s + (b.total_amount || 0), 0);
                        const pendingPotentialPay = Math.round(pendingGross * ENGINEER_SESSION_SPLIT);
                        const pendingHours = personPendingSessions.reduce((s, b) => s + (b.duration || 0), 0);

                        const hasActivity = personSessions.length > 0 || personMedia.length > 0 || personPackages.length > 0;
                        const hasAnything = hasActivity || personPendingSessions.length > 0;

                        return (
                          <div className="border border-black/10 p-3 space-y-4">
                            <p className="font-mono text-[10px] text-accent uppercase tracking-wider font-bold">{payrollData.periodLabel}</p>

                            {!hasAnything && (
                              <p className="font-mono text-xs text-black/40">No activity this period</p>
                            )}

                            {/* Sessions */}
                            {personSessions.length > 0 && (
                              <div>
                                <div className="space-y-0.5">
                                  {personSessions.map(s => (
                                    <div key={s.id} className="flex justify-between font-mono text-[11px] text-black/60">
                                      <span>{fmtSessionDate(s.start_time)} · {s.customer_name} · {formatDuration(s.duration)}</span>
                                      <span className="text-black/50">{formatCents(s.total_amount)}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex justify-between font-mono text-xs font-bold mt-1 pt-1 border-t border-black/10">
                                  <span>Sessions ({personSessions.length} · {sessionHours}hr · {formatCents(sessionGross)} gross)</span>
                                  <span>60% → {formatCents(sessionPay)}</span>
                                </div>
                              </div>
                            )}

                            {/* Media Sales — combined commission + work per sale */}
                            {personMedia.length > 0 && (
                              <div>
                                <div className="space-y-1">
                                  {mediaItems.map(m => (
                                    <div key={m.id} className="flex justify-between items-start font-mono text-[11px] py-0.5">
                                      <div className="text-black/60">
                                        <span>{fmtStampDate(m.created_at)} · {m.description || m.sale_type}</span>
                                        <span className="text-black/40 ml-1">· {formatCents(m.amount)} × {m.pct}%</span>
                                      </div>
                                      <span className="text-black/80 font-semibold flex-shrink-0 ml-2">{formatCents(m.totalPay)}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex justify-between font-mono text-xs font-bold mt-1 pt-1 border-t border-black/10">
                                  <span>Media ({personMedia.length} sale{personMedia.length !== 1 ? 's' : ''})</span>
                                  <span>{formatCents(mediaTotal)}</span>
                                </div>
                              </div>
                            )}

                            {/* Package commissions — salesperson commission
                                on package/membership quotes this person
                                closed. Earned when the customer paid. */}
                            {personPackages.length > 0 && (
                              <div>
                                <div className="space-y-1">
                                  {personPackages.map(pc => (
                                    <div key={pc.id} className="flex justify-between items-start font-mono text-[11px] py-0.5">
                                      <div className="text-black/60">
                                        <span>{fmtStampDate(pc.created_at)} · Package sale</span>
                                      </div>
                                      <span className="text-black/80 font-semibold flex-shrink-0 ml-2">{formatCents(pc.sales_commission_cents ?? 0)}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex justify-between font-mono text-xs font-bold mt-1 pt-1 border-t border-black/10">
                                  <span>Package commissions ({personPackages.length})</span>
                                  <span>{formatCents(packageTotal)}</span>
                                </div>
                              </div>
                            )}

                            {/* Staff cash bonuses (rewards) — earned/owed this
                                period, funded from the studio's cut, on top of
                                base pay. Paid out via the normal payout flow. */}
                            {personBonuses.length > 0 && (
                              <div>
                                <div className="space-y-1">
                                  {personBonuses.map(bn => (
                                    <div key={bn.id} className="flex justify-between items-start font-mono text-[11px] py-0.5">
                                      <div className="text-black/60">
                                        <span>{fmtStampDate(bn.created_at)} · Bonus · {bn.rule_key.replace(/_/g, ' ')}</span>
                                      </div>
                                      <span className="text-green-700 font-semibold flex-shrink-0 ml-2">{formatCents(bn.value_cents)}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex justify-between font-mono text-xs font-bold mt-1 pt-1 border-t border-black/10">
                                  <span>Bonuses ({personBonuses.length})</span>
                                  <span className="text-green-700">{formatCents(bonusTotal)}</span>
                                </div>
                              </div>
                            )}

                            {/* Pending sessions — scheduled but not yet
                                completed. Shown in amber to visually
                                distinguish from confirmed earnings. */}
                            {personPendingSessions.length > 0 && (
                              <div className="border border-amber-200 bg-amber-50/50 p-2 rounded-sm">
                                <p className="font-mono text-[10px] text-amber-700 uppercase tracking-wider font-bold mb-1">
                                  Pending — not yet completed
                                </p>
                                <div className="space-y-0.5">
                                  {personPendingSessions.map(s => (
                                    <div key={s.id} className="flex justify-between font-mono text-[11px] text-black/60">
                                      <span>
                                        {fmtSessionDate(s.start_time)} · {s.customer_name} · {formatDuration(s.duration)}
                                        <span className="ml-2 text-[10px] uppercase text-amber-700/80">{s.status}</span>
                                      </span>
                                      <span className="text-black/50">{formatCents(s.total_amount)}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex justify-between font-mono text-xs font-bold mt-1 pt-1 border-t border-amber-200 text-amber-800">
                                  <span>Scheduled ({personPendingSessions.length} · {pendingHours}hr · {formatCents(pendingGross)} gross)</span>
                                  <span>60% → {formatCents(pendingPotentialPay)}</span>
                                </div>
                                <p className="font-mono text-[10px] text-black/40 mt-1">
                                  Earnings apply once the session is marked completed.
                                </p>
                              </div>
                            )}

                            {/* Period total — sessions + media + package
                                commissions. Reconciles with the "This
                                Period" column in the What We Owe table. */}
                            {hasActivity && (
                              <div className="flex justify-between font-mono text-sm font-bold pt-2 border-t-2 border-black/20">
                                <span>Period Total (earned)</span>
                                <span>{formatCents(sessionPay + mediaTotal + packageTotal)}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* All-time balance context */}
                      <div className="bg-black/[0.02] border border-black/10 p-3 space-y-1">
                        <div className="flex justify-between font-mono text-sm">
                          <span className="text-black/60">All-Time Earned</span>
                          <span className="font-bold">{formatCents(data.allTimeTotal)}</span>
                        </div>
                        <div className="flex justify-between font-mono text-sm">
                          <span className="text-green-600">All-Time Paid</span>
                          <span className="text-green-600 font-bold">{formatCents(data.allTimePaid)}</span>
                        </div>
                      </div>

                      {/* Payout History */}
                      {personPayouts.length > 0 && (
                        <div className="border border-black/10 p-3 space-y-2">
                          <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider">Payout History</p>
                          {personPayouts.map((p, i) => (
                            <div key={p.id || i} className="flex justify-between items-center py-1 border-b border-black/5 last:border-0">
                              <div className="font-mono text-xs">
                                <span className="text-black/70">
                                  {fmtStampDate(p.created_at, { year: 'numeric' })}
                                </span>
                                <span className="text-black/40 ml-2">via {p.method}</span>
                                {p.note && <span className="text-black/40 ml-2">— {p.note}</span>}
                                {p.period_label && <span className="text-black/30 ml-2">({p.period_label})</span>}
                              </div>
                              <span className="font-mono text-sm font-bold text-green-600">{formatCents(p.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Balance */}
                      <div className={`flex justify-between items-center py-3 px-3 ${data.balance > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                        <p className={`font-mono text-sm font-bold ${data.balance > 0 ? 'text-red-700' : 'text-green-700'}`}>
                          {data.balance > 0 ? 'Balance Owed' : 'Paid in Full'}
                        </p>
                        <p className={`font-mono text-lg font-bold ${data.balance > 0 ? 'text-red-700' : 'text-green-700'}`}>
                          {data.balance > 0 ? formatCents(data.balance) : formatCents(0)}
                        </p>
                      </div>

                      {/* Record Payout button */}
                      {data.balance > 0 && (
                        <>
                          {showPayoutForm === name ? (
                            <div className="border border-accent p-3 space-y-2">
                              <div className="flex gap-2">
                                <div className="flex-1">
                                  <label className="font-mono text-[10px] text-black/60">Amount ($)</label>
                                  <input type="number" step="0.01" value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)}
                                    placeholder={`${(data.balance / 100).toFixed(2)}`}
                                    className="w-full border border-black/20 px-2 py-1.5 font-mono text-sm" />
                                </div>
                                <div>
                                  <label className="font-mono text-[10px] text-black/60">Method</label>
                                  <select value={payoutMethod} onChange={(e) => setPayoutMethod(e.target.value)}
                                    className="w-full border border-black/20 px-2 py-1.5 font-mono text-sm bg-white">
                                    <option value="cash">Cash</option>
                                    <option value="zelle">Zelle</option>
                                    <option value="venmo">Venmo</option>
                                    <option value="cashapp">Cash App</option>
                                    <option value="check">Check</option>
                                    <option value="direct_deposit">Direct Deposit</option>
                                  </select>
                                </div>
                              </div>
                              {/* Pay-period selector.
                                  Defaults to whatever period is currently in
                                  the top dropdown, but the admin can
                                  override — common cases:
                                  - paying late (e.g., recording a March
                                    payout while viewing April)
                                  - paying forward (Friday payout for a
                                    period that officially ends Sunday)
                                  We reuse `payPeriods` so the option set
                                  matches the top dropdown exactly. */}
                              <div>
                                <label className="font-mono text-[10px] text-black/60">Pay Period (what this payout is for)</label>
                                <select
                                  value={payoutPeriodLabel}
                                  onChange={(e) => setPayoutPeriodLabel(e.target.value)}
                                  className="w-full border border-black/20 px-2 py-1.5 font-mono text-xs bg-white"
                                >
                                  {payPeriods.map((p, i) => (
                                    <option key={i} value={p.label}>
                                      {p.label}{p.label === payrollData.periodLabel ? ' (current view)' : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <input type="text" value={payoutNote} onChange={(e) => setPayoutNote(e.target.value)}
                                placeholder="Note (optional)" className="w-full border border-black/20 px-2 py-1.5 font-mono text-xs" />
                              <div className="flex gap-2">
                                <button onClick={() => recordPayout(name, {
                                    sessionPay: data.allTimeData.sessionPay,
                                    sessionCount: data.allTimeData.sessionCount,
                                    sessionHours: data.allTimeData.sessionHours,
                                    mediaCommission: data.allTimeData.mediaCommission,
                                    mediaWorkerPay: data.allTimeData.mediaWorkerPay,
                                    beatProducerPay: data.allTimeData.beatProducerPay,
                                    packageCommission: data.allTimeData.packageCommission,
                                    totalEarned: data.allTimeTotal,
                                    totalPaid: data.allTimePaid,
                                  })} disabled={!payoutAmount || recordingPayout}
                                  className="bg-green-600 text-white font-mono text-xs font-bold px-4 py-2 hover:bg-green-700 disabled:opacity-50">
                                  {recordingPayout ? 'Recording...' : 'Record Payout'}
                                </button>
                                <button onClick={() => { setShowPayoutForm(null); setPayoutPeriodLabel(''); }}
                                  className="font-mono text-xs text-black/60 hover:text-black px-3 py-2">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => {
                                setShowPayoutForm(name);
                                setPayoutAmount((data.balance / 100).toFixed(2));
                                // Initialize the period picker so the first
                                // thing the admin sees is "the period you're
                                // currently viewing" — overridable.
                                setPayoutPeriodLabel(payrollData.periodLabel);
                              }}
                              className="w-full border-2 border-green-600 text-green-700 font-mono text-xs font-bold uppercase py-2 hover:bg-green-50">
                              Record Payout — {formatCents(data.balance)} owed
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </BreakdownSection>
                );
              })}

              {/* Cash Tracking
                  ------------------------------------------------------------------
                  Every number in this panel is scoped to the selected pay period.
                  The ONLY exceptions are:

                  - Cash Owed (red panel above) — a liability that doesn't reset
                    with a period. If an engineer owes us from 3 months ago,
                    we still need to see it regardless of the current period.

                  - "All-time cash on hand" line in the footer — purely a
                    reconciliation fact ("the safe should contain $X total"),
                    shown in tiny text so it doesn't compete with the period
                    view. This is what admins count against physical cash.

                  Period scoping rules:
                  - Collected (period): row's created_at falls in period AND
                    row is now collected-or-deposited (not 'owed'). This is
                    "cash that entered our books during this period."
                  - Deposited (period): row's deposited_at falls in period.
                    "Cash that hit the bank during this period."
                  - On Hand (period): row's created_at falls in period AND
                    status is still 'collected'. "Cash from this period that
                    hasn't been banked yet."

                  If the period is Apr 16–30 and Zion's entry was Apr 10, he
                  won't appear here at all — his cash belongs to the Apr 1–15
                  period. That's the behavior the earlier "shows Zion in Apr
                  16–30 even though he had no sessions" bug was about. */}
              {(() => {
                const ps = payrollData.periodStart;
                const pe = payrollData.periodEnd;
                // Match the existing pattern in this file (line 1030 etc.) — the
                // period bounds are 'YYYY-MM-DD' strings compared against
                // ISO timestamps. This under-selects by a few hours on the
                // exact end-of-period day but is consistent with every other
                // period filter in this component. Fixing it is a separate task.
                const inPeriod = (iso: string | null | undefined) =>
                  !!iso && iso >= ps && iso <= pe;

                const owedEntries = cashLedger.filter(e => e.status === 'owed');

                // ── All-time views (used for owed panel + reconciliation footer)
                const allCollectedOnHand = cashLedger.filter(e => e.status === 'collected');
                const totalOwed = owedEntries.reduce((s, e) => s + e.amount, 0);
                const totalOnHandAllTime = allCollectedOnHand.reduce((s, e) => s + e.amount, 0);

                // ── Period-scoped views — the three numbers in the cards
                //
                // Collected (period) — rows whose collection event happened in
                // the period, regardless of current status. A row that was
                // collected in-period and then deposited in-period counts
                // here too.
                const collectedThisPeriod = cashLedger.filter(
                  e => (e.status === 'collected' || e.status === 'deposited') && inPeriod(e.created_at)
                );
                // Deposited (period) — rows whose deposit event happened in
                // the period. Deposit date can be different from collection
                // date; what matters here is when it hit the bank.
                const depositedThisPeriod = cashLedger.filter(
                  e => e.status === 'deposited' && inPeriod(e.deposited_at)
                );
                // On hand (period) — rows collected IN the period that are
                // STILL on hand (status='collected', not yet deposited). This
                // is the bucket the period-scoped per-engineer "On Hand"
                // number now answers; it's what makes Zion's Apr 10 entry
                // correctly disappear when the Apr 16–30 period is selected.
                const onHandThisPeriod = cashLedger.filter(
                  e => e.status === 'collected' && inPeriod(e.created_at)
                );

                const totalCollectedPeriod = collectedThisPeriod.reduce((s, e) => s + e.amount, 0);
                const totalDepositedPeriod = depositedThisPeriod.reduce((s, e) => s + e.amount, 0);
                const totalOnHandPeriod = onHandThisPeriod.reduce((s, e) => s + e.amount, 0);

                // Group owed by engineer (all-time — this is a liability panel)
                const owedByEngineer: Record<string, { total: number; entries: typeof owedEntries }> = {};
                owedEntries.forEach(e => {
                  const engName = normalizeName(e.engineer_name) || e.engineer_name;
                  if (!owedByEngineer[engName]) owedByEngineer[engName] = { total: 0, entries: [] };
                  owedByEngineer[engName].total += e.amount;
                  owedByEngineer[engName].entries.push(e);
                });

                // Three separate per-engineer groupings for the three period-
                // scoped metrics. Keeping them separate (rather than one
                // unified object) makes it obvious which number answers which
                // question when reading the render code below.
                const onHandThisPeriodByEngineer: Record<string, number> = {};
                onHandThisPeriod.forEach(e => {
                  const engName = normalizeName(e.engineer_name) || e.engineer_name;
                  onHandThisPeriodByEngineer[engName] =
                    (onHandThisPeriodByEngineer[engName] || 0) + e.amount;
                });

                const collectedThisPeriodByEngineer: Record<string, number> = {};
                collectedThisPeriod.forEach(e => {
                  const engName = normalizeName(e.engineer_name) || e.engineer_name;
                  collectedThisPeriodByEngineer[engName] =
                    (collectedThisPeriodByEngineer[engName] || 0) + e.amount;
                });

                const depositedThisPeriodByEngineer: Record<string, number> = {};
                depositedThisPeriod.forEach(e => {
                  const engName = normalizeName(e.engineer_name) || e.engineer_name;
                  depositedThisPeriodByEngineer[engName] =
                    (depositedThisPeriodByEngineer[engName] || 0) + e.amount;
                });

                return (
                  <>
                    {/* Cash owed (only if there are outstanding entries) */}
                    {totalOwed > 0 && (
                      <div className="border-2 border-red-200 bg-red-50/30 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-red-700">Cash Owed to Business</h3>
                          <span className="font-mono text-lg font-bold text-red-700">{formatCents(totalOwed)}</span>
                        </div>
                        <p className="font-mono text-xs text-black/60">Engineers collect cash and owe the full amount to the business. Business pays engineers through payroll.</p>
                        {Object.entries(owedByEngineer).map(([name, data]) => (
                          <div key={name} className="border border-red-200 p-3 space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="font-mono text-sm font-bold">{name}</span>
                              <span className="font-mono text-sm font-bold text-red-700">Owes {formatCents(data.total)}</span>
                            </div>
                            {data.entries.map(entry => (
                              <div key={entry.id} className="flex justify-between items-center text-xs font-mono border-t border-red-100 pt-1">
                                <div>
                                  <span className="text-black/70">{entry.client_name}</span>
                                  <span className="text-black/60 ml-2">{fmtStampDate(entry.created_at)}</span>
                                  {entry.note && <span className="text-black/60 ml-2">— {entry.note}</span>}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold">{formatCents(entry.amount)}</span>
                                  <button
                                    onClick={async () => {
                                      if (!confirm(`Mark ${formatCents(entry.amount)} as collected from ${name}?`)) return;
                                      await fetch('/api/admin/cash-ledger', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ entryId: entry.id }),
                                      });
                                      fetchPayrollData();
                                    }}
                                    className="text-[10px] font-bold uppercase bg-green-100 text-green-700 px-2 py-1 hover:bg-green-200"
                                  >
                                    Mark Collected
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Cash Flow — three-part split.
                        Render unconditionally (even when all zeros) so admins
                        can always find the "Record Bank Deposit" action; cash
                        panels that vanish when empty are worse than empty panels. */}
                    <div className="border-2 border-green-200 bg-green-50/30 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-green-700">
                          Cash Flow
                        </h3>
                        <span className="font-mono text-[10px] text-black/50 uppercase tracking-wider">
                          {payrollData.periodLabel}
                        </span>
                      </div>

                      {/* Three headline metrics — ALL period-scoped now.
                          A stand-alone "all-time on hand" reconciliation line
                          is shown in the footer below, not here, so the three
                          cards answer one consistent question: "what's going
                          on in this pay period?" */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="border border-green-300 bg-white/60 p-3">
                          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">
                            Collected (period)
                          </p>
                          <p className="font-mono text-xl font-bold text-green-700 mt-1">
                            {formatCents(totalCollectedPeriod)}
                          </p>
                          <p className="font-mono text-[10px] text-black/40 mt-1">
                            Cash earned from clients · {collectedThisPeriod.length} entries
                          </p>
                        </div>
                        <div className="border border-blue-300 bg-white/60 p-3">
                          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">
                            Deposited (period)
                          </p>
                          <p className="font-mono text-xl font-bold text-blue-700 mt-1">
                            {formatCents(totalDepositedPeriod)}
                          </p>
                          <p className="font-mono text-[10px] text-black/40 mt-1">
                            Taken to the bank · {depositedThisPeriod.length} entries
                          </p>
                        </div>
                        <div className="border-2 border-amber-400 bg-amber-50 p-3">
                          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">
                            On Hand (period)
                          </p>
                          <p className="font-mono text-xl font-bold text-amber-700 mt-1">
                            {formatCents(totalOnHandPeriod)}
                          </p>
                          <p className="font-mono text-[10px] text-black/40 mt-1">
                            From this period, not yet deposited · {onHandThisPeriod.length} entries
                          </p>
                        </div>
                      </div>

                      {/* Per-engineer breakdown table. ALL three columns are
                          period-scoped — an engineer who had no cash event
                          (collection OR deposit) within the selected period
                          won't appear here at all. This is what fixes the
                          "Zion shows cash in a period he didn't work" bug. */}
                      {(() => {
                        const allNames = new Set<string>([
                          ...Object.keys(onHandThisPeriodByEngineer),
                          ...Object.keys(collectedThisPeriodByEngineer),
                          ...Object.keys(depositedThisPeriodByEngineer),
                        ]);
                        if (allNames.size === 0) {
                          return (
                            <div className="border border-green-200 bg-white/40 px-3 py-4 text-center">
                              <p className="font-mono text-xs text-black/40">
                                No cash activity in {payrollData.periodLabel}.
                              </p>
                            </div>
                          );
                        }
                        const rows = Array.from(allNames).sort((a, b) =>
                          (onHandThisPeriodByEngineer[b] || 0) - (onHandThisPeriodByEngineer[a] || 0)
                        );
                        return (
                          <div className="border border-green-200 bg-white/40">
                            <div className="grid grid-cols-4 gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-black/50 border-b border-green-200">
                              <span>Engineer</span>
                              <span className="text-right text-green-700">Collected (period)</span>
                              <span className="text-right text-blue-700">Deposited (period)</span>
                              <span className="text-right text-amber-700">On Hand (period)</span>
                            </div>
                            {rows.map(name => (
                              <div key={name} className="grid grid-cols-4 gap-2 px-3 py-1.5 font-mono text-xs border-b border-green-100 last:border-b-0">
                                <span className="text-black/70">{name}</span>
                                <span className="text-right text-green-700">
                                  {formatCents(collectedThisPeriodByEngineer[name] || 0)}
                                </span>
                                <span className="text-right text-blue-700">
                                  {formatCents(depositedThisPeriodByEngineer[name] || 0)}
                                </span>
                                <span className="text-right font-bold text-amber-700">
                                  {formatCents(onHandThisPeriodByEngineer[name] || 0)}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      {/* Record Deposit action. Uses the ALL-TIME on-hand
                          total for its gating — depositing is a physical
                          action against the whole safe, not just what was
                          collected this period. The modal itself shows every
                          'collected' row with its period, so admins pick
                          knowingly. */}
                      <div className="flex items-center justify-between pt-2 border-t border-green-200">
                        <p className="font-mono text-[11px] text-black/60">
                          Ready to deposit cash at the bank?
                        </p>
                        <button
                          type="button"
                          disabled={totalOnHandAllTime === 0}
                          onClick={() => {
                            setDepositSelectedIds(new Set());
                            setDepositReference('');
                            setDepositNote('');
                            setDepositError(null);
                            setShowDepositModal(true);
                          }}
                          className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 border-2 border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Record Bank Deposit
                        </button>
                      </div>

                      {/* Reconciliation footer — all-time facts.
                          Everything above is period-scoped so the numbers
                          stay consistent with the selected pay period. The
                          facts here are what admins count against the
                          physical safe + the bank, regardless of period. */}
                      <div className="pt-2 border-t border-green-200 space-y-1">
                        <div className="flex justify-between font-mono text-xs">
                          <span className="text-black/60">All-time cash still on hand (across every period)</span>
                          <span className="text-amber-700 font-bold">
                            {formatCents(totalOnHandAllTime)} · {allCollectedOnHand.length} entries
                          </span>
                        </div>
                        {totalOwed > 0 && (
                          <div className="flex justify-between font-mono text-xs">
                            <span className="text-black/60">Still outstanding from engineers (all time)</span>
                            <span className="text-red-600 font-bold">{formatCents(totalOwed)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* Business Summary at bottom of payroll */}
              <div className="border-2 border-accent p-4 space-y-2">
                <h3 className="font-mono text-sm font-bold uppercase tracking-wider">Business Summary (All Time)</h3>
                <div className="space-y-1 font-mono text-sm">
                  <div className="flex justify-between"><span className="text-black/60">Gross Revenue</span><span>{formatCents(payrollData.totalGrossRevenue)}</span></div>
                  <div className="flex justify-between"><span className="text-black/60">− Total Payroll Earned</span><span className="text-red-600">−{formatCents(payrollData.totalPayroll)}</span></div>
                  {payrollData.keptDeposits > 0 && (
                    <div className="flex justify-between"><span className="text-black/60">+ Kept Deposits</span><span className="text-green-600">+{formatCents(payrollData.keptDeposits)}</span></div>
                  )}
                  <div className="flex justify-between pt-2 border-t-2 border-black/20">
                    <span className="font-bold text-accent">Business Profit</span>
                    <span className="font-bold text-accent text-lg">{formatCents(payrollData.businessKeeps + payrollData.keptDeposits)}</span>
                  </div>
                  <div className="flex justify-between pt-1">
                    <span className="text-black/40 text-xs">Paid out so far</span>
                    <span className="text-green-600 text-xs">{formatCents(payrollData.totalPaid)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-black/40 text-xs">Still owed to workers</span>
                    <span className="text-red-600 text-xs">{formatCents(Math.max(0, payrollData.totalPayroll - payrollData.totalPaid))}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========= PROFIT (revenue − expenses, the real studio number) ========= */}
          {view === 'profit' && (() => {
            // Same range resolution as fetchData: presets via getDateRange,
            // custom via the two date inputs (fall back to this month).
            const range = (datePreset === 'custom'
              ? (customFrom ? { from: customFrom, to: customTo || new Date().toISOString().split('T')[0] } : null)
              : getDateRange(datePreset, selectedMonth))
              ?? getDateRange('thisMonth')!;
            return <ProfitView from={range.from} to={range.to} />;
          })()}

          {/* ========= SESSIONS DETAIL ========= */}
          {view === 'sessions' && (
            <div className="space-y-6">
              {/* Filters */}
              <div className="flex flex-wrap gap-3">
                <select value={engineerFilter} onChange={(e) => setEngineerFilter(e.target.value)}
                  className="border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none">
                  <option value="all">All Engineers</option>
                  {engineers.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                  className="border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none">
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <span className="font-mono text-xs text-black/60 self-center">
                  {filteredBookings.length} sessions · {formatCents(filteredBookings.reduce((s, b) => s + b.total_amount, 0))} total
                </span>
              </div>

              {/* Summary row */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <MiniStat label="Sessions" value={String(sessionStats.total)} />
                <MiniStat label="Completed" value={String(sessionStats.completed)} />
                <MiniStat label="Hours" value={`${sessionStats.totalHours}`} />
                <MiniStat label="Deposits" value={formatCents(sessionStats.depositsCollected)} />
                <MiniStat label="Remainder Due" value={formatCents(sessionStats.remainderOutstanding)} />
              </div>

              {/* Round 7c: Band sessions slice — separate from solo sessions
                  so admins can see what flat-rate band bookings + Sweet Spot
                  bundles brought in. Only renders when there's any band activity. */}
              {bandSessionStats.total > 0 && (
                <div className="border-2 border-accent/40 p-4 bg-accent/5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-mono text-sm font-bold uppercase tracking-wider">
                      Band Sessions (subset of above)
                    </h3>
                    <span className="font-mono text-[10px] text-black/50 uppercase tracking-wider">
                      {bandSessionStats.projectCount} project{bandSessionStats.projectCount === 1 ? '' : 's'} ·{' '}
                      {bandSessionStats.total} day{bandSessionStats.total === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    <MiniStat label="Booked" value={formatCents(bandSessionStats.bookedRevenue)} />
                    <MiniStat label="Collected" value={formatCents(bandSessionStats.collectedRevenue)} />
                    <MiniStat label="Outstanding" value={formatCents(bandSessionStats.outstanding)} />
                    <MiniStat
                      label={`Sweet Spot bundles (${bandSessionStats.sweetSpotCount})`}
                      value={formatCents(bandSessionStats.sweetSpotRevenue)}
                    />
                  </div>
                  {bandSessionStats.byBand.length > 0 && (
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-2">
                        By Band
                      </p>
                      <div className="space-y-1">
                        {bandSessionStats.byBand.map(([name, data]) => (
                          <div
                            key={name}
                            className="flex items-center justify-between py-1.5 px-3 bg-white border border-black/10 font-mono text-xs"
                          >
                            <span className="font-bold truncate">{name}</span>
                            <div className="flex items-center gap-4 shrink-0">
                              <span className="text-black/60">{data.count} day{data.count === 1 ? '' : 's'}</span>
                              <span className="text-black/60">booked {formatCents(data.booked)}</span>
                              <span className="font-bold text-green-700">collected {formatCents(data.collected)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Session list */}
              <div className="space-y-1">
                <div className="hidden md:grid grid-cols-12 gap-2 font-mono text-[10px] text-black/60 uppercase tracking-wider py-2 px-3 border-b border-black/10">
                  <div className="col-span-2">Date</div>
                  <div className="col-span-2">Client</div>
                  <div className="col-span-2">Engineer</div>
                  <div className="col-span-1">Room</div>
                  <div className="col-span-1">Hours</div>
                  <div className="col-span-1 text-right">Total</div>
                  <div className="col-span-1 text-right">Deposit</div>
                  <div className="col-span-1 text-right">Remainder</div>
                  <div className="col-span-1 text-right">Status</div>
                </div>
                {filteredBookings.map((b) => (
                  <div key={b.id} className="grid grid-cols-2 md:grid-cols-12 gap-2 font-mono text-xs py-3 px-3 border-b border-black/5 hover:bg-black/[0.02]">
                    <div className="col-span-2">
                      {fmtSessionDate(b.start_time, { year: '2-digit' })}
                    </div>
                    <div className="col-span-2 font-semibold truncate">{b.customer_name}</div>
                    <div className="col-span-2 text-black/60 truncate">{b.engineer_name || '—'}</div>
                    <div className="col-span-1 text-black/60">{ROOM_LABELS[b.room || ''] || b.room || '—'}</div>
                    <div className="col-span-1">{formatDuration(b.duration)}</div>
                    <div className="col-span-1 text-right font-semibold">{formatCents(b.total_amount)}</div>
                    <div className="col-span-1 text-right text-black/70">{formatCents(b.actual_deposit_paid || 0)}</div>
                    <div className="col-span-1 text-right text-black/70">{formatCents(b.remainder_amount)}</div>
                    <div className="col-span-1 text-right">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 ${STATUS_COLORS[b.status] || 'bg-black/5 text-black/50'}`}>
                        {b.status}
                      </span>
                    </div>
                  </div>
                ))}
                {filteredBookings.length === 0 && (
                  <p className="font-mono text-sm text-black/60 text-center py-12">No sessions found</p>
                )}
              </div>
            </div>
          )}

          {/* ========= BEAT SALES DETAIL ========= */}
          {view === 'beats' && (
            <div className="space-y-6">
              {/* Filters */}
              <div className="flex flex-wrap gap-3">
                <select value={producerFilter} onChange={(e) => setProducerFilter(e.target.value)}
                  className="border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none">
                  <option value="all">All Producers</option>
                  {producers.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <span className="font-mono text-xs text-black/60 self-center">
                  {filteredPurchases.length} sales · {formatCents(beatStats.totalRevenue)} total
                </span>
              </div>

              {/* Commission summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MiniStat label="Gross Revenue" value={formatCents(beatStats.totalRevenue)} />
                <MiniStat label={`Platform (${Math.round(PLATFORM_COMMISSION * 100)}%)`} value={formatCents(beatStats.platformCut)} />
                <MiniStat label={`Producer Payouts (${Math.round(PRODUCER_COMMISSION * 100)}%)`} value={formatCents(beatStats.producerCut)} />
                <MiniStat label="Total Sales" value={String(beatStats.total)} />
              </div>

              {/* License breakdown */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(beatStats.byLicense).map(([type, data]) => (
                  <MiniStat key={type} label={LICENSE_LABELS[type] || type} value={`${data.count} · ${formatCents(data.revenue)}`} />
                ))}
                {Object.keys(beatStats.byLicense).length === 0 && (
                  <MiniStat label="No Sales" value="—" />
                )}
              </div>

              {/* Purchase list */}
              <div className="space-y-1">
                <div className="hidden md:grid grid-cols-12 gap-2 font-mono text-[10px] text-black/60 uppercase tracking-wider py-2 px-3 border-b border-black/10">
                  <div className="col-span-2">Date</div>
                  <div className="col-span-3">Beat</div>
                  <div className="col-span-2">Producer</div>
                  <div className="col-span-2">Buyer</div>
                  <div className="col-span-1">License</div>
                  <div className="col-span-2 text-right">Amount</div>
                </div>
                {filteredPurchases.map((p) => (
                  <div key={p.id} className="grid grid-cols-2 md:grid-cols-12 gap-2 font-mono text-xs py-3 px-3 border-b border-black/5 hover:bg-black/[0.02]">
                    <div className="col-span-2">
                      {fmtStampDate(p.created_at, { year: '2-digit' })}
                    </div>
                    <div className="col-span-3 font-semibold truncate">{p.beats?.title || '—'}</div>
                    <div className="col-span-2 text-black/60 truncate">{p.beats?.producer || '—'}</div>
                    <div className="col-span-2 text-black/60 truncate">{p.buyer_email}</div>
                    <div className="col-span-1">
                      <span className="text-[10px] font-bold uppercase bg-black/5 px-1.5 py-0.5">{LICENSE_LABELS[p.license_type] || p.license_type}</span>
                    </div>
                    <div className="col-span-2 text-right font-bold">{formatCents(p.amount_paid)}</div>
                  </div>
                ))}
                {filteredPurchases.length === 0 && (
                  <p className="font-mono text-sm text-black/60 text-center py-12">No beat sales found</p>
                )}
              </div>
            </div>
          )}

          {/* ========= MEDIA SALES DETAIL ========= */}
          {view === 'media' && (
            <div className="space-y-6">
              {/* ─── Round 7b: Media Bookings (Hub orders) panel ─── */}
              {/* Listed first because going forward all new media revenue
                  routes through this table; the legacy media_sales section
                  below is for line-item entries from session invites. */}
              <div className="border-2 border-accent/40 p-4 bg-accent/5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-mono text-sm font-bold uppercase tracking-wider">
                    Media Bookings (Hub orders)
                  </h3>
                  <span className="font-mono text-[10px] text-black/50 uppercase tracking-wider">
                    excludes test bookings
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <MiniStat label="Booked Revenue" value={formatCents(mediaBookingStats.revenue)} />
                  <MiniStat label="Money Collected" value={formatCents(mediaBookingStats.collected)} />
                  <MiniStat label="Outstanding" value={formatCents(mediaBookingStats.outstanding)} />
                  <MiniStat label="Orders" value={String(mediaBookingStats.total)} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                  <MiniStat label="Deposits Paid" value={String(mediaBookingStats.depositsCount)} />
                  <MiniStat label="Fully Paid" value={String(mediaBookingStats.fullyPaidCount)} />
                  <MiniStat
                    label={`Business Cut (${Math.round(MEDIA_BUSINESS_CUT * 100)}%)`}
                    value={formatCents(mediaBookingStats.businessCut)}
                  />
                </div>

                {mediaBookingStats.byOffering.length > 0 && (
                  <div className="mb-4">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-2">
                      By Offering
                    </p>
                    <div className="space-y-1">
                      {mediaBookingStats.byOffering.map(([title, data]) => (
                        <div
                          key={title}
                          className="flex items-center justify-between py-1.5 px-3 bg-white border border-black/10 font-mono text-xs"
                        >
                          <span className="font-bold truncate">{title}</span>
                          <div className="flex items-center gap-4 shrink-0">
                            <span className="text-black/60">{data.count}×</span>
                            <span className="text-black/60">
                              booked {formatCents(data.revenue)}
                            </span>
                            <span className="font-bold text-green-700">
                              collected {formatCents(data.collected)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {mediaBookings.length > 0 ? (
                  <div className="space-y-1">
                    <div className="hidden md:grid grid-cols-12 gap-2 font-mono text-[10px] text-black/60 uppercase tracking-wider py-2 px-3 border-b border-black/10">
                      <div className="col-span-2">Date</div>
                      <div className="col-span-3">Offering</div>
                      <div className="col-span-2">Status</div>
                      <div className="col-span-2 text-right">Total</div>
                      <div className="col-span-2 text-right">Paid</div>
                      <div className="col-span-1 text-right">Owed</div>
                    </div>
                    {mediaBookings.map((b) => {
                      const owed = Math.max(0, (b.final_price_cents ?? 0) - (b.actual_deposit_paid ?? 0));
                      const fullyPaid = !!b.final_paid_at;
                      return (
                        <div
                          key={b.id}
                          className="grid grid-cols-2 md:grid-cols-12 gap-2 font-mono text-xs py-3 px-3 border-b border-black/5 hover:bg-black/[0.02]"
                        >
                          <div className="col-span-2">
                            {fmtStampDate(b.created_at, { year: '2-digit' })}
                          </div>
                          <div className="col-span-3 font-semibold truncate">
                            {mediaOfferingMap[b.offering_id] || '—'}
                          </div>
                          <div className="col-span-2">
                            <span className="text-[10px] uppercase font-bold bg-black/5 px-1.5 py-0.5">
                              {b.status}
                            </span>
                          </div>
                          <div className="col-span-2 text-right font-bold">
                            {formatCents(b.final_price_cents)}
                          </div>
                          <div className="col-span-2 text-right text-green-700">
                            {formatCents(b.actual_deposit_paid ?? 0)}
                          </div>
                          <div className={`col-span-1 text-right font-bold ${fullyPaid ? 'text-green-700' : owed > 0 ? 'text-amber-700' : 'text-black/50'}`}>
                            {fullyPaid ? '✓' : formatCents(owed)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="font-mono text-xs text-black/50 text-center py-6">
                    No media Hub orders in this date range.
                  </p>
                )}
              </div>

              {/* ─── Legacy media_sales (per-line-item) ─── */}
              <div className="border-t-2 border-black/10 pt-6">
                <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3">
                  Legacy Media Sales (line items from session invites)
                </h3>
              </div>
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MiniStat label="Total Media Revenue" value={formatCents(mediaStats.totalRevenue)} />
                <MiniStat label="Business Keeps" value={formatCents(mediaStats.businessRevenue)} />
                <MiniStat label="Total Payouts Owed" value={formatCents(mediaStats.totalPayouts)} />
                <MiniStat label="Total Sales" value={String(mediaStats.total)} />
              </div>

              {/* Revenue Split Breakdown */}
              <div className="border border-black/10 p-4">
                <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3">Revenue Split</h3>
                <div className="space-y-2 font-mono text-sm">
                  <div className="flex justify-between py-1 border-b border-black/5">
                    <span className="text-black/60">Seller Commission ({Math.round(MEDIA_SELLER_COMMISSION * 100)}%)</span>
                    <span className="font-bold">{formatCents(mediaStats.totalSellerCommissions)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-black/5">
                    <span className="text-black/60">Worker Pay — {Math.round(MEDIA_WORKER_TOTAL * 100)}% total (split if both filmed + edited)</span>
                    <span className="font-bold">{formatCents(mediaStats.totalWorkerPay)}</span>
                  </div>
                  {mediaStats.totalFilmerPay > 0 && (
                    <div className="flex justify-between py-1 border-b border-black/5 pl-4">
                      <span className="text-black/60">Filmed By</span>
                      <span className="text-black/60">{formatCents(mediaStats.totalFilmerPay)}</span>
                    </div>
                  )}
                  {mediaStats.totalEditorPay > 0 && (
                    <div className="flex justify-between py-1 border-b border-black/5 pl-4">
                      <span className="text-black/60">Edited By</span>
                      <span className="text-black/60">{formatCents(mediaStats.totalEditorPay)}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-2 border-t-2 border-black/20">
                    <span className="font-bold text-accent">Business Keeps ({Math.round(MEDIA_BUSINESS_CUT * 100)}%)</span>
                    <span className="font-bold text-accent">{formatCents(mediaStats.businessRevenue)}</span>
                  </div>
                </div>
              </div>

              {/* By Type */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(mediaStats.byType).map(([type, data]) => (
                  <MiniStat key={type} label={SALE_TYPE_LABELS[type] || type} value={`${data.count} · ${formatCents(data.revenue)}`} />
                ))}
                {Object.keys(mediaStats.byType).length === 0 && (
                  <MiniStat label="No Sales" value="—" />
                )}
              </div>

              {/* Per-Person Payouts */}
              {mediaStats.personPayouts.length > 0 && (
                <div className="border border-black/10 p-4">
                  <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3">Team Payouts</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px]">
                      <thead>
                        <tr className="border-b border-black/10">
                          <th className="text-left font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Person</th>
                          <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Sales (15%)</th>
                          <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Filmed (10%)</th>
                          <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2">Edited (10%)</th>
                          <th className="text-right font-mono text-[10px] text-black/60 uppercase tracking-wider py-2 border-l-2 border-black/10">Total Owed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mediaStats.personPayouts.map(([name, data]) => (
                          <tr key={name} className="border-b border-black/5">
                            <td className="font-mono text-sm font-semibold py-2">{name}</td>
                            <td className="font-mono text-sm text-right">
                              {data.sellerCommission > 0 ? <>{formatCents(data.sellerCommission)} <span className="text-[10px] text-black/60">({data.soldCount})</span></> : '—'}
                            </td>
                            <td className="font-mono text-sm text-right">
                              {data.filmedPay > 0 ? <>{formatCents(data.filmedPay)} <span className="text-[10px] text-black/60">({data.filmedCount})</span></> : '—'}
                            </td>
                            <td className="font-mono text-sm text-right">
                              {data.editedPay > 0 ? <>{formatCents(data.editedPay)} <span className="text-[10px] text-black/60">({data.editedCount})</span></> : '—'}
                            </td>
                            <td className="font-mono text-sm text-right font-bold text-accent border-l-2 border-black/10">
                              {formatCents(data.totalPay)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Sales List */}
              <div className="space-y-1">
                <div className="hidden md:grid grid-cols-12 gap-2 font-mono text-[10px] text-black/60 uppercase tracking-wider py-2 px-3 border-b border-black/10">
                  <div className="col-span-2">Date</div>
                  <div className="col-span-3">Description</div>
                  <div className="col-span-1">Type</div>
                  <div className="col-span-2">Client</div>
                  <div className="col-span-2">Crew</div>
                  <div className="col-span-1 text-right">Amount</div>
                  <div className="col-span-1 text-right">Commission</div>
                </div>
                {mediaSales.map((m) => (
                  <div key={m.id} className="grid grid-cols-2 md:grid-cols-12 gap-2 font-mono text-xs py-3 px-3 border-b border-black/5 hover:bg-black/[0.02]">
                    <div className="col-span-2">
                      {fmtStampDate(m.created_at, { year: '2-digit' })}
                    </div>
                    <div className="col-span-3 font-semibold truncate">{m.description}</div>
                    <div className="col-span-1">
                      <span className="text-[10px] font-bold uppercase bg-black/5 px-1.5 py-0.5">{SALE_TYPE_LABELS[m.sale_type] || m.sale_type}</span>
                    </div>
                    <div className="col-span-2 text-black/60 truncate">{m.client_name || '—'}</div>
                    <div className="col-span-2 text-black/70 truncate">
                      {[m.sold_by && `S: ${m.sold_by}`, m.filmed_by && `F: ${m.filmed_by}`, m.edited_by && `E: ${m.edited_by}`].filter(Boolean).join(' · ') || '—'}
                    </div>
                    <div className="col-span-1 text-right font-bold">{formatCents(m.amount)}</div>
                    <div className="col-span-1 text-right text-accent font-bold">
                      {m.sold_by ? formatCents(Math.round(m.amount * MEDIA_SELLER_COMMISSION)) : '—'}
                    </div>
                  </div>
                ))}
                {mediaSales.length === 0 && (
                  <p className="font-mono text-sm text-black/60 text-center py-12">No media sales found</p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Record Bank Deposit modal.
          Rendered at the top level so it overlays the whole page regardless
          of which tab the admin is on. The modal lists every cash_ledger row
          currently in status='collected' (cash at the studio that hasn't been
          deposited yet). The admin checks the rows that match the physical
          deposit slip and submits — one cash_events row is created and each
          selected ledger row is flipped to status='deposited' in an atomic
          batch on the server. */}
      {showDepositModal && (() => {
        const available = cashLedger
          .filter(e => e.status === 'collected')
          .sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
        const selectedTotal = available
          .filter(e => depositSelectedIds.has(e.id))
          .reduce((s, e) => s + e.amount, 0);
        const allSelected = available.length > 0 && available.every(e => depositSelectedIds.has(e.id));

        const toggle = (id: string) => {
          setDepositSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        };

        const toggleAll = () => {
          setDepositSelectedIds(prev => {
            if (available.every(e => prev.has(e.id))) return new Set();
            return new Set(available.map(e => e.id));
          });
        };

        return (
          <div
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={() => !depositSubmitting && setShowDepositModal(false)}
          >
            <div
              className="bg-white border-2 border-black max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="border-b-2 border-black p-4 flex items-center justify-between">
                <div>
                  <h2 className="font-heading text-2xl">Record Bank Deposit</h2>
                  <p className="font-mono text-xs text-black/60 mt-1">
                    Select the cash entries included in this deposit. Only entries
                    currently &quot;collected&quot; (not yet deposited) can be selected.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !depositSubmitting && setShowDepositModal(false)}
                  className="font-mono text-sm px-3 py-1 border border-black/20 hover:bg-black/5"
                >
                  Close
                </button>
              </div>

              {/* Accounting-issue warning panel. Shown when the server rejected
                  the submitted batch because one or more entries were not in
                  the required 'collected' state. We show the issues verbatim
                  so the admin can fix them before retrying. */}
              {depositError && (
                <div className="bg-red-50 border-b-2 border-red-400 p-4">
                  <p className="font-mono text-sm font-bold text-red-700 uppercase tracking-wider">
                    Accounting issues detected
                  </p>
                  <p className="font-mono text-xs text-red-800 mt-2">{depositError.warning}</p>
                  <ul className="font-mono text-xs text-red-800 mt-2 space-y-1">
                    {depositError.issues.map((issue, i) => (
                      <li key={i} className="list-disc list-inside">
                        <span className="text-black/50">{issue.entryId.slice(0, 8)}…</span>{' '}
                        — {issue.reason}
                      </li>
                    ))}
                  </ul>
                  <p className="font-mono text-[11px] text-red-700 mt-3">
                    Resolve each issue (record collection, remove duplicate, or uncheck the entry)
                    before retrying.
                  </p>
                </div>
              )}

              {/* Entry list */}
              <div className="flex-1 overflow-y-auto">
                {available.length === 0 ? (
                  <p className="font-mono text-sm text-black/60 text-center py-12">
                    No collected cash available to deposit.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-black/10 font-mono text-[10px] uppercase tracking-wider text-black/50 sticky top-0 bg-white">
                      <div className="col-span-1">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          aria-label="Select all"
                        />
                      </div>
                      <div className="col-span-2">Date</div>
                      <div className="col-span-3">Engineer</div>
                      <div className="col-span-4">Client / Note</div>
                      <div className="col-span-2 text-right">Amount</div>
                    </div>
                    {available.map(e => {
                      const checked = depositSelectedIds.has(e.id);
                      return (
                        <label
                          key={e.id}
                          className={`grid grid-cols-12 gap-2 px-4 py-2 border-b border-black/5 font-mono text-xs cursor-pointer hover:bg-black/[0.02] ${
                            checked ? 'bg-blue-50' : ''
                          }`}
                        >
                          <div className="col-span-1">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(e.id)}
                            />
                          </div>
                          <div className="col-span-2 text-black/70">
                            {fmtStampDate(e.created_at, { year: '2-digit' })}
                          </div>
                          <div className="col-span-3">
                            {normalizeName(e.engineer_name) || e.engineer_name}
                          </div>
                          <div className="col-span-4 text-black/60 truncate">
                            {e.client_name || '—'}
                            {e.note ? ` · ${e.note}` : ''}
                          </div>
                          <div className="col-span-2 text-right font-bold">
                            {formatCents(e.amount)}
                          </div>
                        </label>
                      );
                    })}
                  </>
                )}
              </div>

              {/* Reference + note + submit */}
              <div className="border-t-2 border-black p-4 space-y-3 bg-black/[0.02]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-black/60">
                      Reference / Slip #
                    </span>
                    <input
                      type="text"
                      value={depositReference}
                      onChange={e => setDepositReference(e.target.value)}
                      placeholder="e.g. Slip 04-20 or check #"
                      className="w-full border border-black/20 p-2 font-mono text-sm mt-1"
                      disabled={depositSubmitting}
                    />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-black/60">
                      Note (optional)
                    </span>
                    <input
                      type="text"
                      value={depositNote}
                      onChange={e => setDepositNote(e.target.value)}
                      placeholder="Any extra context"
                      className="w-full border border-black/20 p-2 font-mono text-sm mt-1"
                      disabled={depositSubmitting}
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-black/10">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">
                      Selected {depositSelectedIds.size} of {available.length}
                    </p>
                    <p className="font-mono text-xl font-bold">{formatCents(selectedTotal)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={submitDeposit}
                    disabled={depositSubmitting || depositSelectedIds.size === 0}
                    className="font-mono text-sm font-bold uppercase tracking-wider px-4 py-2 border-2 border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {depositSubmitting ? 'Recording…' : 'Record Deposit'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Profit view — revenue minus expenses for the selected period (Plan 5 §2).
// Reads the SAME tax P&L endpoint the Tax Center uses (cent-identical by
// construction) and embeds the shared TaxExpenses entry/list, so logging an
// expense here IS logging it for taxes. Contract labor auto-feeds from payouts.

interface ProfitPnL {
  from: string; to: string;
  revenue: { sessionsCents: number; beatsCents: number; mediaSalesCents: number; keptDepositsCents: number };
  totalRevenueCents: number; contractLaborCents: number; paidOutCents: number; manualExpensesCents: number;
  totalExpensesCents: number; netProfitCents: number;
  expensesByCategory: { key: string; label: string; scheduleCLine: string; amountCents: number }[];
}

function ProfitView({ from, to }: { from: string; to: string }) {
  const [pnl, setPnl] = useState<ProfitPnL | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPnl = async () => {
    try {
      const res = await fetch(`/api/admin/tax/pnl?from=${from}&to=${to}`);
      const j = await res.json();
      if (res.ok) setPnl(j.pnl);
    } catch { /* ignore */ }
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); loadPnl(); }, [from, to]);

  if (loading) return <p className="font-mono text-sm text-black/40">Loading profit…</p>;
  if (!pnl) return <p className="font-mono text-sm text-red-600">Could not load the P&amp;L.</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={DollarSign} label="Revenue (incl. kept deposits)" value={formatCents(pnl.totalRevenueCents)} />
        <StatCard icon={Filter} label="Expenses (incl. contract labor)" value={formatCents(pnl.totalExpensesCents)} />
        <StatCard icon={Users} label="Contract Labor (Staff Earnings)" value={formatCents(pnl.contractLaborCents)} />
        <StatCard icon={TrendingUp} label="Net profit" value={formatCents(pnl.netProfitCents)} accent />
      </div>
      <p className="font-mono text-[10px] text-black/40 -mt-2">
        Contract labor = exact staff earnings for this period&apos;s work — the same number as the Overview&apos;s
        &quot;Staff Earnings&quot; card, so revenue and labor sit on the same basis.
        {pnl.paidOutCents !== pnl.contractLaborCents && (
          <> Cash payouts recorded this period: <span className="font-bold">{formatCents(pnl.paidOutCents)}</span> (bill pays lag the work — see Payroll for per-person balances).</>
        )}
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="border-2 border-black/10 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-2">Revenue streams</p>
          <table className="w-full font-mono text-sm">
            <tbody>
              <tr className="border-t border-black/5"><td className="py-1">Studio sessions</td><td className="text-right">{formatCents(pnl.revenue.sessionsCents)}</td></tr>
              <tr className="border-t border-black/5"><td className="py-1">Beat sales</td><td className="text-right">{formatCents(pnl.revenue.beatsCents)}</td></tr>
              <tr className="border-t border-black/5"><td className="py-1">Media sales</td><td className="text-right">{formatCents(pnl.revenue.mediaSalesCents)}</td></tr>
              <tr className="border-t border-black/5"><td className="py-1">Kept deposits</td><td className="text-right">{formatCents(pnl.revenue.keptDepositsCents)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="border-2 border-black/10 p-4">
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-2">Expenses by category</p>
          {pnl.expensesByCategory.length === 0 ? (
            <p className="font-mono text-xs text-black/40">No expenses in this period yet — add them below.</p>
          ) : (
            <table className="w-full font-mono text-sm">
              <tbody>
                {pnl.expensesByCategory.map((c) => (
                  <tr key={c.key} className="border-t border-black/5">
                    <td className="py-1">{c.label} <span className="text-black/30 text-[10px]">{c.scheduleCLine}</span></td>
                    <td className="text-right">{formatCents(c.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="font-mono text-[10px] text-black/40">
        Same numbers as the Tax Center — quarterly estimates, 1099 compliance, and the CPA packet live in the Tax Center tab.
      </p>

      <TaxExpenses from={from} to={to} onChanged={loadPnl} />
    </div>
  );
}

// Helper components

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof DollarSign; label: string; value: string; accent?: boolean }) {
  return (
    <div className={`border-2 p-4 ${accent ? 'border-accent' : 'border-black/10'}`}>
      <Icon className={`w-4 h-4 mb-2 ${accent ? 'text-accent' : 'text-black/30'}`} />
      <p className={`font-heading text-xl ${accent ? 'text-accent' : ''}`}>{value}</p>
      <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-black/10 px-3 py-2">
      <p className="font-mono text-sm font-bold">{value}</p>
      <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function BreakdownSection({ id, title, expanded, onToggle, children }: { id?: string; title: string; expanded: boolean; onToggle: () => void; children: React.ReactNode }) {
  // The optional `id` lets callers scroll to the section (e.g., clicking a
  // "Pay" button in an overview table that needs to expand + focus this
  // specific paystub card).
  return (
    <div id={id} className="border border-black/10 scroll-mt-4">
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 hover:bg-black/[0.02] transition-colors">
        <h3 className="font-mono text-sm font-bold uppercase tracking-wider">{title}</h3>
        <ChevronDown className={`w-4 h-4 text-black/30 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function formatMonth(key: string): string {
  const [year, month] = key.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
