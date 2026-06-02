// app/dashboard/media/orders/[id]/page.tsx
//
// Order detail. Shows what was bought (offering + the configurator manifest
// if there was one), the prepaid balance granted (if any), and any sessions
// already scheduled with their engineer + location. CTA: schedule a new
// session, which routes to the form page.
//
// Authorization: user must own the booking OR be a member of its band.
// Anything else 404s rather than 403 — we don't reveal the existence of
// orders the user has no claim to.

import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Clock,
  MapPin,
  CheckCircle2,
  Plus,
  XCircle,
  Download,
} from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { getUserBands } from '@/lib/bands-server';
import { createServiceClient } from '@/lib/supabase/server';
import { getSessionsForBooking, getEngineerByUserId } from '@/lib/media-scheduling-server';
import { SESSION_KIND_LABELS } from '@/lib/media-scheduling';
import { formatCents } from '@/lib/utils';
import { fmtStampDate, fmtStampDateTime, fmtStampTime } from '@/lib/studio-time';
import { describeConfig, type ConfiguredComponents } from '@/lib/media-config';
import DashboardNav from '@/components/layout/DashboardNav';
import CancelSessionButton from '@/components/media/CancelSessionButton';
import MessageThread from '@/components/media/MessageThread';
import PackageReview from '@/components/media/PackageReview';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Order — Sweet Dreams Media',
};

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?redirect=/dashboard/media/orders/${id}`);

  const service = createServiceClient();
  const { data: bookingRow } = await service
    .from('media_bookings')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!bookingRow) notFound();
  const booking = bookingRow as {
    id: string;
    offering_id: string;
    user_id: string;
    band_id: string | null;
    status: string;
    configured_components: unknown | null;
    project_details: {
      project_name?: string | null;
      artist_name?: string | null;
      songs?: string | null;
      songs_breakdown?: Array<{ title: string; notes?: string | null }>;
      cover_art_name?: string | null;
      shorts_song_targets?: string | null;
      references?: string | null;
      vibe?: string | null;
      release_date?: string | null;
      notes?: string | null;
    } | null;
    final_price_cents: number;
    deposit_cents: number | null;
    actual_deposit_paid: number | null;
    final_paid_at: string | null;
    is_test: boolean | null;
    component_status: Record<string, {
      completed?: boolean;
      completed_at?: string | null;
      drive_url?: string | null;
      notified_at?: string | null;
      completed_by?: string | null;
    }> | null;
    created_at: string;
    notes_to_us: string | null;
    deliverables: { items?: Array<{ label: string; url: string; kind?: string; added_at?: string }> } | null;
  };

  // Ownership check
  if (booking.user_id !== user.id) {
    if (!booking.band_id) notFound();
    const memberships = await getUserBands(user.id);
    if (!memberships.some((m) => m.band_id === booking.band_id)) notFound();
  }

  // Offering — needed for the manifest + slug for any drill-down
  const { data: offeringRow } = await service
    .from('media_offerings')
    .select('*')
    .eq('id', booking.offering_id)
    .maybeSingle();
  const offering = offeringRow as {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    public_blurb: string | null;
    components: unknown | null;
    studio_hours_included: number;
    price_cents: number | null;
    price_range_low_cents: number | null;
    price_range_high_cents: number | null;
  } | null;
  if (!offering) notFound();

  // Sessions for this order
  const sessions = await getSessionsForBooking(id, service);

  // Resolve engineer names for each session — small batch, one query
  // per unique engineer. For Phase D MVP this is fine; if we ever surface
  // hundreds of sessions per order, denormalize.
  const uniqueEngineers = Array.from(new Set(sessions.map((s) => s.engineer_id)));
  const engineerNameMap = new Map<string, string>();
  for (const uid of uniqueEngineers) {
    const e = await getEngineerByUserId(uid, service);
    if (e) engineerNameMap.set(uid, e.name);
  }

  // Configurator manifest (if present)
  const manifestLines: string[] = booking.configured_components
    ? describeConfig(
        offering as Parameters<typeof describeConfig>[0],
        booking.configured_components as ConfiguredComponents,
      )
    : [];

  // Status copy + scheduling availability. Inquiry rows can't schedule
  // (they need to pay first). Cancelled obviously not.
  const canSchedule =
    booking.status !== 'inquiry' &&
    booking.status !== 'cancelled' &&
    booking.status !== 'delivered';

  const activeSessions = sessions.filter((s) => s.status !== 'cancelled');
  const cancelledSessions = sessions.filter((s) => s.status === 'cancelled');

  return (
    <>
      <DashboardNav
        role={user.role}
        isProducer={user.is_producer}
        displayName={user.profile?.display_name}
        email={user.email}
        profileSlug={user.profile?.public_profile_slug}
      />

      <section className="bg-black text-white py-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/dashboard/media/orders"
            className="font-mono text-xs text-white/60 hover:text-white no-underline inline-flex items-center gap-1 mb-6"
          >
            <ArrowLeft className="w-3 h-3" />
            All orders
          </Link>
          <p className="font-mono text-accent text-xs font-semibold tracking-[0.3em] uppercase mb-2">
            Order · Status: {booking.status}
            {booking.is_test && (
              <span className="ml-2 px-2 py-0.5 bg-purple-700 text-white text-[10px] font-bold tracking-wider">
                TEST
              </span>
            )}
          </p>
          <h1 className="text-heading-xl mb-2">{offering.title}</h1>
          <p className="font-mono text-sm text-white/60">
            Ordered {fmtStampDate(booking.created_at, { month: 'long', day: 'numeric', year: 'numeric' })}
            {' · '}
            {booking.final_price_cents > 0
              ? formatCents(booking.final_price_cents)
              : 'Inquiry — no payment yet'}
          </p>
        </div>
      </section>

      <section className="bg-white text-black py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">

          {/* Balance owed — Round 7. Shows what's been collected, what's
              still owed, and whether the order is fully paid. The team
              calls to plan + bills the remainder, so the buyer needs to
              see the gap clearly. */}
          {booking.final_price_cents > 0 && (
            <BalancePanel
              total={booking.final_price_cents}
              depositPaid={booking.actual_deposit_paid ?? booking.deposit_cents ?? 0}
              fullyPaidAt={booking.final_paid_at}
              isTest={!!booking.is_test}
            />
          )}

          {/* Proposed package — Round 8c. Hidden when no package or
              still in draft (admin's still building). Once sent, buyer
              reviews + approves each line item here. */}
          <PackageReview bookingId={booking.id} />

          {/* Conversation — Round 8b. Buyer ↔ admin ↔ engineer thread.
              Drives all the scoping, idea sharing, and date negotiation
              that doesn't fit cleanly into a payment or status field. */}
          <div id="conversation">
            <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-3">
              Talk to us
            </p>
            <MessageThread bookingId={booking.id} />
            <p className="font-mono text-[11px] text-black/40 mt-2">
              Cole or Jay will reply here. References, ideas, and date proposals all
              live in this thread so nothing gets lost.
            </p>
          </div>

          {/* Production status — Round 7. Per-component progress: cover
              art done, shorts pending, etc. Renders only when the
              offering has slots and we have status data. */}
          <ProductionStatusPanel
            offeringSlots={(offering.components as { slots?: Array<{ key: string; label: string; kind?: string }> } | null)?.slots ?? []}
            status={booking.component_status ?? {}}
          />

          {/* What you bought */}
          {(manifestLines.length > 0 || offering.studio_hours_included > 0) && (
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-3">
                What you bought
              </p>
              <div className="border-2 border-black/10 p-5 space-y-3">
                {manifestLines.length > 0 && (
                  <ul className="space-y-1.5 text-sm">
                    {manifestLines.map((line, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {offering.studio_hours_included > 0 && (
                  <p className="font-mono text-xs text-black/60 pt-3 border-t border-black/10">
                    Includes <strong>{offering.studio_hours_included} hours</strong> of
                    studio time on your prepaid balance — book those via{' '}
                    <Link href="/book" className="underline hover:text-accent">/book</Link>{' '}
                    when you&apos;re ready.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Sessions */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="font-mono text-[11px] uppercase tracking-wider text-black/50">
                Scheduled sessions
              </p>
              {canSchedule && (
                <Link
                  href={`/dashboard/media/orders/${id}/schedule`}
                  className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-accent hover:text-black transition-colors no-underline inline-flex items-center gap-2"
                >
                  <Plus className="w-3 h-3" />
                  Schedule session
                </Link>
              )}
            </div>

            {activeSessions.length === 0 ? (
              <div className="border-2 border-dashed border-black/10 p-6 text-center">
                <p className="font-mono text-sm text-black/60 mb-2">
                  No sessions scheduled yet.
                </p>
                {canSchedule ? (
                  <p className="text-sm text-black/50">
                    Pick a date, engineer, and location — we&apos;ll handle conflict checks.
                  </p>
                ) : booking.status === 'inquiry' ? (
                  <p className="text-sm text-black/50">
                    This is an inquiry. Once we lock pricing and you pay, you&apos;ll be able
                    to schedule sessions here.
                  </p>
                ) : (
                  <p className="text-sm text-black/50">
                    Sessions can&apos;t be scheduled in this status.
                  </p>
                )}
              </div>
            ) : (
              <ul className="space-y-2">
                {activeSessions.map((s) => {
                  const engineerName = engineerNameMap.get(s.engineer_id) || 'Engineer';
                  const startLabel = fmtStampDateTime(s.starts_at, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                  const endLabel = fmtStampTime(s.ends_at);
                  return (
                    <li
                      key={s.id}
                      className="border-2 border-black/10 p-4 flex items-start justify-between gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold">
                            {SESSION_KIND_LABELS[s.session_kind]}
                          </h3>
                          <span
                            className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 ${
                              s.status === 'scheduled'
                                ? 'bg-blue-100 text-blue-900'
                                : s.status === 'in_progress'
                                ? 'bg-yellow-100 text-yellow-900'
                                : s.status === 'completed'
                                ? 'bg-green-100 text-green-900'
                                : 'bg-black/10 text-black/70'
                            }`}
                          >
                            {s.status}
                          </span>
                        </div>
                        <div className="font-mono text-xs text-black/60 space-y-0.5">
                          <p className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {startLabel} – {endLabel}
                          </p>
                          <p className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {s.location === 'studio'
                              ? 'Sweet Dreams Studio'
                              : s.external_location_text || 'External (TBD)'}
                          </p>
                          <p>Engineer: {engineerName}</p>
                          {s.notes && <p className="mt-1.5 italic text-black/50">&ldquo;{s.notes}&rdquo;</p>}
                        </div>
                      </div>
                      {s.status === 'scheduled' && (
                        <CancelSessionButton sessionId={s.id} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {cancelledSessions.length > 0 && (
              <details className="mt-4">
                <summary className="font-mono text-xs text-black/40 cursor-pointer hover:text-black/60">
                  {cancelledSessions.length} cancelled session{cancelledSessions.length === 1 ? '' : 's'}
                </summary>
                <ul className="mt-2 space-y-2">
                  {cancelledSessions.map((s) => (
                    <li key={s.id} className="font-mono text-xs text-black/40 flex items-center gap-2">
                      <XCircle className="w-3 h-3" />
                      {SESSION_KIND_LABELS[s.session_kind]} ·
                      {' '}{fmtStampDateTime(s.starts_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {/* Deliverables — admin populates as production wraps */}
          {booking.deliverables?.items && booking.deliverables.items.length > 0 && (
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-3">
                Your deliverables
              </p>
              <ul className="space-y-2">
                {booking.deliverables.items.map((d, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 border-2 border-black/10 p-3 hover:border-accent transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-bold truncate">{d.label}</p>
                      {d.kind && (
                        <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">
                          {d.kind}
                          {d.added_at && (
                            <> · added {fmtStampDate(d.added_at, { month: 'short', day: 'numeric' })}</>
                          )}
                        </p>
                      )}
                    </div>
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs uppercase tracking-wider text-accent hover:underline inline-flex items-center gap-1 shrink-0"
                    >
                      <Download className="w-3 h-3" />
                      Open
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Project details — captured at the questionnaire step. We
              render every field that has a value so the buyer can quickly
              eyeball what we have on file (and reach out if something
              needs correcting). Optional fields just hide when empty. */}
          {booking.project_details && (
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-3">
                Project details on file
              </p>
              <div className="border-2 border-black/10 p-5 space-y-3">
                {booking.project_details.project_name && (
                  <ProjectDetailRow label="Project" value={booking.project_details.project_name} />
                )}
                {booking.project_details.artist_name && (
                  <ProjectDetailRow label="Artist" value={booking.project_details.artist_name} />
                )}
                {booking.project_details.songs && (
                  <ProjectDetailRow label="Songs" value={booking.project_details.songs} multiline />
                )}
                {booking.project_details.vibe && (
                  <ProjectDetailRow label="Vibe / mood" value={booking.project_details.vibe} multiline />
                )}
                {booking.project_details.references && (
                  <ProjectDetailRow label="References" value={booking.project_details.references} multiline />
                )}
                {booking.project_details.release_date && (
                  <ProjectDetailRow
                    label="Target release"
                    value={new Date(booking.project_details.release_date).toLocaleDateString('en-US', {
                      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
                    })}
                  />
                )}
                {booking.project_details.notes && (
                  <ProjectDetailRow label="Extra notes" value={booking.project_details.notes} multiline />
                )}
              </div>
              <p className="font-mono text-[11px] text-black/40 mt-2">
                Need to update something? Reply to your order confirmation email and we&apos;ll fix it.
              </p>
            </div>
          )}

          {booking.notes_to_us && (
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-2">
                Your notes
              </p>
              <div className="border-l-3 border-accent bg-black/[0.02] p-4 text-sm whitespace-pre-wrap">
                {booking.notes_to_us}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tiny presentational helper. Multiline values keep their line breaks
// (whitespace-pre-wrap) so a buyer who pasted a list of references gets
// a readable list back, not a single mashed-together paragraph.
// ──────────────────────────────────────────────────────────────────────
function ProjectDetailRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-1 sm:gap-3">
      <p className="font-mono text-[11px] uppercase tracking-wider text-black/50">
        {label}
      </p>
      <p
        className={`text-sm text-black/85 ${
          multiline ? 'whitespace-pre-wrap' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Round 7: Balance panel. Shows total + deposit paid + remainder owed
// at the top of the order page. When fully paid, collapses into a
// quiet "Paid in full" badge. Test orders get a clear marker so
// buyers can't be confused about whether they actually owe money.
// ──────────────────────────────────────────────────────────────────────
function BalancePanel({
  total,
  depositPaid,
  fullyPaidAt,
  isTest,
}: {
  total: number;
  depositPaid: number;
  fullyPaidAt: string | null;
  isTest: boolean;
}) {
  const remainder = Math.max(0, total - depositPaid);
  const isFullyPaid = !!fullyPaidAt || remainder === 0;

  if (isTest) {
    return (
      <div className="border-2 border-purple-300 bg-purple-50 p-5">
        <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-purple-900 mb-1">
          Test order
        </p>
        <p className="font-mono text-sm text-purple-900/80">
          This order was created in test mode. <strong>No payment was actually processed</strong> —
          it&apos;s here for QA purposes only and is excluded from accounting.
        </p>
      </div>
    );
  }

  if (isFullyPaid) {
    return (
      <div className="border-2 border-green-300 bg-green-50 p-5 flex items-center gap-3">
        <span className="font-mono text-[11px] uppercase tracking-wider font-bold text-green-900 px-2 py-0.5 bg-green-200">
          Paid in full
        </span>
        <p className="font-mono text-sm text-green-900/80">
          Total {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(total / 100)} settled.
        </p>
      </div>
    );
  }

  return (
    <div className="border-2 border-accent bg-accent/10 p-5">
      <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/70 mb-3">
        Balance
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
            Total
          </p>
          <p className="font-mono text-lg font-bold">
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(total / 100)}
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
            Paid (deposit)
          </p>
          <p className="font-mono text-lg font-bold text-black/70">
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(depositPaid / 100)}
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
            Still owed
          </p>
          <p className="font-mono text-lg font-bold text-black">
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(remainder / 100)}
          </p>
        </div>
      </div>
      <p className="font-mono text-[11px] text-black/55 mt-3">
        We&apos;ll bill the remainder once we&apos;ve scoped the project with you on a call.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Round 7: Production status panel. Renders one row per slot in the
// offering's components, showing whether each piece is in-progress or
// completed. When admin attaches a Drive link to a completed slot, the
// row shows a download CTA. Empty when the offering has no slots
// (à la carte standalones).
// ──────────────────────────────────────────────────────────────────────
function ProductionStatusPanel({
  offeringSlots,
  status,
}: {
  offeringSlots: Array<{ key: string; label: string; kind?: string }>;
  status: Record<string, {
    completed?: boolean;
    completed_at?: string | null;
    drive_url?: string | null;
    notified_at?: string | null;
    completed_by?: string | null;
  }>;
}) {
  if (!offeringSlots.length) return null;

  // Don't render the panel if literally nothing has happened yet — the
  // buyer's order is too fresh. We show the panel as soon as the first
  // status update lands (admin marked anything).
  const hasAnyActivity = offeringSlots.some((slot) => {
    const s = status[slot.key];
    return !!s && (s.completed || s.drive_url);
  });

  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-wider text-black/50 mb-3">
        Production status
      </p>
      <div className="border-2 border-black/10">
        {!hasAnyActivity && (
          <p className="font-mono text-xs text-black/55 p-5">
            We haven&apos;t started yet — once we&apos;ve scoped the project, each piece will show
            up here with a status (in progress / completed) and a download link when it&apos;s ready.
          </p>
        )}
        {hasAnyActivity && (
          <ul className="divide-y divide-black/10">
            {offeringSlots.map((slot) => {
              const s = status[slot.key] ?? {};
              const isComplete = !!s.completed;
              return (
                <li key={slot.key} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-sm">{slot.label}</p>
                    {isComplete && s.completed_at && (
                      <p className="font-mono text-[11px] text-black/55">
                        Completed {fmtStampDate(s.completed_at, { month: 'short', day: 'numeric' })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 ${
                        isComplete
                          ? 'bg-green-100 text-green-900'
                          : 'bg-black/10 text-black/60'
                      }`}
                    >
                      {isComplete ? 'Completed' : 'In progress'}
                    </span>
                    {isComplete && s.drive_url && (
                      <a
                        href={s.drive_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] uppercase tracking-wider text-accent hover:underline"
                      >
                        Download
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
