'use client';

// ArtistRoadmap — the gated Career Development Path (Plan 6 P6).
// Five stages of verifiable gates + the Playbook (the old 18 written lessons,
// now read-tracked). Stage = highest stage where ALL gates are complete.
// Honor items are light XP; verified gates move your stage. Advice never blocks.

import { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Check,
  Loader2,
  Lock,
  Lightbulb,
  Music,
  TrendingUp,
  DollarSign,
  Globe,
  Mic,
  Users,
  Link2,
  Copy,
  BookOpen,
  Plus,
  Trash2,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import TierBadge from '@/components/career/TierBadge';
import { STAGE_NAMES } from '@/lib/career';
import { ROADMAP_SECTIONS } from '@/lib/playbook-content';

// ============================================================
// Types (mirrors getCareerSummary in lib/career-rules.ts)
// ============================================================

type VerifyType = 'auto' | 'semi' | 'confirm' | 'playbook';

interface ConfirmField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'url';
}

interface Requirement {
  key: string;
  stage: number;
  title: string;
  description: string | null;
  verifyType: VerifyType;
  confirmFields: ConfirmField[] | null;
  xp: number;
  rule: Record<string, unknown> | null;
  status: 'complete' | 'pending';
  completedAt: string | null;
  evidence: { snapshot?: Record<string, unknown>; answers?: Record<string, unknown> } | null;
}

interface CareerSummary {
  stage: number;
  stageLabel: string;
  highestTier: number | null;
  tiers: { tier: number; label: string; achievedAt: string }[];
  requirements: Requirement[];
}

interface Show {
  id: string;
  venue: string;
  city: string | null;
  show_date: string;
  is_paid: boolean;
  is_headline: boolean;
  confirmed_at: string | null;
  photo_url: string | null;
  calendar_event_id: string | null;
  created_at: string;
}

interface Contact {
  id: string;
  name: string;
  handle: string | null;
  role: string;
  met_at: string | null;
  source: string;
  created_at: string;
}

interface ShareFeedback {
  id: string;
  listener_name: string;
  listener_email: string;
  vibe_score: number;
  favorite_moment_seconds: number | null;
  comment: string | null;
  added_to_contacts: boolean;
  created_at: string;
}

interface ShareLink {
  id: string;
  track_label: string;
  token: string;
  expires_at: string | null;
  revoked: boolean;
  play_count: number;
  created_at: string;
  feedback: ShareFeedback[];
  feedbackCount: number;
  avgVibe: number | null;
}

interface MyFile {
  id: string;
  display_name: string | null;
  file_name: string;
  created_at: string;
}

// Stage → playbook section id (lib/playbook-content)
const STAGE_TO_SECTION: Record<number, string> = {
  1: 'foundation',
  2: 'creating',
  3: 'growing',
  4: 'monetizing',
  5: 'scaling',
};

// Playbook icon names → lucide components
const ICON_MAP = { Lightbulb, Music, TrendingUp, DollarSign, Globe } as const;

const CONTACT_ROLES = ['artist', 'producer', 'videographer', 'designer', 'other'] as const;

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// A show only counts toward the gates if it was LOGGED before it happened AND
// its calendar entry actually got created — the server gate (lib/career-rules
// CHECKS.shows_performed via ctx.showsConfirmed[].preDated) requires BOTH a
// non-null calendar_event_id AND created_at predating (or equal to) the show
// date. A past-dated show — or one whose calendar event failed to create —
// confirms green but is gate-inert, so mirror that predicate exactly here.
function loggedOnTime(show: Show): boolean {
  return !!show.calendar_event_id && show.created_at.slice(0, 10) <= show.show_date;
}

// ============================================================
// Verify-type badge
// ============================================================

function VerifyBadge({ type }: { type: VerifyType }) {
  const base = 'font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 flex-shrink-0';
  switch (type) {
    case 'auto':
      return <span className={`${base} bg-accent text-black font-bold`}>Verified Auto</span>;
    case 'semi':
      return <span className={`${base} bg-accent/15 text-accent border border-accent/40 font-bold`}>Verified + Confirm</span>;
    case 'confirm':
      return <span className={`${base} bg-black/5 text-black/50`}>Honor</span>;
    case 'playbook':
      return <span className={`${base} border border-black/20 text-black/60`}>Read</span>;
  }
}

// ============================================================
// Component
// ============================================================

export default function ArtistRoadmap() {
  const [summary, setSummary] = useState<CareerSummary | null>(null);
  const [shows, setShows] = useState<Show[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [myFiles, setMyFiles] = useState<MyFile[] | null>(null);
  const [readProgress, setReadProgress] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [expandedStages, setExpandedStages] = useState<Set<number>>(new Set());
  const [expandedPlaybook, setExpandedPlaybook] = useState<Set<string>>(new Set());
  const [savingRead, setSavingRead] = useState<string | null>(null);

  // Confirm-gate inline form
  const [confirmOpen, setConfirmOpen] = useState<string | null>(null);
  const [confirmAnswers, setConfirmAnswers] = useState<Record<string, string>>({});
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Shows panel
  const [showFormOpen, setShowFormOpen] = useState(false);
  const [showForm, setShowForm] = useState({ venue: '', city: '', show_date: '', is_paid: false, is_headline: false });
  const [showSaving, setShowSaving] = useState(false);
  const [showError, setShowError] = useState<string | null>(null);
  const [confirmingShow, setConfirmingShow] = useState<string | null>(null);
  const [showPhotoUrl, setShowPhotoUrl] = useState('');

  // Contacts panel
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', handle: '', role: 'artist', met_at: '' });
  const [contactSaving, setContactSaving] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  // Share-links panel
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const [linkForm, setLinkForm] = useState({ track_label: '', deliverable_id: '', expires_at: '' });
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [expandedLink, setExpandedLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [linkActionBusy, setLinkActionBusy] = useState<string | null>(null);

  // ── Data loaders ─────────────────────────────────────────

  const fetchShows = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/shows');
      if (res.ok) setShows((await res.json()).shows || []);
    } catch { /* keep last state */ }
  }, []);

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/contacts');
      if (res.ok) setContacts((await res.json()).contacts || []);
    } catch { /* keep last state */ }
  }, []);

  const fetchShareLinks = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/share-links');
      if (res.ok) setShareLinks((await res.json()).links || []);
    } catch { /* keep last state */ }
  }, []);

  // POST /api/hub/career = re-evaluate gates then return the fresh summary.
  // Called after every user action that could move a gate.
  const refreshCareer = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/career', { method: 'POST' });
      if (res.ok) setSummary(await res.json());
    } catch { /* keep last state */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      try {
        const [careerRes, roadmapRes] = await Promise.all([
          fetch('/api/hub/career'),
          fetch('/api/hub/roadmap'),
        ]);
        if (cancelled) return;
        if (!careerRes.ok) { setLoadError(true); setLoading(false); return; }
        const career: CareerSummary = await careerRes.json();
        setSummary(career);
        setExpandedStages(new Set([Math.min(Math.max(career.stage + 1, 1), 5)]));
        if (roadmapRes.ok) {
          const rm = await roadmapRes.json();
          if (!cancelled) setReadProgress(rm.progress || {});
        }
        // Panel data in the background
        fetchShows();
        fetchContacts();
        fetchShareLinks();
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadAll();
    return () => { cancelled = true; };
  }, [fetchShows, fetchContacts, fetchShareLinks]);

  // ── Playbook read toggle (exact wiring from the old roadmap) ──

  const toggleRead = useCallback(async (itemId: string) => {
    const newCompleted = !readProgress[itemId];
    setSavingRead(itemId);
    // Optimistic
    setReadProgress((prev) => {
      const next = { ...prev };
      if (newCompleted) next[itemId] = true;
      else delete next[itemId];
      return next;
    });
    try {
      const res = await fetch('/api/hub/roadmap', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, completed: newCompleted }),
      });
      if (res.ok) {
        const data = await res.json();
        setReadProgress(data.progress);
        if (data.xpEligible) {
          try {
            await fetch('/api/hub/xp', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'complete_roadmap_item', metadata: { itemId } }),
            });
          } catch { /* XP award failure is non-blocking */ }
        }
        // Reads feed the stage's playbook gate server-side — refetch the path.
        await refreshCareer();
      } else {
        setReadProgress((prev) => {
          const next = { ...prev };
          if (newCompleted) delete next[itemId];
          else next[itemId] = true;
          return next;
        });
      }
    } catch {
      setReadProgress((prev) => {
        const next = { ...prev };
        if (newCompleted) delete next[itemId];
        else next[itemId] = true;
        return next;
      });
    } finally {
      setSavingRead(null);
    }
  }, [readProgress, refreshCareer]);

  // ── Confirm-gate submit ──────────────────────────────────

  async function submitConfirm(req: Requirement) {
    if (!req.confirmFields) return;
    setConfirmSaving(true);
    setConfirmError(null);
    try {
      const answers: Record<string, string> = {};
      for (const f of req.confirmFields) answers[f.key] = confirmAnswers[f.key] ?? '';
      const res = await fetch('/api/hub/career/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: req.key, answers }),
      });
      if (res.ok) {
        setConfirmOpen(null);
        setConfirmAnswers({});
        await refreshCareer();
      } else {
        const j = await res.json().catch(() => ({}));
        setConfirmError(j.error || 'Could not save — try again.');
      }
    } catch {
      setConfirmError('Network error — try again.');
    } finally {
      setConfirmSaving(false);
    }
  }

  // ── Shows actions ────────────────────────────────────────

  async function logShow() {
    if (!showForm.venue.trim() || !showForm.show_date) { setShowError('Venue and date required.'); return; }
    setShowSaving(true);
    setShowError(null);
    try {
      const res = await fetch('/api/hub/shows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(showForm),
      });
      if (res.ok) {
        setShowForm({ venue: '', city: '', show_date: '', is_paid: false, is_headline: false });
        setShowFormOpen(false);
        await fetchShows();
        await refreshCareer();
      } else {
        const j = await res.json().catch(() => ({}));
        setShowError(j.error || 'Could not log the show.');
      }
    } catch {
      setShowError('Network error — try again.');
    } finally {
      setShowSaving(false);
    }
  }

  async function confirmShow(id: string) {
    setShowSaving(true);
    setShowError(null);
    try {
      const body: Record<string, unknown> = { id, confirm: true };
      if (showPhotoUrl.trim()) body.photo_url = showPhotoUrl.trim();
      const res = await fetch('/api/hub/shows', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setConfirmingShow(null);
        setShowPhotoUrl('');
        await fetchShows();
        await refreshCareer();
      } else {
        const j = await res.json().catch(() => ({}));
        setShowError(j.error || 'Could not confirm the show.');
      }
    } catch {
      setShowError('Network error — try again.');
    } finally {
      setShowSaving(false);
    }
  }

  // ── Contacts actions ─────────────────────────────────────

  async function addContact() {
    if (!contactForm.name.trim()) { setContactError('Name required.'); return; }
    setContactSaving(true);
    setContactError(null);
    try {
      const res = await fetch('/api/hub/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contactForm),
      });
      if (res.ok) {
        setContactForm({ name: '', handle: '', role: 'artist', met_at: '' });
        setContactFormOpen(false);
        await fetchContacts();
        await refreshCareer();
      } else {
        const j = await res.json().catch(() => ({}));
        setContactError(j.error || 'Could not add the contact.');
      }
    } catch {
      setContactError('Network error — try again.');
    } finally {
      setContactSaving(false);
    }
  }

  async function deleteContact(id: string) {
    try {
      const res = await fetch(`/api/hub/contacts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchContacts();
        await refreshCareer();
      }
    } catch { /* leave list as-is */ }
  }

  // ── Share-link actions ───────────────────────────────────

  async function openLinkForm() {
    setLinkFormOpen(true);
    setLinkError(null);
    if (myFiles === null) {
      try {
        const res = await fetch('/api/hub/my-files');
        if (res.ok) setMyFiles((await res.json()).files || []);
        else setMyFiles([]);
      } catch { setMyFiles([]); }
    }
  }

  async function createShareLink() {
    if (!linkForm.track_label.trim()) { setLinkError('Track label required.'); return; }
    if (!linkForm.deliverable_id) { setLinkError('Pick a track from your files.'); return; }
    setLinkSaving(true);
    setLinkError(null);
    try {
      const body: Record<string, unknown> = {
        track_label: linkForm.track_label.trim(),
        deliverable_id: linkForm.deliverable_id,
      };
      if (linkForm.expires_at) body.expires_at = new Date(`${linkForm.expires_at}T23:59:59`).toISOString();
      const res = await fetch('/api/hub/share-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setLinkForm({ track_label: '', deliverable_id: '', expires_at: '' });
        setLinkFormOpen(false);
        await fetchShareLinks();
        await refreshCareer();
      } else {
        const j = await res.json().catch(() => ({}));
        setLinkError(j.error || 'Could not create the link.');
      }
    } catch {
      setLinkError('Network error — try again.');
    } finally {
      setLinkSaving(false);
    }
  }

  async function revokeLink(id: string) {
    setLinkActionBusy(id);
    try {
      const res = await fetch('/api/hub/share-links', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', id }),
      });
      if (res.ok) await fetchShareLinks();
    } catch { /* leave as-is */ } finally {
      setLinkActionBusy(null);
    }
  }

  async function addFeedbackToContacts(feedbackId: string) {
    setLinkActionBusy(feedbackId);
    try {
      const res = await fetch('/api/hub/share-links', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_contact', feedback_id: feedbackId }),
      });
      if (res.ok) {
        await fetchShareLinks();
        await fetchContacts();
        await refreshCareer();
      }
    } catch { /* leave as-is */ } finally {
      setLinkActionBusy(null);
    }
  }

  function copyListenUrl(link: ShareLink) {
    const url = `${window.location.origin}/listen/${link.token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(link.id);
      setTimeout(() => setCopiedLink((c) => (c === link.id ? null : c)), 1500);
    }).catch(() => { /* clipboard unavailable */ });
  }

  function toggleStage(s: number) {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function togglePlaybookItem(key: string) {
    setExpandedPlaybook((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Render ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="border-2 border-black/10 p-10 flex items-center justify-center gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-black/30" />
        <span className="font-mono text-xs uppercase tracking-wider text-black/40">Loading your career path…</span>
      </div>
    );
  }

  if (loadError || !summary) {
    return (
      <div className="border-2 border-black/10 p-10 text-center">
        <p className="font-mono text-xs text-black/60 mb-4">Couldn&apos;t load your career path.</p>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  const workingStage = Math.min(Math.max(summary.stage + 1, 1), 5);
  const today = todayIso();

  return (
    <div>
      {/* ── Header: current stage + tier badges ── */}
      <div className="mb-8">
        <h2 className="text-heading-md mb-2">CAREER PATH</h2>
        <p className="font-mono text-sm text-black/60 max-w-2xl">
          Five stages of verifiable gates. Your stage is computed, never self-selected &mdash;
          honor items are light XP; verified gates move your stage.
        </p>
      </div>

      <div className="mb-6 border-2 border-black/10 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-black/40 mb-1">Current Stage</div>
            <div className="font-mono text-lg sm:text-xl font-bold uppercase tracking-wider">
              {summary.stageLabel}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {summary.tiers.length > 0 ? (
              summary.tiers.map((t) => <TierBadge key={t.tier} tier={t.tier} size="md" />)
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-wider text-black/40">
                No listener tiers yet &mdash; first stop: 10K Club
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Stage sections ── */}
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((s) => {
          const reqs = summary.requirements.filter((r) => r.stage === s);
          const doneCount = reqs.filter((r) => r.status === 'complete').length;
          const pct = reqs.length > 0 ? Math.round((doneCount / reqs.length) * 100) : 0;
          const isOpen = expandedStages.has(s);
          const isLocked = s > workingStage;
          const isWorking = s === workingStage;
          const sectionId = STAGE_TO_SECTION[s];
          const playbookSection = ROADMAP_SECTIONS.find((sec) => sec.id === sectionId);
          const SectionIcon = playbookSection
            ? ICON_MAP[playbookSection.icon as keyof typeof ICON_MAP] ?? Lightbulb
            : Lightbulb;

          return (
            <div key={s} className={`border-2 ${isWorking ? 'border-accent' : 'border-black/10'}`}>
              {/* Stage header */}
              <button
                onClick={() => toggleStage(s)}
                className={`w-full p-5 sm:p-6 flex items-center gap-4 text-left hover:bg-black/[0.02] transition-colors ${isLocked ? 'opacity-60' : ''}`}
              >
                <div className={`w-10 h-10 flex items-center justify-center flex-shrink-0 ${doneCount === reqs.length && reqs.length > 0 ? 'bg-green-600' : 'bg-accent'}`}>
                  {doneCount === reqs.length && reqs.length > 0 ? (
                    <Check className="w-5 h-5 text-white" strokeWidth={3} />
                  ) : isLocked ? (
                    <Lock className="w-5 h-5 text-black" />
                  ) : (
                    <SectionIcon className="w-5 h-5 text-black" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-mono text-sm font-bold uppercase tracking-wider">
                      Stage {s} &mdash; {STAGE_NAMES[s]}
                    </h3>
                    {isWorking && (
                      <span className="font-mono text-[10px] uppercase tracking-wider bg-accent text-black px-1.5 py-0.5 font-bold">
                        In Progress
                      </span>
                    )}
                    {isLocked && (
                      <span className="font-mono text-[10px] uppercase tracking-wider bg-black/5 text-black/50 px-1.5 py-0.5">
                        Locked &mdash; still browsable
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-black/5 overflow-hidden max-w-[200px]">
                      <div
                        className={`h-full transition-all duration-500 ease-out ${pct === 100 ? 'bg-green-600' : 'bg-accent'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="font-mono text-[10px] text-black/40">{doneCount}/{reqs.length} gates</span>
                  </div>
                </div>
                {isOpen ? (
                  <ChevronDown className="w-5 h-5 text-black/30 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-black/30 flex-shrink-0" />
                )}
              </button>

              {isOpen && (
                <div className="border-t border-black/10">
                  {/* ── Gate rows ── */}
                  {reqs.map((req) => {
                    const complete = req.status === 'complete';
                    const snapshot = (req.evidence?.snapshot ?? null) as Record<string, unknown> | null;
                    const evidenceBits = snapshot
                      ? Object.entries(snapshot).filter(([, v]) => v != null && (typeof v === 'number' || typeof v === 'string'))
                      : [];
                    const hasConfirmForm = req.verifyType === 'confirm' && !complete
                      && Array.isArray(req.confirmFields) && req.confirmFields.length > 0;
                    const formOpen = confirmOpen === req.key;

                    return (
                      <div key={req.key} className={`border-b border-black/5 ${complete ? 'bg-green-50/60' : ''}`}>
                        <div className="px-4 sm:px-6 py-4 flex items-start gap-3">
                          <div
                            className="mt-0.5 w-5 h-5 border-2 flex items-center justify-center flex-shrink-0"
                            style={{
                              borderColor: complete ? '#16a34a' : 'rgba(0,0,0,0.2)',
                              backgroundColor: complete ? '#16a34a' : 'transparent',
                            }}
                          >
                            {complete && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-mono text-sm font-semibold ${complete ? 'text-green-700' : ''}`}>
                                {req.title}
                              </span>
                              <VerifyBadge type={req.verifyType} />
                              <span className="font-mono text-[10px] uppercase tracking-wider border border-black/15 text-black/50 px-1.5 py-0.5 flex-shrink-0">
                                +{req.xp} XP
                              </span>
                            </div>
                            {req.description && (
                              <p className="font-mono text-xs text-black/60 mt-1">{req.description}</p>
                            )}
                            {complete && (
                              <p className="font-mono text-[10px] uppercase tracking-wider text-green-600 mt-1.5">
                                Complete{req.completedAt ? ` · ${fmtDate(req.completedAt)}` : ''}
                                {evidenceBits.length > 0 && (
                                  <span className="text-black/40 normal-case tracking-normal">
                                    {' '}&mdash; {evidenceBits.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'number' ? v.toLocaleString() : v}`).join(', ')}
                                  </span>
                                )}
                              </p>
                            )}
                            {hasConfirmForm && !formOpen && (
                              <button
                                onClick={() => {
                                  setConfirmOpen(req.key);
                                  setConfirmAnswers({});
                                  setConfirmError(null);
                                }}
                                className="mt-2 font-mono text-[10px] font-bold uppercase tracking-wider bg-accent text-black px-3 py-1.5 hover:opacity-90 transition-opacity"
                              >
                                Confirm This
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Confirm inline form */}
                        {hasConfirmForm && formOpen && (
                          <div className="mx-4 sm:mx-6 mb-4 ml-12 border border-black/10 bg-black/[0.02] p-4 space-y-3">
                            <p className="font-mono text-[10px] uppercase tracking-wider text-black/40">
                              Honor system &mdash; light XP. Verified gates are what move your stage.
                            </p>
                            {req.confirmFields!.map((f) => (
                              <div key={f.key}>
                                <label className="block font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">
                                  {f.label}
                                </label>
                                <input
                                  type={f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text'}
                                  value={confirmAnswers[f.key] ?? ''}
                                  onChange={(e) => setConfirmAnswers((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                  className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white"
                                />
                              </div>
                            ))}
                            {confirmError && (
                              <p className="font-mono text-xs text-red-600">{confirmError}</p>
                            )}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => submitConfirm(req)}
                                disabled={confirmSaving}
                                className="inline-flex items-center gap-2 bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-50"
                              >
                                {confirmSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                Confirm
                              </button>
                              <button
                                onClick={() => setConfirmOpen(null)}
                                className="font-mono text-xs uppercase tracking-wider text-black/50 px-3 py-2 hover:text-black transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* ── Stage 2: private listening links panel ── */}
                  {s === 2 && (
                    <div className="border-b border-black/5 px-4 sm:px-6 py-5">
                      <div className="border border-black/10 p-4 sm:p-5">
                        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Link2 className="w-4 h-4 text-accent" />
                            <h4 className="font-mono text-xs font-bold uppercase tracking-wider">Private Listening Links</h4>
                          </div>
                          {!linkFormOpen && (
                            <button
                              onClick={openLinkForm}
                              className="inline-flex items-center gap-1.5 bg-accent text-black font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 hover:opacity-90 transition-opacity"
                            >
                              <Plus className="w-3 h-3" strokeWidth={3} /> New Link
                            </button>
                          )}
                        </div>
                        <p className="font-mono text-xs text-black/60 mb-4">
                          Share an unreleased track privately and collect honest feedback while changes are still free.
                          3 pieces of feedback completes the gate &mdash; automatically.
                        </p>

                        {linkFormOpen && (
                          <div className="border border-black/10 bg-black/[0.02] p-4 mb-4 space-y-3">
                            <div>
                              <label className="block font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">Track label</label>
                              <input
                                type="text"
                                value={linkForm.track_label}
                                onChange={(e) => setLinkForm((p) => ({ ...p, track_label: e.target.value }))}
                                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white"
                                placeholder='e.g. "Midnight (rough mix v2)"'
                              />
                            </div>
                            <div>
                              <label className="block font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">Track file (from your library)</label>
                              {myFiles === null ? (
                                <div className="flex items-center gap-2 font-mono text-xs text-black/40 py-2">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your files…
                                </div>
                              ) : myFiles.length === 0 ? (
                                <p className="font-mono text-xs text-black/50 py-2">
                                  No files in your library yet &mdash; your session deliverables will show up here.
                                </p>
                              ) : (
                                <select
                                  value={linkForm.deliverable_id}
                                  onChange={(e) => setLinkForm((p) => ({ ...p, deliverable_id: e.target.value }))}
                                  className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white"
                                >
                                  <option value="">Select a file…</option>
                                  {myFiles.map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {f.display_name || f.file_name} ({fmtDate(f.created_at)})
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                            <div>
                              <label className="block font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">Expires (optional)</label>
                              <input
                                type="date"
                                value={linkForm.expires_at}
                                onChange={(e) => setLinkForm((p) => ({ ...p, expires_at: e.target.value }))}
                                className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white"
                              />
                            </div>
                            {linkError && <p className="font-mono text-xs text-red-600">{linkError}</p>}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={createShareLink}
                                disabled={linkSaving}
                                className="inline-flex items-center gap-2 bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-50"
                              >
                                {linkSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                Create Link
                              </button>
                              <button
                                onClick={() => { setLinkFormOpen(false); setLinkError(null); }}
                                className="font-mono text-xs uppercase tracking-wider text-black/50 px-3 py-2 hover:text-black transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {shareLinks.length === 0 && !linkFormOpen ? (
                          <p className="font-mono text-[10px] uppercase tracking-wider text-black/40">No links yet</p>
                        ) : (
                          <div className="space-y-2">
                            {shareLinks.map((link) => {
                              const fbOpen = expandedLink === link.id;
                              return (
                                <div key={link.id} className={`border border-black/10 ${link.revoked ? 'opacity-60' : ''}`}>
                                  <div className="p-3 flex items-center gap-3 flex-wrap">
                                    <div className="flex-1 min-w-[140px]">
                                      <div className="font-mono text-sm font-semibold flex items-center gap-2 flex-wrap">
                                        {link.track_label}
                                        {link.revoked && (
                                          <span className="font-mono text-[10px] uppercase tracking-wider bg-red-50 text-red-600 px-1.5 py-0.5">Revoked</span>
                                        )}
                                      </div>
                                      <div className="font-mono text-[10px] text-black/40 mt-0.5">
                                        {link.play_count} play{link.play_count === 1 ? '' : 's'} · {link.feedbackCount} feedback
                                        {link.avgVibe != null && <> · vibe {link.avgVibe}/10</>}
                                        {link.expires_at && <> · expires {fmtDate(link.expires_at)}</>}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      {!link.revoked && (
                                        <button
                                          onClick={() => copyListenUrl(link)}
                                          className="inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider border border-black/20 px-2 py-1 hover:border-accent hover:text-accent transition-colors"
                                          title={`/listen/${link.token}`}
                                        >
                                          {copiedLink === link.id ? <Check className="w-3 h-3" strokeWidth={3} /> : <Copy className="w-3 h-3" />}
                                          {copiedLink === link.id ? 'Copied' : 'Copy Link'}
                                        </button>
                                      )}
                                      {link.feedbackCount > 0 && (
                                        <button
                                          onClick={() => setExpandedLink(fbOpen ? null : link.id)}
                                          className="font-mono text-[10px] uppercase tracking-wider text-black/50 px-2 py-1 hover:text-black transition-colors"
                                        >
                                          {fbOpen ? 'Hide' : 'Feedback'}
                                        </button>
                                      )}
                                      {!link.revoked && (
                                        <button
                                          onClick={() => revokeLink(link.id)}
                                          disabled={linkActionBusy === link.id}
                                          className="font-mono text-[10px] uppercase tracking-wider text-red-600/70 px-2 py-1 hover:text-red-600 transition-colors disabled:opacity-50"
                                        >
                                          Revoke
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  {fbOpen && (
                                    <div className="border-t border-black/5 px-3 py-2 space-y-2">
                                      {link.feedback.map((fb) => (
                                        <div key={fb.id} className="flex items-start gap-3 py-1.5">
                                          <div className="flex-1 min-w-0">
                                            <span className="font-mono text-xs font-semibold">{fb.listener_name}</span>
                                            <span className="font-mono text-[10px] text-black/40"> · vibe {fb.vibe_score}/10 · {fmtDate(fb.created_at)}</span>
                                            {fb.comment && (
                                              <p className="font-mono text-xs text-black/60 mt-0.5">&ldquo;{fb.comment}&rdquo;</p>
                                            )}
                                          </div>
                                          {fb.added_to_contacts ? (
                                            <span className="font-mono text-[10px] uppercase tracking-wider text-green-600 flex-shrink-0">In contacts</span>
                                          ) : (
                                            <button
                                              onClick={() => addFeedbackToContacts(fb.id)}
                                              disabled={linkActionBusy === fb.id}
                                              className="font-mono text-[10px] font-bold uppercase tracking-wider border border-black/20 px-2 py-1 hover:border-accent hover:text-accent transition-colors disabled:opacity-50 flex-shrink-0"
                                            >
                                              Add to contacts
                                            </button>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Stage 3: live shows + contacts panels ── */}
                  {s === 3 && (
                    <>
                      {/* Live Shows — shared card feeding s3_shows / s4_shows / s5_headline */}
                      <div className="border-b border-black/5 px-4 sm:px-6 py-5">
                        <div className="border border-black/10 p-4 sm:p-5">
                          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <Mic className="w-4 h-4 text-accent" />
                              <h4 className="font-mono text-xs font-bold uppercase tracking-wider">Live Shows</h4>
                              <span className="font-mono text-[10px] text-black/40">
                                {shows.filter((sh) => sh.confirmed_at && loggedOnTime(sh)).length} confirmed
                              </span>
                            </div>
                            {!showFormOpen && (
                              <button
                                onClick={() => { setShowFormOpen(true); setShowError(null); }}
                                className="inline-flex items-center gap-1.5 bg-accent text-black font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 hover:opacity-90 transition-opacity"
                              >
                                <Plus className="w-3 h-3" strokeWidth={3} /> Log a Show
                              </button>
                            )}
                          </div>
                          <p className="font-mono text-xs text-black/60 mb-4">
                            Log it BEFORE the show &mdash; the calendar entry is your proof. Confirm after with a photo.
                            This one card feeds every show gate (Stage 3, 4 and the Stage 5 headline).
                          </p>

                          {showFormOpen && (
                            <div className="border border-black/10 bg-black/[0.02] p-4 mb-4 space-y-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="block font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">Venue</label>
                                  <input
                                    type="text"
                                    value={showForm.venue}
                                    onChange={(e) => setShowForm((p) => ({ ...p, venue: e.target.value }))}
                                    className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white"
                                    placeholder="The Vogue"
                                  />
                                </div>
                                <div>
                                  <label className="block font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">City</label>
                                  <input
                                    type="text"
                                    value={showForm.city}
                                    onChange={(e) => setShowForm((p) => ({ ...p, city: e.target.value }))}
                                    className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white"
                                    placeholder="Fort Wayne, IN"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="block font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">Show date</label>
                                <input
                                  type="date"
                                  value={showForm.show_date}
                                  onChange={(e) => setShowForm((p) => ({ ...p, show_date: e.target.value }))}
                                  className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white"
                                />
                                {/* Advice, not a block — a past-dated show still saves, it
                                    just can't count toward the gate (created_at must predate it). */}
                                {showForm.show_date && showForm.show_date <= today && (
                                  <p className="font-mono text-[10px] text-amber-700 mt-1.5 leading-relaxed">
                                    Log shows BEFORE they happen — that&apos;s what verifies them. A past date won&apos;t count toward your stage.
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-5">
                                <label className="flex items-center gap-2 font-mono text-xs cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={showForm.is_paid}
                                    onChange={(e) => setShowForm((p) => ({ ...p, is_paid: e.target.checked }))}
                                    className="accent-black"
                                  />
                                  Paid gig
                                </label>
                                <label className="flex items-center gap-2 font-mono text-xs cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={showForm.is_headline}
                                    onChange={(e) => setShowForm((p) => ({ ...p, is_headline: e.target.checked }))}
                                    className="accent-black"
                                  />
                                  Headline / co-headline
                                </label>
                              </div>
                              {showError && <p className="font-mono text-xs text-red-600">{showError}</p>}
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={logShow}
                                  disabled={showSaving}
                                  className="inline-flex items-center gap-2 bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-50"
                                >
                                  {showSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                  Log Show
                                </button>
                                <button
                                  onClick={() => { setShowFormOpen(false); setShowError(null); }}
                                  className="font-mono text-xs uppercase tracking-wider text-black/50 px-3 py-2 hover:text-black transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {shows.length === 0 && !showFormOpen ? (
                            <p className="font-mono text-[10px] uppercase tracking-wider text-black/40">No shows logged yet</p>
                          ) : (
                            <div className="space-y-2">
                              {shows.map((show) => {
                                const isPast = show.show_date <= today;
                                const confirmable = isPast && !show.confirmed_at;
                                const confirming = confirmingShow === show.id;
                                const lateLog = !loggedOnTime(show);
                                return (
                                  <div key={show.id} className="border border-black/10">
                                    <div className="p-3 flex items-center gap-3 flex-wrap">
                                      <div className="flex-1 min-w-[140px]">
                                        <div className="font-mono text-sm font-semibold flex items-center gap-2 flex-wrap">
                                          {show.venue}
                                          {show.is_paid && (
                                            <span className="font-mono text-[10px] uppercase tracking-wider bg-accent/15 text-accent border border-accent/40 px-1.5 py-0.5">Paid</span>
                                          )}
                                          {show.is_headline && (
                                            <span className="font-mono text-[10px] uppercase tracking-wider bg-accent text-black px-1.5 py-0.5 font-bold">Headline</span>
                                          )}
                                          {lateLog && (
                                            <span
                                              className="font-mono text-[10px] uppercase tracking-wider bg-black/5 text-black/40 px-1.5 py-0.5"
                                              title="Logged after the show date — gates need the calendar entry to predate the show."
                                            >
                                              Logged late — doesn&apos;t count toward gates
                                            </span>
                                          )}
                                        </div>
                                        <div className="font-mono text-[10px] text-black/40 mt-0.5">
                                          {show.city ? `${show.city} · ` : ''}{fmtDate(show.show_date)}
                                        </div>
                                      </div>
                                      {show.confirmed_at ? (
                                        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-green-600">
                                          <Check className="w-3 h-3" strokeWidth={3} /> Confirmed {fmtDate(show.confirmed_at)}
                                        </span>
                                      ) : confirmable ? (
                                        !confirming && (
                                          <button
                                            onClick={() => { setConfirmingShow(show.id); setShowPhotoUrl(''); setShowError(null); }}
                                            className="bg-accent text-black font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 hover:opacity-90 transition-opacity"
                                          >
                                            Confirm It Happened
                                          </button>
                                        )
                                      ) : (
                                        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-black/40">
                                          <Calendar className="w-3 h-3" /> Upcoming
                                        </span>
                                      )}
                                    </div>
                                    {confirming && (
                                      <div className="border-t border-black/5 p-3 space-y-2">
                                        <label className="block font-mono text-[10px] uppercase tracking-wider text-black/50">
                                          Photo URL (optional, encouraged)
                                        </label>
                                        <input
                                          type="url"
                                          value={showPhotoUrl}
                                          onChange={(e) => setShowPhotoUrl(e.target.value)}
                                          className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white"
                                          placeholder="https://…"
                                        />
                                        {showError && <p className="font-mono text-xs text-red-600">{showError}</p>}
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => confirmShow(show.id)}
                                            disabled={showSaving}
                                            className="inline-flex items-center gap-2 bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-50"
                                          >
                                            {showSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                            Confirm Show
                                          </button>
                                          <button
                                            onClick={() => setConfirmingShow(null)}
                                            className="font-mono text-xs uppercase tracking-wider text-black/50 px-3 py-2 hover:text-black transition-colors"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Network contacts — feeds s3_network automatically */}
                      <div className="border-b border-black/5 px-4 sm:px-6 py-5">
                        <div className="border border-black/10 p-4 sm:p-5">
                          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-accent" />
                              <h4 className="font-mono text-xs font-bold uppercase tracking-wider">Network Contacts</h4>
                              <span className="font-mono text-[10px] text-black/40">{Math.min(contacts.length, 3)}/3 toward the gate</span>
                            </div>
                            {!contactFormOpen && (
                              <button
                                onClick={() => { setContactFormOpen(true); setContactError(null); }}
                                className="inline-flex items-center gap-1.5 bg-accent text-black font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 hover:opacity-90 transition-opacity"
                              >
                                <Plus className="w-3 h-3" strokeWidth={3} /> Add Contact
                              </button>
                            )}
                          </div>
                          <p className="font-mono text-xs text-black/60 mb-4">
                            Artists, producers, videographers &mdash; your future team. Log 3 and the gate completes itself.
                          </p>

                          {contactFormOpen && (
                            <div className="border border-black/10 bg-black/[0.02] p-4 mb-4 space-y-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="block font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">Name</label>
                                  <input
                                    type="text"
                                    value={contactForm.name}
                                    onChange={(e) => setContactForm((p) => ({ ...p, name: e.target.value }))}
                                    className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white"
                                  />
                                </div>
                                <div>
                                  <label className="block font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">Handle</label>
                                  <input
                                    type="text"
                                    value={contactForm.handle}
                                    onChange={(e) => setContactForm((p) => ({ ...p, handle: e.target.value }))}
                                    className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white"
                                    placeholder="@instagram"
                                  />
                                </div>
                                <div>
                                  <label className="block font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">Role</label>
                                  <select
                                    value={contactForm.role}
                                    onChange={(e) => setContactForm((p) => ({ ...p, role: e.target.value }))}
                                    className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white"
                                  >
                                    {CONTACT_ROLES.map((r) => (
                                      <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="block font-mono text-[10px] uppercase tracking-wider text-black/50 mb-1">Where you met</label>
                                  <input
                                    type="text"
                                    value={contactForm.met_at}
                                    onChange={(e) => setContactForm((p) => ({ ...p, met_at: e.target.value }))}
                                    className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none bg-white"
                                    placeholder="Open mic at…"
                                  />
                                </div>
                              </div>
                              {contactError && <p className="font-mono text-xs text-red-600">{contactError}</p>}
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={addContact}
                                  disabled={contactSaving}
                                  className="inline-flex items-center gap-2 bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:opacity-90 transition-opacity disabled:opacity-50"
                                >
                                  {contactSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                  Add
                                </button>
                                <button
                                  onClick={() => { setContactFormOpen(false); setContactError(null); }}
                                  className="font-mono text-xs uppercase tracking-wider text-black/50 px-3 py-2 hover:text-black transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {contacts.length === 0 && !contactFormOpen ? (
                            <p className="font-mono text-[10px] uppercase tracking-wider text-black/40">No contacts yet</p>
                          ) : (
                            <div className="space-y-2">
                              {contacts.map((c) => (
                                <div key={c.id} className="border border-black/10 p-3 flex items-center gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="font-mono text-sm font-semibold flex items-center gap-2 flex-wrap">
                                      {c.name}
                                      <span className="font-mono text-[10px] uppercase tracking-wider bg-black/5 text-black/50 px-1.5 py-0.5">{c.role}</span>
                                    </div>
                                    <div className="font-mono text-[10px] text-black/40 mt-0.5">
                                      {[c.handle, c.met_at].filter(Boolean).join(' · ') || fmtDate(c.created_at)}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => deleteContact(c.id)}
                                    className="text-black/30 hover:text-red-600 transition-colors flex-shrink-0"
                                    title="Remove contact"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {/* ── Playbook reader for this stage ── */}
                  {playbookSection && (
                    <div className="px-4 sm:px-6 py-5">
                      <div className="flex items-center gap-2 mb-1">
                        <BookOpen className="w-4 h-4 text-accent" />
                        <h4 className="font-mono text-xs font-bold uppercase tracking-wider">Playbook</h4>
                        <span className="font-mono text-[10px] text-black/40">
                          {playbookSection.content.filter((_, idx) => readProgress[`${playbookSection.id}-${idx}`]).length}/{playbookSection.content.length} read
                        </span>
                      </div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-black/40 mb-3">{playbookSection.subtitle}</p>
                      <div className="space-y-2">
                        {playbookSection.content.map((item, idx) => {
                          const itemId = `${playbookSection.id}-${idx}`;
                          const isRead = readProgress[itemId] === true;
                          const isItemOpen = expandedPlaybook.has(itemId);
                          const isSavingItem = savingRead === itemId;
                          return (
                            <div key={itemId} className={`border border-black/10 ${isRead ? 'bg-green-50/60' : ''}`}>
                              <div className="flex items-center">
                                <button
                                  onClick={() => toggleRead(itemId)}
                                  disabled={isSavingItem}
                                  className="ml-3 flex-shrink-0 w-5 h-5 border-2 flex items-center justify-center transition-all hover:scale-105 disabled:opacity-50"
                                  style={{
                                    borderColor: isRead ? '#16a34a' : 'rgba(0,0,0,0.2)',
                                    backgroundColor: isRead ? '#16a34a' : 'transparent',
                                  }}
                                  title={isRead ? 'Mark as unread' : 'Mark as read'}
                                >
                                  {isSavingItem ? (
                                    <Loader2 className="w-3 h-3 animate-spin text-black/30" />
                                  ) : isRead ? (
                                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
                                  ) : null}
                                </button>
                                <button
                                  onClick={() => togglePlaybookItem(itemId)}
                                  className="flex-1 px-3 py-3 flex items-center gap-2 text-left hover:bg-black/[0.02] transition-colors min-w-0"
                                >
                                  {isItemOpen ? (
                                    <ChevronDown className="w-4 h-4 text-accent flex-shrink-0" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-black/30 flex-shrink-0" />
                                  )}
                                  <span className={`font-mono text-xs font-semibold ${isRead ? 'text-green-700' : ''}`}>
                                    {item.heading}
                                  </span>
                                  {isRead && !isSavingItem && (
                                    <span className="font-mono text-[10px] text-green-600 bg-green-100 px-1.5 py-0.5 uppercase tracking-wider flex-shrink-0">
                                      Read
                                    </span>
                                  )}
                                </button>
                              </div>
                              {isItemOpen && (
                                <div className="px-4 pb-4 pl-11 space-y-3">
                                  {item.body.map((paragraph, pIdx) => (
                                    <p key={pIdx} className="font-mono text-xs text-black/60 leading-relaxed">
                                      {paragraph}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 border-2 border-accent p-6 text-center">
        <p className="font-mono text-xs text-black/60">
          Auto-verified gates complete on their own when the work is real &mdash; sessions, releases,
          tracked stats. Honor items are light XP; verified gates move your stage. Reading ahead is always open.
        </p>
      </div>
    </div>
  );
}
