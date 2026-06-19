'use client';

// components/media-team/ContractBuilder.tsx
//
// The full-page CONTRACT BUILDER for the Media Team area. This is the rich,
// site-styled replacement for the cramped admin "New media project" modal.
// It composes the four existing systems (buyer pick-or-invite, the package /
// line-item deliverables, the installment plan, free-text terms) into one
// scroll-down flow and submits them via POST /api/admin/media/bookings/contract
// followed by POST /api/admin/media/bookings/[id]/send-contract (manager signs
// + emails the artist).
//
// Styled to MATCH THE MAIN SITE (black/white sections, accent kicker,
// font-mono uppercase labels, border-2 cards) — see app/book/page.tsx.
//
// The request body is the create API's EXACT shape:
//   - Buyer: user_id (existing) OR buyer_email (+ buyer_name) to invite.
//   - offering_id (required).
//   - planned_shoots[] (section 1) — NO sessions created yet (finalize does).
//   - lineItems[] (section 2, required non-empty) — deliverables.
//   - TOTAL (section 3) is DERIVED server-side = sum of line totals; we mirror
//     that math locally for display and to validate the installment sum.
//   - installments[] (section 4, optional) — SUM must equal the deliverables
//     total or the server 400s; we block submit before that happens.
//   - contract_terms (section 5/6).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus,
  Trash2,
  Calendar,
  Film,
  DollarSign,
  CreditCard,
  FileSignature,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';
import { formatCents } from '@/lib/utils';
import UserSearch, { type UserSearchUser } from '@/components/common/UserSearch';
import {
  type LineItemKind,
  LINE_ITEM_KINDS,
  LINE_ITEM_KIND_LABELS,
} from '@/lib/media-packages';
import {
  type MediaSessionKind,
  SESSION_KIND_LABELS,
} from '@/lib/media-scheduling';
import { buildDefaultContractTerms } from '@/lib/media-contract-terms';

// ── Offering option (subset of the admin offerings GET payload) ──────────
interface OfferingComponentSlot {
  key: string;
  label: string;
  kind?: string;
}
interface OfferingOption {
  id: string;
  title: string;
  slug: string;
  price_cents: number | null;
  is_active?: boolean;
  components: { slots?: OfferingComponentSlot[] } | null;
}

// ── Local editor row shapes (dollar strings for inputs) ──────────────────
interface ShootRow {
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM
  duration_hours: string; // numeric string
  location: 'studio' | 'external';
  external_location_text: string;
  manager_user_id: string; // media manager IN CHARGE of this shoot ('' = none)
  session_kind: MediaSessionKind;
}

// A media manager option for the per-shoot "in charge" picker. We carry the
// user_id (resolved + re-verified server-side at finalize) plus a display name.
export interface MediaManagerOption {
  user_id: string;
  name: string;
}

interface DeliverableRow {
  kind: LineItemKind;
  label: string;
  qty: string; // positive int string
  unitDollars: string; // dollar string
  source_slot_key: string | null;
  notes: string;
  is_free_addon: boolean;
}

interface StintRow {
  label: string;
  amountDollars: string;
  dueDate: string; // '' or YYYY-MM-DD
}

const SESSION_KINDS = Object.keys(SESSION_KIND_LABELS) as MediaSessionKind[];

// dollars string → integer cents (0 on garbage)
function dollarsToCents(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

// Map an offering slot's `kind` to the closest LineItemKind so a slot-sourced
// deliverable starts on a sensible kind. Falls back to 'other'.
function slotKindToLineKind(slotKind?: string): LineItemKind {
  switch (slotKind) {
    case 'hours':
      return 'recording_session';
    default:
      return 'other';
  }
}

export default function ContractBuilder({
  mediaManagers,
}: {
  mediaManagers: MediaManagerOption[];
}) {
  const router = useRouter();

  // ── Option pools ───────────────────────────────────────────────────
  const [clients, setClients] = useState<UserSearchUser[]>([]);
  const [offerings, setOfferings] = useState<OfferingOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  // ── Section 1: client ──────────────────────────────────────────────
  const [userId, setUserId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [offeringId, setOfferingId] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notesToUs, setNotesToUs] = useState('');

  // ── Section 2: production logistics ─────────────────────────────────
  const [shoots, setShoots] = useState<ShootRow[]>([]);

  // ── Section 3: deliverables ─────────────────────────────────────────
  const [deliverables, setDeliverables] = useState<DeliverableRow[]>([]);
  const [packageNotes, setPackageNotes] = useState('');

  // ── Section 5: installments ─────────────────────────────────────────
  const [stints, setStints] = useState<StintRow[]>([]);

  // ── Section 6: authorization ────────────────────────────────────────
  const [contractTerms, setContractTerms] = useState('');
  // Once the manager edits the terms, we stop auto-filling so we never clobber
  // their wording. The default is a starting point, not a lock.
  const [termsTouched, setTermsTouched] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    bookingId: string;
    finalized: boolean;
    emailedArtist: boolean;
    sessionsCreated: number;
    warnings: string[];
    plannedShootCount: number;
  } | null>(null);

  // ── Load offerings + clients (same endpoints the modal uses) ───────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [clientsRes, offeringsRes] = await Promise.all([
          fetch('/api/admin/library/clients?detailed=false', { cache: 'no-store' }),
          fetch('/api/admin/media/offerings', { cache: 'no-store' }),
        ]);
        const clientsData = await clientsRes.json();
        const offeringsData = await offeringsRes.json();
        if (cancelled) return;
        const rawClients = (clientsData.clients || clientsData.profiles || []) as Array<{
          user_id: string;
          display_name: string | null;
          email: string | null;
          phone?: string | null;
        }>;
        setClients(
          rawClients
            .filter((c) => c.user_id)
            .map((c) => ({
              user_id: c.user_id,
              display_name: c.display_name,
              email: c.email,
              phone: c.phone ?? null,
            }))
            .sort((a, b) =>
              (a.display_name || a.email || '').localeCompare(b.display_name || b.email || ''),
            ),
        );
        setOfferings(
          (offeringsData.offerings || []).filter(
            (o: { is_active?: boolean }) => o.is_active !== false,
          ),
        );
      } catch (e) {
        console.error('[contract-builder] load options error:', e);
        if (!cancelled) setOptionsError('Could not load artists or offerings.');
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedOffering = useMemo(
    () => offerings.find((o) => o.id === offeringId) || null,
    [offerings, offeringId],
  );
  const offeringSlots = selectedOffering?.components?.slots ?? [];

  // ── Derived totals ─────────────────────────────────────────────────
  const totalDurationHours = shoots.reduce((s, sh) => {
    const n = Number(sh.duration_hours);
    return s + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);

  const deliverablesTotalCents = deliverables.reduce((sum, d) => {
    const qty = parseInt(d.qty, 10);
    const unit = d.is_free_addon ? 0 : dollarsToCents(d.unitDollars);
    if (!Number.isInteger(qty) || qty < 1) return sum;
    return sum + qty * unit;
  }, 0);

  const stintSumCents = stints.reduce((sum, s) => sum + dollarsToCents(s.amountDollars), 0);
  const hasPlan = stints.length > 0;
  const planBalanced = hasPlan && stintSumCents === deliverablesTotalCents;
  const planDiff = stintSumCents - deliverablesTotalCents;

  // ── Auto-fill the (editable) authorization terms ───────────────────
  // Seed the contract-terms textarea with sensible default boilerplate while
  // it's still empty and the manager hasn't typed into it. They can edit or
  // clear it freely — it is NOT locked. We re-run as project context fills in
  // (offering, artist, total, installments) so the seed stays accurate until
  // it's touched.
  const selectedClient = useMemo(
    () => clients.find((c) => c.user_id === userId) || null,
    [clients, userId],
  );
  const artistNameForTerms =
    selectedClient?.display_name?.trim() ||
    inviteName.trim() ||
    selectedClient?.email?.trim() ||
    (inviteEmail.trim() || null);
  useEffect(() => {
    // While untouched, the textarea only ever holds our own auto-fill, so it's
    // safe to (re)seed as project context changes. Once touched we never write.
    if (termsTouched) return;
    setContractTerms(
      buildDefaultContractTerms({
        projectTitle: selectedOffering?.title ?? null,
        artistName: artistNameForTerms,
        totalCents: deliverablesTotalCents,
        hasInstallments: hasPlan,
      }),
    );
    // We intentionally do not depend on contractTerms here — once it's set the
    // termsTouched/empty guards prevent re-clobbering; we only want to (re)seed
    // when project context changes and the field is still untouched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    termsTouched,
    selectedOffering?.title,
    artistNameForTerms,
    deliverablesTotalCents,
    hasPlan,
  ]);

  // ── Section 2 mutators ─────────────────────────────────────────────
  function addShoot() {
    setShoots((prev) => [
      ...prev,
      {
        date: '',
        start_time: '',
        duration_hours: '2',
        location: 'studio',
        external_location_text: '',
        manager_user_id: mediaManagers[0]?.user_id || '',
        session_kind: 'video',
      },
    ]);
  }
  function updateShoot(i: number, patch: Partial<ShootRow>) {
    setShoots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeShoot(i: number) {
    setShoots((prev) => prev.filter((_, idx) => idx !== i));
  }

  // ── Section 3 mutators ─────────────────────────────────────────────
  function addCustomDeliverable() {
    setDeliverables((prev) => [
      ...prev,
      {
        kind: 'other',
        label: '',
        qty: '1',
        unitDollars: '',
        source_slot_key: null,
        notes: '',
        is_free_addon: false,
      },
    ]);
  }
  function addSlotDeliverable(slot: OfferingComponentSlot) {
    setDeliverables((prev) => [
      ...prev,
      {
        kind: slotKindToLineKind(slot.kind),
        label: slot.label,
        qty: '1',
        unitDollars: '',
        source_slot_key: slot.key,
        notes: '',
        is_free_addon: false,
      },
    ]);
  }
  function updateDeliverable(i: number, patch: Partial<DeliverableRow>) {
    setDeliverables((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }
  function removeDeliverable(i: number) {
    setDeliverables((prev) => prev.filter((_, idx) => idx !== i));
  }

  // ── Section 5 mutators ─────────────────────────────────────────────
  function addStint() {
    setStints((prev) => [...prev, { label: '', amountDollars: '', dueDate: '' }]);
  }
  function updateStint(i: number, patch: Partial<StintRow>) {
    setStints((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeStint(i: number) {
    setStints((prev) => prev.filter((_, idx) => idx !== i));
  }
  // Convenience: split the total evenly into N equal stints (last absorbs the
  // rounding remainder so the plan always sums to the exact total).
  function autoSplit(n: number) {
    if (n < 1 || deliverablesTotalCents <= 0) return;
    const base = Math.floor(deliverablesTotalCents / n);
    const next: StintRow[] = [];
    let allocated = 0;
    for (let i = 0; i < n; i++) {
      const cents = i === n - 1 ? deliverablesTotalCents - allocated : base;
      allocated += cents;
      next.push({
        label: `Payment ${i + 1} of ${n}`,
        amountDollars: (cents / 100).toFixed(2),
        dueDate: '',
      });
    }
    setStints(next);
  }

  // ── Validation gate (client-side mirror of the API contract) ───────
  function validate(): string | null {
    // Section 1 — buyer + offering.
    if (!userId && !/.+@.+\..+/.test(inviteEmail.trim())) {
      return 'Pick an existing artist or enter a valid email to invite.';
    }
    if (!offeringId) return 'Pick an offering for this project.';

    // Section 2 — shoots (optional, but if present must be complete). Every
    // shoot MUST have a media manager in charge — without one the shoot is
    // silently dropped at finalize (no media_session_bookings row), so we
    // reject it here.
    for (let i = 0; i < shoots.length; i++) {
      const s = shoots[i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) return `Shoot #${i + 1}: pick a date.`;
      if (!/^\d{2}:\d{2}$/.test(s.start_time)) return `Shoot #${i + 1}: pick a start time.`;
      const dur = Number(s.duration_hours);
      if (!Number.isFinite(dur) || dur <= 0) return `Shoot #${i + 1}: duration must be > 0.`;
      if (s.location === 'external' && !s.external_location_text.trim()) {
        return `Shoot #${i + 1}: external shoots need a location.`;
      }
      if (!s.manager_user_id.trim()) {
        return `Shoot #${i + 1}: each shoot needs a media manager in charge.`;
      }
    }

    // Section 3 — deliverables (required, non-empty).
    if (deliverables.length === 0) {
      return 'Add at least one deliverable — a contract needs scope.';
    }
    for (let i = 0; i < deliverables.length; i++) {
      const d = deliverables[i];
      if (!d.label.trim()) return `Deliverable #${i + 1}: needs a label.`;
      const qty = parseInt(d.qty, 10);
      if (!Number.isInteger(qty) || qty < 1) return `Deliverable #${i + 1}: qty must be ≥ 1.`;
      if (!d.is_free_addon) {
        const unit = dollarsToCents(d.unitDollars);
        if (!Number.isInteger(unit) || unit < 0) {
          return `Deliverable #${i + 1}: unit price must be ≥ 0.`;
        }
      }
    }

    // Section 5 — installments (optional; if present must balance + be labeled).
    if (hasPlan) {
      for (let i = 0; i < stints.length; i++) {
        if (!stints[i].label.trim()) return `Payment #${i + 1}: needs a label.`;
      }
      if (!planBalanced) {
        return (
          `Payment schedule must total ${formatCents(deliverablesTotalCents)}. ` +
          `Currently ${formatCents(stintSumCents)} — ` +
          (planDiff > 0
            ? `${formatCents(planDiff)} over.`
            : `${formatCents(-planDiff)} short.`)
        );
      }
    }

    // Section 6 — terms required to send for signature.
    if (!contractTerms.trim()) {
      return 'Write the contract terms before sending it to the artist.';
    }
    return null;
  }

  // ── Submit: create the contract, then manager-sign + email artist ──
  async function submit() {
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      // Buyer fields: existing pick wins; otherwise invite by email.
      const buyerFields: Record<string, unknown> = userId
        ? { user_id: userId }
        : {
            buyer_email: inviteEmail.trim().toLowerCase(),
            buyer_name: inviteName.trim() || undefined,
          };

      const body: Record<string, unknown> = {
        ...buyerFields,
        offering_id: offeringId,
        customer_phone: customerPhone.trim() || undefined,
        notes_to_us: notesToUs.trim() || undefined,
        contract_terms: contractTerms.trim(),
        planned_shoots: shoots.map((s) => {
          const manager = mediaManagers.find((m) => m.user_id === s.manager_user_id);
          return {
            date: s.date,
            start_time: s.start_time,
            duration_hours: Number(s.duration_hours),
            location: s.location,
            external_location_text:
              s.location === 'external' ? s.external_location_text.trim() : undefined,
            // Media manager IN CHARGE — id is re-verified server-side at finalize;
            // name is for display only.
            manager_user_id: s.manager_user_id || undefined,
            manager_name: manager?.name || undefined,
            session_kind: s.session_kind,
          };
        }),
        lineItems: deliverables.map((d, i) => ({
          kind: d.kind,
          label: d.label.trim(),
          qty: parseInt(d.qty, 10),
          unit_cents: d.is_free_addon ? 0 : dollarsToCents(d.unitDollars),
          source_slot_key: d.source_slot_key,
          notes: d.notes.trim() || undefined,
          is_free_addon: d.is_free_addon,
          sort_order: i,
        })),
        package_notes: packageNotes.trim() || undefined,
      };
      if (hasPlan) {
        body.installments = stints.map((s) => ({
          label: s.label.trim(),
          amount_cents: dollarsToCents(s.amountDollars),
          due_date: s.dueDate || undefined,
        }));
      }

      // Step 1 — create everything in one shot.
      const createRes = await fetch('/api/admin/media/bookings/contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        setError(createData.error || 'Could not create the project.');
        setSubmitting(false);
        return;
      }
      const newBookingId: string | undefined = createData.bookingId;
      if (!newBookingId) {
        setError('Project created but no id was returned — open the Projects tab to find it.');
        setSubmitting(false);
        return;
      }

      // Step 2 — manager signs + emails the artist the review-&-sign link.
      const sendRes = await fetch(
        `/api/admin/media/bookings/${newBookingId}/send-contract`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      const sendData = await sendRes.json();
      if (!sendRes.ok) {
        // The booking exists; only the send step failed. Tell the manager
        // they can re-send from the project panel.
        setError(
          `Project created, but sending the contract failed: ${
            sendData.error || 'unknown error'
          }. Open the project in the Projects tab and send it from there.`,
        );
        setSubmitting(false);
        return;
      }

      setSuccess({
        bookingId: newBookingId,
        finalized: !!sendData.finalized,
        emailedArtist: !!sendData.emailedArtist,
        sessionsCreated:
          typeof sendData.sessionsCreated === 'number' ? sendData.sessionsCreated : 0,
        warnings: Array.isArray(sendData.warnings)
          ? sendData.warnings.filter((w: unknown): w is string => typeof w === 'string')
          : [],
        plannedShootCount: shoots.length,
      });
    } catch (e) {
      console.error('[contract-builder] submit error:', e);
      setError('Network error — nothing was sent. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success screen ─────────────────────────────────────────────────
  if (success) {
    // A shoot was dropped if finalize reported warnings, OR it finalized with
    // planned shoots yet created no calendar sessions. Surface this loudly so
    // the manager never assumes a shoot landed on the calendar when it didn't.
    const droppedShoot =
      success.warnings.length > 0 ||
      (success.finalized &&
        success.plannedShootCount > 0 &&
        success.sessionsCreated === 0);
    const warningLines =
      success.warnings.length > 0
        ? success.warnings
        : droppedShoot
          ? ['A planned shoot was not scheduled — no calendar session was created.']
          : [];
    return (
      <section className="bg-white text-black min-h-[70vh]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 border-2 border-accent bg-accent/10 mb-6">
            <CheckCircle2 className="w-8 h-8 text-black" />
          </div>
          <h1 className="text-heading-lg mb-4">CONTRACT SENT</h1>
          <p className="font-mono text-sm text-black/60 max-w-md mx-auto mb-3">
            You signed as the manager.{' '}
            {success.emailedArtist
              ? 'The artist was emailed a link to review and add their signature.'
              : 'Heads up — we could not find an email for the artist, so no email went out. They can still sign from their dashboard.'}
          </p>
          <p className="font-mono text-xs text-black/50 max-w-md mx-auto mb-8">
            {success.finalized
              ? droppedShoot
                ? 'Both signatures are in — the project is finalized. See the warning below: a shoot could not be scheduled.'
                : 'Both signatures are in — the project is finalized and its shoots are on the calendar.'
              : 'Once the artist signs, both parties are confirmed → the booking goes final and the shoots land on the calendar.'}
          </p>

          {/* Dropped-shoot warning — VISIBLE so the manager knows a shoot
              didn't make it onto the calendar. */}
          {warningLines.length > 0 && (
            <div className="border-2 border-amber-300 bg-amber-50 text-amber-900 text-left p-4 mb-8 max-w-md mx-auto space-y-1.5">
              <p className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Shoot scheduling needs attention
              </p>
              <ul className="font-mono text-xs space-y-1">
                {warningLines.map((w, i) => (
                  <li key={i}>⚠ A shoot could not be scheduled: {w}</li>
                ))}
              </ul>
              <p className="font-mono text-[11px] text-amber-900/70 pt-1">
                Open the project in the Projects tab to fix the shoot and confirm
                the date with the artist.
              </p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/media-team"
              className="bg-accent text-black font-mono text-sm font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors no-underline inline-flex items-center justify-center"
            >
              Back to Projects
            </Link>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="border-2 border-black/15 font-mono text-sm font-bold tracking-wider uppercase px-8 py-4 hover:border-black/40 transition-colors inline-flex items-center justify-center"
            >
              Build another
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      {/* Hero — black, mirrors /book */}
      <section className="bg-black text-white py-12 sm:py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/media-team"
            className="font-mono text-white/50 hover:text-accent text-xs uppercase tracking-wider inline-flex items-center gap-1.5 mb-4 no-underline"
          >
            <ArrowLeft className="w-3 h-3" /> Back to Media Team
          </Link>
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-3">
            New Project
          </p>
          <h1 className="text-display-md mb-4">CONTRACT BUILDER</h1>
          <p className="font-mono text-white/70 text-body-md max-w-2xl">
            Build a full media project as a contract — client, shoots, priced
            deliverables, and a payment schedule — then send it to the artist
            for signature. Nothing is charged here; payment links go out per
            installment after both parties sign.
          </p>
        </div>
      </section>

      {/* Body — white */}
      <section className="bg-white text-black py-10 sm:py-14">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          {loadingOptions ? (
            <p className="font-mono text-sm text-black/60">Loading artists + offerings…</p>
          ) : optionsError ? (
            <div className="flex items-start gap-2 p-4 border-2 border-red-200 bg-red-50 text-red-800 font-mono text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {optionsError}
            </div>
          ) : (
            <>
              {/* ── SECTION 1 — CLIENT ──────────────────────────────── */}
              <SectionShell
                n={1}
                kicker="Who's this for"
                title="CLIENT"
                icon={<FileSignature className="w-5 h-5" />}
              >
                <Field label="Artist">
                  <UserSearch
                    users={clients}
                    value={userId}
                    onChange={setUserId}
                    allowInvite
                    requireInviteConfirm
                    inviteEmail={inviteEmail}
                    onInviteEmailChange={setInviteEmail}
                    placeholder="Search artists by name or email…"
                  />
                </Field>
                {/* Optional display name shown only when inviting a new email. */}
                {!userId && inviteEmail.trim() && (
                  <Field label="Artist name (optional)">
                    <input
                      type="text"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      placeholder="How should we address them?"
                      className={inputCls}
                    />
                  </Field>
                )}

                <Field label="Offering">
                  <select
                    value={offeringId}
                    onChange={(e) => {
                      setOfferingId(e.target.value);
                    }}
                    className={inputCls}
                  >
                    <option value="">— Pick an offering —</option>
                    {offerings.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                        {o.price_cents != null ? ` · ${formatCents(o.price_cents)}` : ' · (inquiry)'}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Phone (optional)">
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="(260) 555-0123"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Internal note (optional)">
                    <input
                      type="text"
                      value={notesToUs}
                      onChange={(e) => setNotesToUs(e.target.value)}
                      placeholder="Anything the team should know"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </SectionShell>

              {/* ── SECTION 2 — PRODUCTION LOGISTICS ─────────────────── */}
              <SectionShell
                n={2}
                kicker="When + where we shoot"
                title="PRODUCTION LOGISTICS"
                icon={<Calendar className="w-5 h-5" />}
              >
                <p className="font-mono text-xs text-black/50 leading-relaxed -mt-2">
                  Add each planned shoot. Studio shoots block studio time on the
                  calendar; External shoots block only the engineer. These become
                  real calendar sessions automatically once both parties sign — not
                  before.
                </p>

                {shoots.length === 0 && (
                  <p className="font-mono text-xs text-black/40 border-2 border-dashed border-black/15 px-4 py-6 text-center">
                    No shoots yet. A project can ship deliverables with no shoot —
                    add one only if you&apos;re planning studio or on-location time.
                  </p>
                )}

                <div className="space-y-4">
                  {shoots.map((s, i) => (
                    <div key={i} className="border-2 border-black/10 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="font-mono text-xs font-bold uppercase tracking-wider text-black/60">
                          Shoot #{i + 1}
                        </p>
                        <button
                          type="button"
                          onClick={() => removeShoot(i)}
                          className="text-black/40 hover:text-red-700"
                          aria-label="Remove shoot"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Field label="Date" tight>
                          <input
                            type="date"
                            value={s.date}
                            onChange={(e) => updateShoot(i, { date: e.target.value })}
                            className={inputCls}
                          />
                        </Field>
                        <Field label="Start time (Eastern)" tight>
                          <input
                            type="time"
                            value={s.start_time}
                            onChange={(e) => updateShoot(i, { start_time: e.target.value })}
                            className={inputCls}
                          />
                        </Field>
                        <Field label="Duration (hours)" tight>
                          <input
                            type="number"
                            min={0.5}
                            step={0.5}
                            value={s.duration_hours}
                            onChange={(e) => updateShoot(i, { duration_hours: e.target.value })}
                            className={inputCls}
                          />
                        </Field>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Field label="Location" tight>
                          <select
                            value={s.location}
                            onChange={(e) =>
                              updateShoot(i, {
                                location: e.target.value as 'studio' | 'external',
                              })
                            }
                            className={inputCls}
                          >
                            <option value="studio">Studio (blocks studio time)</option>
                            <option value="external">External (on location)</option>
                          </select>
                        </Field>
                        <Field label="Media manager in charge" tight>
                          <select
                            value={s.manager_user_id}
                            onChange={(e) =>
                              updateShoot(i, { manager_user_id: e.target.value })
                            }
                            className={inputCls}
                          >
                            <option value="" disabled>
                              Select a manager…
                            </option>
                            {mediaManagers.map((m) => (
                              <option key={m.user_id} value={m.user_id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Session kind" tight>
                          <select
                            value={s.session_kind}
                            onChange={(e) =>
                              updateShoot(i, {
                                session_kind: e.target.value as MediaSessionKind,
                              })
                            }
                            className={inputCls}
                          >
                            {SESSION_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {SESSION_KIND_LABELS[k]}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      {s.location === 'external' && (
                        <Field label="Location details" tight>
                          <input
                            type="text"
                            value={s.external_location_text}
                            onChange={(e) =>
                              updateShoot(i, { external_location_text: e.target.value })
                            }
                            placeholder="Address or venue name"
                            className={inputCls}
                          />
                        </Field>
                      )}
                    </div>
                  ))}
                </div>

                {mediaManagers.length === 0 && (
                  <div className="flex items-start gap-2 p-4 border-2 border-amber-200 bg-amber-50 text-amber-900 font-mono text-xs">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    No media managers are on the roster yet — add one before
                    planning shoots, since every shoot needs a manager in charge.
                  </div>
                )}

                <div className="flex items-center justify-between flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={addShoot}
                    disabled={mediaManagers.length === 0}
                    className={`${addBtnCls} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-black`}
                  >
                    <Plus className="w-3.5 h-3.5" /> Add shoot
                  </button>
                  {shoots.length > 0 && (
                    <p className="font-mono text-xs text-black/60">
                      Total production time:{' '}
                      <span className="font-bold text-black">
                        {totalDurationHours} {totalDurationHours === 1 ? 'hour' : 'hours'}
                      </span>
                    </p>
                  )}
                </div>
              </SectionShell>

              {/* ── SECTION 3 — CAMPAIGN DELIVERABLES ────────────────── */}
              <SectionShell
                n={3}
                kicker="What they get"
                title="CAMPAIGN DELIVERABLES"
                icon={<Film className="w-5 h-5" />}
              >
                <p className="font-mono text-xs text-black/50 leading-relaxed -mt-2">
                  Add priced line items — pull them from this offering&apos;s
                  component slots, or build custom ones. Mark a $0 item as a free
                  add-on (it carries the &ldquo;subject to SD socials
                  collaboration&rdquo; clause).
                </p>

                {/* Slot quick-add chips from the selected offering */}
                {offeringSlots.length > 0 && (
                  <div className="border-2 border-black/10 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-2">
                      From {selectedOffering?.title} — click to add
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {offeringSlots.map((slot) => (
                        <button
                          key={slot.key}
                          type="button"
                          onClick={() => addSlotDeliverable(slot)}
                          className="font-mono text-xs px-3 py-1.5 border-2 border-black/15 hover:border-accent hover:bg-accent/10 transition-colors inline-flex items-center gap-1.5"
                        >
                          <Plus className="w-3 h-3" />
                          {slot.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {deliverables.length === 0 && (
                  <p className="font-mono text-xs text-black/40 border-2 border-dashed border-black/15 px-4 py-6 text-center">
                    No deliverables yet — a contract needs at least one.
                  </p>
                )}

                <div className="space-y-4">
                  {deliverables.map((d, i) => {
                    const qty = parseInt(d.qty, 10);
                    const unit = d.is_free_addon ? 0 : dollarsToCents(d.unitDollars);
                    const lineTotal =
                      Number.isInteger(qty) && qty >= 1 ? qty * unit : 0;
                    return (
                      <div key={i} className="border-2 border-black/10 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="font-mono text-xs font-bold uppercase tracking-wider text-black/60">
                            Deliverable #{i + 1}
                            {d.source_slot_key && (
                              <span className="ml-2 text-accent normal-case tracking-normal">
                                · from offering
                              </span>
                            )}
                          </p>
                          <button
                            type="button"
                            onClick={() => removeDeliverable(i)}
                            className="text-black/40 hover:text-red-700"
                            aria-label="Remove deliverable"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Field label="Label" tight>
                            <input
                              type="text"
                              value={d.label}
                              onChange={(e) => updateDeliverable(i, { label: e.target.value })}
                              placeholder="e.g. Music video — final cut"
                              className={inputCls}
                            />
                          </Field>
                          <Field label="Kind" tight>
                            <select
                              value={d.kind}
                              onChange={(e) =>
                                updateDeliverable(i, { kind: e.target.value as LineItemKind })
                              }
                              className={inputCls}
                            >
                              {LINE_ITEM_KINDS.map((k) => (
                                <option key={k} value={k}>
                                  {LINE_ITEM_KIND_LABELS[k]}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                          <Field label="Qty" tight>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={d.qty}
                              onChange={(e) => updateDeliverable(i, { qty: e.target.value })}
                              className={inputCls}
                            />
                          </Field>
                          <Field label="Unit price ($)" tight>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={d.is_free_addon ? '0.00' : d.unitDollars}
                              disabled={d.is_free_addon}
                              onChange={(e) =>
                                updateDeliverable(i, { unitDollars: e.target.value })
                              }
                              placeholder="0.00"
                              className={`${inputCls} disabled:bg-black/5 disabled:text-black/40`}
                            />
                          </Field>
                          <div className="font-mono text-sm pb-3">
                            <span className="text-black/50">Line total: </span>
                            <span className="font-bold">{formatCents(lineTotal)}</span>
                          </div>
                        </div>
                        <Field label="Notes (optional)" tight>
                          <input
                            type="text"
                            value={d.notes}
                            onChange={(e) => updateDeliverable(i, { notes: e.target.value })}
                            placeholder="Anything specific about this deliverable"
                            className={inputCls}
                          />
                        </Field>
                        <label className="flex items-center gap-2 font-mono text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={d.is_free_addon}
                            onChange={(e) =>
                              updateDeliverable(i, { is_free_addon: e.target.checked })
                            }
                            className="w-4 h-4"
                          />
                          <span>
                            Free add-on{' '}
                            <span className="text-black/40">
                              (subject to SD socials collaboration)
                            </span>
                          </span>
                        </label>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between flex-wrap gap-3">
                  <button type="button" onClick={addCustomDeliverable} className={addBtnCls}>
                    <Plus className="w-3.5 h-3.5" /> Add custom deliverable
                  </button>
                  <p className="font-mono text-sm text-black/60">
                    Deliverables subtotal:{' '}
                    <span className="font-bold text-black">
                      {formatCents(deliverablesTotalCents)}
                    </span>
                  </p>
                </div>

                <Field label="Package notes (optional)">
                  <input
                    type="text"
                    value={packageNotes}
                    onChange={(e) => setPackageNotes(e.target.value)}
                    placeholder="A note shown with the whole deliverables package"
                    className={inputCls}
                  />
                </Field>
              </SectionShell>

              {/* ── SECTION 4 — TOTAL INVESTMENT ─────────────────────── */}
              <SectionShell
                n={4}
                kicker="The number"
                title="TOTAL INVESTMENT"
                icon={<DollarSign className="w-5 h-5" />}
              >
                {deliverables.length === 0 ? (
                  <p className="font-mono text-xs text-black/40">
                    Add deliverables above to see the investment breakdown.
                  </p>
                ) : (
                  <div className="border-2 border-black">
                    <ul className="divide-y divide-black/10">
                      {deliverables.map((d, i) => {
                        const qty = parseInt(d.qty, 10);
                        const unit = d.is_free_addon ? 0 : dollarsToCents(d.unitDollars);
                        const lineTotal =
                          Number.isInteger(qty) && qty >= 1 ? qty * unit : 0;
                        return (
                          <li
                            key={i}
                            className="flex items-center justify-between px-4 py-3 gap-3"
                          >
                            <div className="min-w-0">
                              <p className="font-mono text-sm truncate">
                                {d.label.trim() || `Deliverable #${i + 1}`}
                                <span className="text-black/40">
                                  {' '}
                                  × {Number.isInteger(qty) && qty >= 1 ? qty : '—'}
                                </span>
                              </p>
                              {d.is_free_addon && (
                                <p className="font-mono text-[10px] uppercase tracking-wider text-accent">
                                  Free add-on
                                </p>
                              )}
                            </div>
                            <p className="font-mono text-sm font-bold tabular-nums shrink-0">
                              {formatCents(lineTotal)}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="flex items-center justify-between px-4 py-4 bg-black text-white">
                      <p className="font-mono text-sm font-bold uppercase tracking-wider">
                        Grand total
                      </p>
                      <p className="text-heading-md tabular-nums">
                        {formatCents(deliverablesTotalCents)}
                      </p>
                    </div>
                  </div>
                )}
              </SectionShell>

              {/* ── SECTION 5 — PAYMENT SCHEDULE ─────────────────────── */}
              <SectionShell
                n={5}
                kicker="How they pay"
                title="PAYMENT SCHEDULE"
                icon={<CreditCard className="w-5 h-5" />}
              >
                <p className="font-mono text-xs text-black/50 leading-relaxed -mt-2">
                  Optional. Break the total into installments — the schedule must
                  add up to the investment total exactly. Leave empty to collect
                  the full amount in one go later.
                </p>

                {/* Auto-split helpers */}
                {deliverablesTotalCents > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-black/50">
                      Quick split:
                    </span>
                    {[2, 3, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => autoSplit(n)}
                        className="font-mono text-xs px-3 py-1.5 border-2 border-black/15 hover:border-accent hover:bg-accent/10 transition-colors"
                      >
                        {n} payments
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-3">
                  {stints.map((s, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-1 sm:grid-cols-[1fr_140px_160px_auto] gap-3 items-end border-2 border-black/10 p-3"
                    >
                      <Field label={`Payment #${i + 1} label`} tight>
                        <input
                          type="text"
                          value={s.label}
                          onChange={(e) => updateStint(i, { label: e.target.value })}
                          placeholder="e.g. Deposit"
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Amount ($)" tight>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={s.amountDollars}
                          onChange={(e) => updateStint(i, { amountDollars: e.target.value })}
                          placeholder="0.00"
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Due (optional)" tight>
                        <input
                          type="date"
                          value={s.dueDate}
                          onChange={(e) => updateStint(i, { dueDate: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                      <button
                        type="button"
                        onClick={() => removeStint(i)}
                        className="text-black/40 hover:text-red-700 pb-3"
                        aria-label="Remove payment"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between flex-wrap gap-3">
                  <button type="button" onClick={addStint} className={addBtnCls}>
                    <Plus className="w-3.5 h-3.5" /> Add payment
                  </button>
                  {hasPlan && (
                    <div className="font-mono text-sm">
                      <span className="text-black/50">Schedule total: </span>
                      <span
                        className={`font-bold tabular-nums ${
                          planBalanced ? 'text-green-700' : 'text-red-700'
                        }`}
                      >
                        {formatCents(stintSumCents)}
                      </span>
                      <span className="text-black/40">
                        {' '}
                        / {formatCents(deliverablesTotalCents)}
                      </span>
                      {!planBalanced && (
                        <span className="text-red-700 ml-2">
                          ({planDiff > 0 ? `${formatCents(planDiff)} over` : `${formatCents(-planDiff)} short`})
                        </span>
                      )}
                      {planBalanced && <span className="text-green-700 ml-2">✓ balanced</span>}
                    </div>
                  )}
                </div>
              </SectionShell>

              {/* ── SECTION 6 — AUTHORIZATION ────────────────────────── */}
              <SectionShell
                n={6}
                kicker="Make it official"
                title="AUTHORIZATION"
                icon={<FileSignature className="w-5 h-5" />}
              >
                <Field label="Contract terms">
                  <div className="flex items-center justify-between gap-3 -mb-1">
                    <p className="font-mono text-[10px] text-black/50 leading-relaxed">
                      Prefilled with Sweet Dreams default terms — edit freely
                      before sending.
                    </p>
                    {termsTouched && (
                      <button
                        type="button"
                        onClick={() => {
                          setTermsTouched(false);
                          setContractTerms(
                            buildDefaultContractTerms({
                              projectTitle: selectedOffering?.title ?? null,
                              artistName: artistNameForTerms,
                              totalCents: deliverablesTotalCents,
                              hasInstallments: hasPlan,
                            }),
                          );
                        }}
                        className="font-mono text-[10px] uppercase tracking-wider text-black/50 hover:text-black shrink-0"
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                  <textarea
                    value={contractTerms}
                    onChange={(e) => {
                      setTermsTouched(true);
                      setContractTerms(e.target.value);
                    }}
                    rows={14}
                    placeholder="Spell out the agreement — scope, ownership, usage rights, revisions, cancellation, anything the artist is agreeing to."
                    className={`${inputCls} resize-y leading-relaxed`}
                  />
                </Field>

                <div className="border-2 border-black/10 bg-black/[0.02] p-4">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-2">
                    What happens when you send
                  </p>
                  <ol className="font-mono text-xs text-black/60 space-y-1.5 leading-relaxed list-decimal list-inside">
                    <li>You sign as the manager and the project is created (unpaid).</li>
                    <li>The artist gets an email with a link to review and sign.</li>
                    <li>
                      Once the artist signs → both parties confirmed → the booking
                      goes final and its shoots land on the calendar.
                    </li>
                    <li>Payment links go out per installment afterward.</li>
                  </ol>
                </div>

                {error && (
                  <div className="flex items-start gap-2 p-4 border-2 border-red-200 bg-red-50 text-red-800 font-mono text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    {error}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitting}
                    className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                  >
                    <FileSignature className="w-4 h-4" />
                    {submitting ? 'Sending…' : 'Send contract to artist for signature'}
                  </button>
                  <Link
                    href="/media-team"
                    className="font-mono text-sm text-black/50 hover:text-black uppercase tracking-wider no-underline inline-flex items-center justify-center px-4 py-4"
                  >
                    Cancel
                  </Link>
                </div>
              </SectionShell>
            </>
          )}
        </div>
      </section>
    </>
  );
}

// ── Presentation helpers ───────────────────────────────────────────────

const inputCls =
  'w-full border-2 border-black/15 px-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none';

const addBtnCls =
  'font-mono text-xs font-bold uppercase tracking-wider px-4 py-2.5 border-2 border-black hover:bg-black hover:text-white transition-colors inline-flex items-center gap-1.5';

function SectionShell({
  n,
  kicker,
  title,
  icon,
  children,
}: {
  n: number;
  kicker: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 border-b-2 border-black pb-3">
        <span className="inline-flex items-center justify-center w-9 h-9 bg-black text-white font-mono text-sm font-bold shrink-0">
          {n}
        </span>
        <div className="min-w-0">
          <p className="font-mono text-accent text-[10px] font-semibold tracking-[0.2em] uppercase">
            {kicker}
          </p>
          <h2 className="text-heading-md inline-flex items-center gap-2">
            <span className="text-black/30">{icon}</span>
            {title}
          </h2>
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
  tight,
}: {
  label: string;
  children: React.ReactNode;
  tight?: boolean;
}) {
  return (
    <div className={tight ? 'space-y-1.5' : 'space-y-2'}>
      <label className="font-mono text-[10px] uppercase tracking-wider text-black/50 block">
        {label}
      </label>
      {children}
    </div>
  );
}
