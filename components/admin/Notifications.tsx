'use client';

import { useState, useEffect, useMemo } from 'react';
import { Send, Clock, Search, X, ChevronDown, Mail, Users, Mic, Music, CheckCircle, PartyPopper, Gift } from 'lucide-react';
import { isEventListed, type SweetEvent } from '@/lib/events';
import { fmtStampDate, fmtStampTime, fmtStampDateTime } from '@/lib/studio-time';

// ── Email Templates ──────────────────────────────────────────────────
interface EmailTemplate {
  key: string;
  name: string;
  subject: string;
  body: string;
  icon: string;
  color: string;
}

// Escape a string for safe embedding inside HTML. Admin-entered event
// titles and descriptions get interpolated into the email body; a stray
// `<` would otherwise break the markup.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Compose subject + HTML body for an event announcement email.
 * Styled to match the existing templates (dark bg, accent gold headline).
 */
function buildEventAnnouncement(event: SweetEvent): { subject: string; body: string } {
  const dateStr = fmtStampDate(event.starts_at, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const timeStr = fmtStampTime(event.starts_at, {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });

  const title = escapeHtml(event.title);
  const tagline = event.tagline ? escapeHtml(event.tagline) : '';
  const location = event.location ? escapeHtml(event.location) : '';
  const description = event.description ? escapeHtml(event.description) : '';

  const subject = `New Event — ${event.title}`;
  const body = [
    '<h1 style="font-size:24px;font-weight:700;color:#F4C430;text-transform:uppercase;margin:0 0 16px">NEW EVENT</h1>',
    `<h2 style="font-size:20px;font-weight:700;color:#fff;margin:0 0 8px">${title}</h2>`,
    tagline
      ? `<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 16px;font-style:italic">${tagline}</p>`
      : '',
    '<table style="margin:20px 0;border-collapse:collapse">',
    `<tr><td style="padding:6px 16px 6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">WHEN</td><td style="padding:6px 0;color:#fff;font-size:14px;font-weight:600">${dateStr} at ${timeStr}</td></tr>`,
    location
      ? `<tr><td style="padding:6px 16px 6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">WHERE</td><td style="padding:6px 0;color:#fff;font-size:14px;font-weight:600">${location}</td></tr>`
      : '',
    '</table>',
    description
      ? `<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 16px;white-space:pre-wrap">${description}</p>`
      : '',
    `<a href="https://sweetdreamsmusic.com/events/${encodeURIComponent(event.slug)}" style="display:inline-block;background:#F4C430;color:#000;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-size:13px;padding:14px 28px;text-decoration:none;margin-top:16px">VIEW EVENT &amp; RSVP</a>`,
    '<br/><br/>',
    '<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">— Sweet Dreams Music</p>',
  ].join('\n');

  return { subject, body };
}

// A faithful sample of the PERSONALIZED rewards-progress email that
// lib/email.ts → sendRewardsProgressEmail() sends after each session (and that
// the "Send rewards update to all customers" blast fires now). Real sends swap
// in each customer's own name, hours, next reward, and progress — this uses
// representative sample data so admins can preview the format. Styling mirrors
// the email's wrap/h1/p/detailTable/btn helpers (dark bg, gold headline).
const REWARDS_EXAMPLE_HTML = [
  '<h1 style="font-size:24px;font-weight:700;color:#F4C430;text-transform:uppercase;margin:0 0 16px">You\'re Getting Close 🔥</h1>',
  '<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">Hey Alex — you\'ve booked <strong style="color:#fff">7 hrs</strong> of studio time this year, and you\'re just <strong style="color:#fff">3 hrs</strong> away from unlocking <strong style="color:#fff">1 free studio hour</strong>.</p>',
  '<table style="margin:20px 0;border-collapse:collapse">',
  '<tr><td style="padding:6px 16px 6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Hours this year</td><td style="padding:6px 0;color:#fff;font-size:14px;font-weight:600">7 hrs</td></tr>',
  '<tr><td style="padding:6px 16px 6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Next reward</td><td style="padding:6px 0;color:#fff;font-size:14px;font-weight:600">1 free studio hour</td></tr>',
  '<tr><td style="padding:6px 16px 6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Hours to go</td><td style="padding:6px 0;color:#fff;font-size:14px;font-weight:600">3 hrs</td></tr>',
  '<tr><td style="padding:6px 16px 6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">Progress</td><td style="padding:6px 0;color:#fff;font-size:14px;font-weight:600">70%</td></tr>',
  '</table>',
  '<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">Book your next session to keep the momentum going — your rewards stack up automatically as you log studio hours.</p>',
  '<a href="https://sweetdreamsmusic.com/dashboard" style="display:inline-block;background:#F4C430;color:#000;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-size:13px;padding:14px 28px;text-decoration:none;margin-top:16px">Book &amp; Track My Perks</a>',
  '<br/><br/>',
  '<p style="font-size:11px;line-height:1.6;color:#666;margin:0">Thanks for being part of Sweet Dreams Music. Questions? Just reply to this email.</p>',
].join('\n');

const TEMPLATES: EmailTemplate[] = [
  {
    key: 'disregard',
    name: 'Disregard',
    subject: 'Please Disregard — Previous Email Sent in Error',
    body: '<h1 style="font-size:24px;font-weight:700;color:#F4C430;text-transform:uppercase;margin:0 0 16px">PLEASE DISREGARD</h1>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">Hey there, we apologize for the confusion!</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">You may have received an email from us recently that was sent in error. <strong>Please disregard it — no action is needed on your part.</strong></p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">We\'re sorry for any inconvenience. If you have any questions, feel free to reach out.</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">— Sweet Dreams Music</p>',
    icon: 'X',
    color: 'bg-red-50 border-red-200 text-red-700',
  },
  {
    key: 'studio_update',
    name: 'Studio Update',
    subject: 'Studio Update — ',
    body: '<h1 style="font-size:24px;font-weight:700;color:#F4C430;text-transform:uppercase;margin:0 0 16px">STUDIO UPDATE</h1>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">Hey there!</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">We wanted to let you know about some exciting changes at Sweet Dreams Music.</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">[Your update here]</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">— Sweet Dreams Music</p>',
    icon: 'Studio',
    color: 'bg-blue-50 border-blue-200 text-blue-700',
  },
  {
    key: 'new_service',
    name: 'New Service',
    subject: 'Now Available — ',
    body: '<h1 style="font-size:24px;font-weight:700;color:#F4C430;text-transform:uppercase;margin:0 0 16px">NOW AVAILABLE</h1>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">We\'re excited to announce a new service at Sweet Dreams Music!</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">[Describe the new service]</p>\n<a href="https://sweetdreamsmusic.com" style="display:inline-block;background:#F4C430;color:#000;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-size:13px;padding:14px 28px;text-decoration:none;margin-top:16px">CHECK IT OUT</a>\n<br/><br/>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">— Sweet Dreams Music</p>',
    icon: 'New',
    color: 'bg-green-50 border-green-200 text-green-700',
  },
  {
    key: 'event_announcement',
    name: 'Announce Event',
    // Subject + body get replaced entirely when an event is picked via
    // buildEventAnnouncement() below. These are the pre-selection placeholders.
    subject: 'New Event — ',
    body: '<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">Pick an event below to auto-fill the subject and body with its details.</p>',
    icon: 'Event',
    color: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  },
  {
    key: 'holiday_hours',
    name: 'Holiday Hours',
    subject: 'Holiday Hours — ',
    body: '<h1 style="font-size:24px;font-weight:700;color:#F4C430;text-transform:uppercase;margin:0 0 16px">HOLIDAY HOURS</h1>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">Just a heads up about our upcoming holiday schedule:</p>\n<table style="margin:20px 0;border-collapse:collapse"><tr><td style="padding:6px 16px 6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">DATES</td><td style="padding:6px 0;color:#fff;font-size:14px;font-weight:600">[dates here]</td></tr><tr><td style="padding:6px 16px 6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">HOURS</td><td style="padding:6px 0;color:#fff;font-size:14px;font-weight:600">[hours here]</td></tr></table>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">Regular hours resume [date]. Book your sessions now before slots fill up!</p>\n<a href="https://sweetdreamsmusic.com/book" style="display:inline-block;background:#F4C430;color:#000;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-size:13px;padding:14px 28px;text-decoration:none;margin-top:16px">BOOK A SESSION</a>\n<br/><br/>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">— Sweet Dreams Music</p>',
    icon: 'Holiday',
    color: 'bg-amber-50 border-amber-200 text-amber-700',
  },
  {
    key: 'promotion',
    name: 'Promotion',
    subject: 'Special Offer — ',
    body: '<h1 style="font-size:24px;font-weight:700;color:#F4C430;text-transform:uppercase;margin:0 0 16px">SPECIAL OFFER</h1>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">We\'ve got something special for you!</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">[Describe the promotion/offer]</p>\n<a href="https://sweetdreamsmusic.com/book" style="display:inline-block;background:#F4C430;color:#000;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-size:13px;padding:14px 28px;text-decoration:none;margin-top:16px">BOOK NOW</a>\n<br/><br/>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">— Sweet Dreams Music</p>',
    icon: 'Promo',
    color: 'bg-purple-50 border-purple-200 text-purple-700',
  },
  {
    key: 'thank_you',
    name: 'Thank You',
    subject: 'Thank You — ',
    body: '<h1 style="font-size:24px;font-weight:700;color:#F4C430;text-transform:uppercase;margin:0 0 16px">THANK YOU</h1>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">We just wanted to take a moment to say thank you.</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">[Your message here]</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">We appreciate your support and look forward to seeing you again!</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">— Sweet Dreams Music</p>',
    icon: 'Thanks',
    color: 'bg-pink-50 border-pink-200 text-pink-700',
  },
  {
    key: 'policy_update',
    name: 'Policy Update',
    subject: 'Important Update — ',
    body: '<h1 style="font-size:24px;font-weight:700;color:#F4C430;text-transform:uppercase;margin:0 0 16px">IMPORTANT UPDATE</h1>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">We\'re writing to let you know about an update to our policies.</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">[Describe the policy change]</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">These changes take effect [date]. If you have any questions, don\'t hesitate to reach out.</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">— Sweet Dreams Music</p>',
    icon: 'Policy',
    color: 'bg-orange-50 border-orange-200 text-orange-700',
  },
  {
    key: 'custom',
    name: 'Custom',
    subject: '',
    body: '<h1 style="font-size:24px;font-weight:700;color:#F4C430;text-transform:uppercase;margin:0 0 16px">[TITLE]</h1>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">[Your message here]</p>\n<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">— Sweet Dreams Music</p>',
    icon: 'Custom',
    color: 'bg-black/5 border-black/20 text-black/70',
  },
];

// ── Types ────────────────────────────────────────────────────────────
interface Recipient {
  email: string;
  name: string;
  role: string;
}

interface Broadcast {
  id: string;
  subject: string;
  body_html: string;
  template_key: string | null;
  recipient_count: number;
  recipient_emails: string[];
  sent_by: string | null;
  created_at: string;
  // Per-recipient delivery roll-up (added with resumable broadcasts).
  sent_count?: number | null;
  failed_count?: number | null;
  send_status?: 'sending' | 'partial' | 'complete' | null;
}

type SubView = 'compose' | 'history';

// ── Component ────────────────────────────────────────────────────────
export default function Notifications() {
  const [subView, setSubView] = useState<SubView>('compose');

  // Compose state
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [manualEmails, setManualEmails] = useState('');
  const [recipientMode, setRecipientMode] = useState<'groups' | 'individual' | 'manual'>('groups');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ broadcastId?: string; sentCount: number; failedCount: number; pending?: number; total: number } | null>(null);
  // Tracks which broadcast id is mid-resume (compose result or a history row).
  const [resumingId, setResumingId] = useState<string | null>(null);

  // Rewards-progress blast state (the "send everyone their own progress" action).
  const [rewardsSending, setRewardsSending] = useState(false);
  const [rewardsResult, setRewardsResult] = useState<{ attempted: number; failed: number; total: number } | null>(null);
  const [rewardsError, setRewardsError] = useState<string | null>(null);
  const [showRewardsPreview, setShowRewardsPreview] = useState(false);

  // Recipients data
  const [allRecipients, setAllRecipients] = useState<Recipient[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingRecipients, setLoadingRecipients] = useState(true);

  // History
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [expandedBroadcast, setExpandedBroadcast] = useState<string | null>(null);

  // Event-announcement picker state — only used when the `event_announcement`
  // template is selected. Loaded lazily on first use so non-announcement
  // admins don't pay the API cost.
  const [upcomingEvents, setUpcomingEvents] = useState<SweetEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Load recipients + history on mount
  useEffect(() => {
    loadRecipients();
    loadHistory();
  }, []);

  async function loadRecipients() {
    setLoadingRecipients(true);
    try {
      const res = await fetch('/api/admin/library/clients');
      const data = await res.json();
      const clients = (data.clients || []).map((c: { email: string; display_name: string; role: string; is_producer: boolean }) => ({
        email: c.email,
        name: c.display_name || c.email,
        role: c.is_producer ? 'producer' : c.role || 'user',
      })).filter((c: Recipient) => c.email);
      setAllRecipients(clients);
    } catch { /* */ }
    setLoadingRecipients(false);
  }

  async function loadHistory() {
    try {
      const res = await fetch('/api/admin/broadcasts');
      const data = await res.json();
      setBroadcasts(data.broadcasts || []);
    } catch { /* */ }
  }

  async function loadUpcomingEvents() {
    setLoadingEvents(true);
    try {
      const res = await fetch('/api/admin/events');
      const data = await res.json();
      const now = Date.now();
      // Only upcoming, non-cancelled, listed events are eligible.
      // private_hidden events are intentionally excluded — the whole point
      // of that visibility is "don't leak this exists", so surfacing it in
      // a broadcast picker would defeat the purpose. For hidden events the
      // admin should use the per-event invites flow (which targets only
      // specific emails), not the general announcement system.
      const upcoming = (data.events || []).filter((e: SweetEvent) =>
        !e.is_cancelled
        && new Date(e.starts_at).getTime() > now
        && isEventListed(e),
      );
      // Sort soonest first.
      upcoming.sort((a: SweetEvent, b: SweetEvent) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      );
      setUpcomingEvents(upcoming);
      setEventsLoaded(true);
    } catch { /* */ }
    setLoadingEvents(false);
  }

  // Filtered recipients for search
  const filteredRecipients = useMemo(() => {
    if (!searchQuery) return allRecipients;
    const q = searchQuery.toLowerCase();
    return allRecipients.filter(r => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
  }, [allRecipients, searchQuery]);

  // Group helpers
  const clientEmails = useMemo(() => allRecipients.filter(r => r.role === 'user').map(r => r.email), [allRecipients]);
  const engineerEmails = useMemo(() => allRecipients.filter(r => r.role === 'engineer').map(r => r.email), [allRecipients]);
  const producerEmails = useMemo(() => allRecipients.filter(r => r.role === 'producer').map(r => r.email), [allRecipients]);
  const allEmails = useMemo(() => allRecipients.map(r => r.email), [allRecipients]);

  function selectTemplate(template: EmailTemplate) {
    setSelectedTemplate(template);
    setSubject(template.subject);
    setBodyHtml(template.body);
    setSendResult(null);
    // Switching templates clears any previously-chosen event so the picker
    // resets to its "nothing selected" state.
    setSelectedEventId(null);
    // Lazy-load the events list the first time the announce template is picked.
    if (template.key === 'event_announcement' && !eventsLoaded) {
      loadUpcomingEvents();
    }
  }

  function selectEventForAnnouncement(event: SweetEvent) {
    setSelectedEventId(event.id);
    const { subject: s, body: b } = buildEventAnnouncement(event);
    setSubject(s);
    setBodyHtml(b);
  }

  function selectGroup(emails: string[]) {
    setSelectedEmails(new Set(emails));
  }

  function toggleEmail(email: string) {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  // Compute final recipient list
  function getFinalRecipients(): string[] {
    if (recipientMode === 'manual') {
      return manualEmails.split(/[,;\n]/).map(e => e.trim()).filter(e => e.includes('@'));
    }
    return [...selectedEmails];
  }

  async function handleSend() {
    const recipients = getFinalRecipients();
    if (recipients.length === 0) { alert('No recipients selected'); return; }
    if (!subject) { alert('Subject is required'); return; }
    if (!bodyHtml) { alert('Email body is required'); return; }

    if (!confirm(`Send this email to ${recipients.length} recipient${recipients.length > 1 ? 's' : ''}?`)) return;

    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch('/api/admin/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          bodyHtml,
          templateKey: selectedTemplate?.key || 'custom',
          recipientEmails: recipients,
        }),
      });
      const data = await res.json();
      setSendResult(data);
      loadHistory();
    } catch {
      alert('Failed to send');
    }
    setSending(false);
  }

  // Resume a partial broadcast: POST the resume route, which re-sends ONLY to
  // recipients still pending/failed (never re-sends anyone already 'sent', so
  // no duplicates), then refresh both the compose result and history list.
  async function handleResume(broadcastId: string) {
    setResumingId(broadcastId);
    try {
      const res = await fetch(`/api/admin/broadcasts/${broadcastId}/resume`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && sendResult && sendResult.broadcastId === broadcastId) {
        setSendResult({ ...sendResult, ...data });
      }
      await loadHistory();
    } catch {
      alert('Failed to resume send');
    }
    setResumingId(null);
  }

  // One-time blast: send EVERY eligible customer their OWN personalized rewards
  // progress (current hours + next reward). This emails real customers, so it's
  // gated behind a confirm(). The route self-skips ineligible users, so the
  // returned `attempted` is the set we tried (the eligible customer list).
  async function handleSendRewardsToAll() {
    if (!confirm(
      'Send every eligible customer their own rewards-progress update right now? '
      + 'Each customer gets a personalized email + in-app message with their current '
      + 'studio hours and next reward. This is a one-time blast.',
    )) return;
    setRewardsSending(true);
    setRewardsResult(null);
    setRewardsError(null);
    try {
      const res = await fetch('/api/admin/rewards/notify-all', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setRewardsResult({ attempted: data.attempted, failed: data.failed, total: data.total });
      } else {
        setRewardsError(data.error || 'Failed to send rewards updates');
      }
    } catch {
      setRewardsError('Failed to send rewards updates');
    }
    setRewardsSending(false);
  }

  function resetCompose() {
    setSelectedTemplate(null);
    setSubject('');
    setBodyHtml('');
    setSelectedEmails(new Set());
    setManualEmails('');
    setSendResult(null);
    setSelectedEventId(null);
  }

  // For event_announcement we additionally require an event to be picked
  // before revealing Step 2 (body editor), Step 3 (recipients), Step 4 (send);
  // otherwise the admin could send the placeholder "Pick an event below" body.
  const isTemplateReady = !!selectedTemplate &&
    (selectedTemplate.key !== 'event_announcement' || !!selectedEventId);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div>
      {/* Sub-navigation */}
      <div className="flex gap-1 mb-6">
        {([
          { key: 'compose' as SubView, label: 'Compose', icon: Send },
          { key: 'history' as SubView, label: 'History', icon: Clock },
        ]).map(v => (
          <button
            key={v.key}
            onClick={() => setSubView(v.key)}
            className={`font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 transition-colors inline-flex items-center gap-1.5 ${
              subView === v.key ? 'bg-black text-white' : 'bg-black/5 text-black/70 hover:bg-black/10'
            }`}
          >
            <v.icon className="w-3 h-3" />
            {v.label}
          </button>
        ))}
      </div>

      {/* ════════════ COMPOSE ════════════ */}
      {subView === 'compose' && (
        <div className="space-y-6">
          {/* Send result */}
          {sendResult && (() => {
            const unsent = (sendResult.failedCount || 0) + (sendResult.pending || 0);
            const allSent = unsent === 0;
            return (
              <div className={`border-2 p-4 ${allSent ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
                <div className="flex items-center gap-2">
                  <CheckCircle className={`w-5 h-5 ${allSent ? 'text-green-600' : 'text-amber-600'}`} />
                  <p className="font-mono text-sm font-bold">
                    {sendResult.sentCount} of {sendResult.total} email{sendResult.total > 1 ? 's' : ''} sent successfully
                    {sendResult.failedCount > 0 && ` · ${sendResult.failedCount} failed`}
                    {sendResult.pending ? ` · ${sendResult.pending} pending` : ''}
                  </p>
                </div>
                {!allSent && (
                  <p className="font-mono text-[11px] text-amber-700 mt-1">
                    The send stopped before reaching everyone (likely a Resend rate-limit/quota). Resume to deliver to the rest — no one already sent will get a duplicate.
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2">
                  {!allSent && sendResult.broadcastId && (
                    <button
                      onClick={() => handleResume(sendResult.broadcastId!)}
                      disabled={resumingId === sendResult.broadcastId}
                      className="bg-amber-500 text-black font-mono text-xs font-bold uppercase tracking-wider px-3 py-1.5 hover:bg-amber-600 disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      <Send className="w-3 h-3" />
                      {resumingId === sendResult.broadcastId ? 'Resending…' : `Resend to unsent (${unsent})`}
                    </button>
                  )}
                  <button onClick={resetCompose} className="font-mono text-xs text-accent hover:underline">
                    Compose another
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ── Rewards-progress blast ── */}
          <div className="border-2 border-accent/40 bg-accent/5 p-4">
            <div className="flex items-start gap-3">
              <Gift className="w-5 h-5 text-accent shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black/80">
                  Send rewards update to all customers
                </h3>
                <p className="font-mono text-[11px] text-black/60 mt-1 leading-relaxed">
                  Sends each customer their OWN personalized progress — current studio hours this
                  year and how far they are from their next reward — by email and in-app message.
                  Going forward this auto-sends after each session; use this for a one-time catch-up blast.
                </p>

                {rewardsResult && (
                  <div className="mt-3 flex items-center gap-2 border border-green-300 bg-green-50 px-3 py-2">
                    <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                    <p className="font-mono text-xs font-bold text-black/80">
                      Sent rewards updates to {rewardsResult.attempted} customer{rewardsResult.attempted === 1 ? '' : 's'}
                      {rewardsResult.failed > 0 && ` · ${rewardsResult.failed} failed`}
                    </p>
                  </div>
                )}
                {rewardsError && (
                  <p className="font-mono text-xs text-red-600 font-bold mt-3">{rewardsError}</p>
                )}

                <button
                  onClick={handleSendRewardsToAll}
                  disabled={rewardsSending}
                  className="mt-3 bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-accent/90 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <Gift className="w-3.5 h-3.5" />
                  {rewardsSending ? 'Sending…' : 'Send rewards update to all customers'}
                </button>

                {/* Example email — what each customer receives (their own
                    numbers are substituted at send time). Rendered in a
                    sandboxed iframe (scripts disabled) so the email's own inline
                    styles stay isolated, just like a real mail client. */}
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowRewardsPreview((v) => !v)}
                    className="font-mono text-[11px] font-bold uppercase tracking-wider text-black/50 hover:text-black underline underline-offset-2"
                  >
                    {showRewardsPreview ? 'Hide email preview' : 'Preview the email'}
                  </button>
                  {showRewardsPreview && (
                    <div className="mt-2">
                      <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">
                        Example — each customer sees their own name, hours &amp; next reward
                      </p>
                      <iframe
                        title="Rewards progress email preview"
                        sandbox=""
                        className="w-full h-80 border border-black/10 bg-black"
                        srcDoc={`<div style="background:#000;padding:24px;font-family:'IBM Plex Mono',monospace">${REWARDS_EXAMPLE_HTML}</div>`}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Step 1: Pick template */}
          <div>
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black/60 mb-3">1. Choose a Template</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TEMPLATES.map(t => (
                <button
                  key={t.key}
                  onClick={() => selectTemplate(t)}
                  className={`border-2 p-3 text-left transition-all ${
                    selectedTemplate?.key === t.key
                      ? 'border-accent bg-accent/10'
                      : `${t.color} hover:border-black/30`
                  }`}
                >
                  <p className="font-mono text-xs font-bold uppercase tracking-wider">{t.name}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Step 1.5: Pick an event (event-announcement template only) */}
          {selectedTemplate?.key === 'event_announcement' && (
            <div>
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black/60 mb-3">
                Pick an Event
              </h3>
              {loadingEvents ? (
                <p className="font-mono text-xs text-black/60">Loading upcoming events…</p>
              ) : upcomingEvents.length === 0 ? (
                <div className="border-2 border-dashed border-black/15 p-6 text-center">
                  <PartyPopper className="w-6 h-6 text-black/30 mx-auto mb-2" />
                  <p className="font-mono text-xs text-black/60">
                    No upcoming events. Create one in the Events tab first.
                  </p>
                </div>
              ) : (
                <div className="grid gap-2">
                  {upcomingEvents.map((ev) => {
                    const isSelected = selectedEventId === ev.id;
                    return (
                      <button
                        key={ev.id}
                        onClick={() => selectEventForAnnouncement(ev)}
                        className={`border-2 p-3 text-left transition-all flex items-start gap-3 ${
                          isSelected
                            ? 'border-accent bg-accent/10'
                            : 'border-black/10 hover:border-black/30'
                        }`}
                      >
                        <PartyPopper className={`w-4 h-4 shrink-0 mt-0.5 ${isSelected ? 'text-accent' : 'text-black/40'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-sm font-bold truncate">{ev.title}</p>
                          <p className="font-mono text-[10px] text-black/60 mt-0.5">
                            {fmtStampDate(ev.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })}
                            {' · '}{fmtStampTime(ev.starts_at, { hour: 'numeric', minute: '2-digit' })}
                            {ev.location && ` · ${ev.location}`}
                          </p>
                        </div>
                        <span className={`font-mono text-[9px] font-bold uppercase px-1.5 py-0.5 ${
                          ev.visibility === 'public' ? 'bg-green-100 text-green-700' :
                          ev.visibility === 'private_listed' ? 'bg-amber-100 text-amber-700' :
                          'bg-black/10 text-black/60'
                        }`}>
                          {ev.visibility.replace('_', ' ')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedEventId && (
                <p className="font-mono text-[10px] text-accent font-bold mt-2">
                  ✓ Subject and body filled from event details — edit below if needed.
                </p>
              )}
            </div>
          )}

          {/* Step 2: Subject + Body */}
          {isTemplateReady && (
            <div className="space-y-3">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black/60">2. Customize Email</h3>
              <div>
                <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full border-2 border-black px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                  placeholder="Email subject..."
                />
              </div>
              <div>
                <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1">
                  Body (HTML — edit text between tags, keep styling)
                </label>
                <textarea
                  value={bodyHtml}
                  onChange={(e) => setBodyHtml(e.target.value)}
                  rows={10}
                  className="w-full border-2 border-black px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none resize-y"
                />
              </div>
              {/* Preview */}
              <div>
                <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Preview</p>
                <div className="border border-black/10 bg-black p-6 overflow-auto max-h-80">
                  <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Recipients */}
          {isTemplateReady && subject && (
            <div className="space-y-3">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black/60">3. Select Recipients</h3>

              {/* Mode tabs */}
              <div className="flex gap-1">
                {([
                  { key: 'groups' as const, label: 'Quick Groups' },
                  { key: 'individual' as const, label: 'Individual' },
                  { key: 'manual' as const, label: 'Manual Entry' },
                ]).map(m => (
                  <button
                    key={m.key}
                    onClick={() => setRecipientMode(m.key)}
                    className={`font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 ${
                      recipientMode === m.key ? 'bg-accent text-black' : 'bg-black/5 text-black/70 hover:bg-black/10'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Groups */}
              {recipientMode === 'groups' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button onClick={() => selectGroup(allEmails)} className="border-2 border-black/10 p-3 hover:border-accent text-left">
                    <Users className="w-4 h-4 text-black/40 mb-1" />
                    <p className="font-mono text-xs font-bold">Everyone</p>
                    <p className="font-mono text-[10px] text-black/60">{allEmails.length} people</p>
                  </button>
                  <button onClick={() => selectGroup(clientEmails)} className="border-2 border-black/10 p-3 hover:border-accent text-left">
                    <Users className="w-4 h-4 text-black/40 mb-1" />
                    <p className="font-mono text-xs font-bold">All Clients</p>
                    <p className="font-mono text-[10px] text-black/60">{clientEmails.length} people</p>
                  </button>
                  <button onClick={() => selectGroup(engineerEmails)} className="border-2 border-black/10 p-3 hover:border-accent text-left">
                    <Mic className="w-4 h-4 text-black/40 mb-1" />
                    <p className="font-mono text-xs font-bold">Engineers</p>
                    <p className="font-mono text-[10px] text-black/60">{engineerEmails.length} people</p>
                  </button>
                  <button onClick={() => selectGroup(producerEmails)} className="border-2 border-black/10 p-3 hover:border-accent text-left">
                    <Music className="w-4 h-4 text-black/40 mb-1" />
                    <p className="font-mono text-xs font-bold">Producers</p>
                    <p className="font-mono text-[10px] text-black/60">{producerEmails.length} people</p>
                  </button>
                </div>
              )}

              {/* Individual selection */}
              {recipientMode === 'individual' && (
                <div>
                  <div className="relative mb-2">
                    <Search className="w-4 h-4 text-black/30 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by name or email..."
                      className="w-full border border-black/20 pl-9 pr-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div className="border border-black/10 max-h-60 overflow-y-auto">
                    {loadingRecipients ? (
                      <p className="font-mono text-xs text-black/60 p-3">Loading...</p>
                    ) : filteredRecipients.length === 0 ? (
                      <p className="font-mono text-xs text-black/60 p-3">No matching users</p>
                    ) : (
                      filteredRecipients.map(r => (
                        <label key={r.email} className="flex items-center gap-3 px-3 py-2 hover:bg-black/[0.02] cursor-pointer border-b border-black/5 last:border-0">
                          <input
                            type="checkbox"
                            checked={selectedEmails.has(r.email)}
                            onChange={() => toggleEmail(r.email)}
                            className="accent-amber-500"
                          />
                          <div className="flex-1 min-w-0">
                            <span className="font-mono text-xs font-bold">{r.name}</span>
                            <span className="font-mono text-[10px] text-black/60 ml-2">{r.email}</span>
                          </div>
                          <span className={`font-mono text-[9px] font-bold uppercase px-1.5 py-0.5 ${
                            r.role === 'engineer' ? 'bg-blue-100 text-blue-700' :
                            r.role === 'producer' ? 'bg-purple-100 text-purple-700' :
                            r.role === 'admin' ? 'bg-red-100 text-red-700' :
                            'bg-black/5 text-black/60'
                          }`}>
                            {r.role}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Manual entry */}
              {recipientMode === 'manual' && (
                <textarea
                  value={manualEmails}
                  onChange={(e) => setManualEmails(e.target.value)}
                  rows={4}
                  placeholder="Enter email addresses separated by commas or new lines..."
                  className="w-full border-2 border-black px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none resize-y"
                />
              )}

              {/* Selected count */}
              {recipientMode !== 'manual' && selectedEmails.size > 0 && (
                <div className="flex items-center gap-2">
                  <p className="font-mono text-xs text-accent font-bold">{selectedEmails.size} recipient{selectedEmails.size > 1 ? 's' : ''} selected</p>
                  <button onClick={() => setSelectedEmails(new Set())} className="font-mono text-[10px] text-black/60 hover:text-black">
                    <X className="w-3 h-3 inline" /> Clear
                  </button>
                </div>
              )}
              {recipientMode === 'manual' && manualEmails.trim() && (
                <p className="font-mono text-xs text-accent font-bold">
                  {manualEmails.split(/[,;\n]/).filter(e => e.trim().includes('@')).length} recipient(s)
                </p>
              )}
            </div>
          )}

          {/* Step 4: Send */}
          {isTemplateReady && subject && getFinalRecipients().length > 0 && !sendResult && (
            <button
              onClick={handleSend}
              disabled={sending}
              className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-6 py-3 hover:bg-accent/90 disabled:opacity-50 inline-flex items-center gap-2"
            >
              <Mail className="w-4 h-4" />
              {sending ? 'Sending...' : `Send to ${getFinalRecipients().length} Recipient${getFinalRecipients().length > 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      )}

      {/* ════════════ HISTORY ════════════ */}
      {subView === 'history' && (
        <div className="space-y-3">
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black/60 mb-3">Broadcast History</h3>
          {broadcasts.length === 0 ? (
            <p className="font-mono text-sm text-black/60 py-8 text-center">No broadcasts sent yet</p>
          ) : (
            broadcasts.map(b => {
              const unsent = (b.failed_count || 0) + Math.max(0, b.recipient_count - (b.sent_count || 0) - (b.failed_count || 0));
              const hasUnsent = (b.send_status === 'partial' || b.send_status === 'sending') && unsent > 0;
              return (
              <div key={b.id} className="border border-black/10">
                <button
                  onClick={() => setExpandedBroadcast(expandedBroadcast === b.id ? null : b.id)}
                  className="w-full p-4 text-left flex items-center gap-4 hover:bg-black/[0.02]"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-bold truncate">{b.subject}</p>
                    <p className="font-mono text-[10px] text-black/60">
                      {fmtStampDateTime(b.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                      {' · '}{b.recipient_count} recipient{b.recipient_count !== 1 ? 's' : ''}
                      {b.sent_by && ` · by ${b.sent_by}`}
                      {b.template_key && ` · ${b.template_key}`}
                    </p>
                  </div>
                  {hasUnsent && (
                    <span className="font-mono text-[9px] font-bold uppercase px-1.5 py-0.5 bg-amber-100 text-amber-700 shrink-0">
                      {unsent} unsent
                    </span>
                  )}
                  <ChevronDown className={`w-4 h-4 text-black/30 transition-transform ${expandedBroadcast === b.id ? 'rotate-180' : ''}`} />
                </button>
                {expandedBroadcast === b.id && (
                  <div className="border-t border-black/10 p-4 space-y-3">
                    {/* Delivery status + resume control */}
                    <div>
                      <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Delivery</p>
                      <p className="font-mono text-xs text-black/70">
                        {(b.sent_count ?? b.recipient_count)} sent
                        {(b.failed_count ?? 0) > 0 && ` · ${b.failed_count} failed`}
                        {unsent > 0 && b.send_status !== 'complete' && ` · ${unsent} unsent`}
                        {' · '}{b.send_status || 'complete'}
                      </p>
                      {hasUnsent && (
                        <button
                          onClick={() => handleResume(b.id)}
                          disabled={resumingId === b.id}
                          className="mt-2 bg-amber-500 text-black font-mono text-xs font-bold uppercase tracking-wider px-3 py-1.5 hover:bg-amber-600 disabled:opacity-50 inline-flex items-center gap-1.5"
                        >
                          <Send className="w-3 h-3" />
                          {resumingId === b.id ? 'Resending…' : `Resend to unsent (${unsent})`}
                        </button>
                      )}
                    </div>
                    <div>
                      <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Recipients</p>
                      <p className="font-mono text-xs text-black/70">{b.recipient_emails.join(', ')}</p>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Email Preview</p>
                      <div className="border border-black/10 bg-black p-4 overflow-auto max-h-60">
                        <div dangerouslySetInnerHTML={{ __html: b.body_html }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
