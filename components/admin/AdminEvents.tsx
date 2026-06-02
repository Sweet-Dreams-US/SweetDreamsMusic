'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { fmtStampDateTime } from '@/lib/studio-time';
import {
  Calendar, Plus, Edit2, Trash2, XCircle, Eye, EyeOff, Users, Send,
  CheckCircle, ArrowLeft, Mail, MapPin, Clock, AlertCircle, Upload, Image as ImageIcon,
  User as UserIcon, ExternalLink,
} from 'lucide-react';
import {
  visibilityLabel,
  rsvpStatusLabel,
  type SweetEvent,
  type EventRsvp,
  type EventVisibility,
  type EventRsvpStatus,
} from '@/lib/events';

// ─── Types ─────────────────────────────────────────────────────────────
type SubView = 'list' | 'form' | 'detail';

type InviteResult = { email: string; status: 'sent' | 'skipped' | 'failed'; reason?: string };

// Default form state — also used when cancelling back to list.
function emptyForm(): Partial<SweetEvent> {
  return {
    title: '',
    tagline: '',
    description: '',
    cover_image_url: '',
    starts_at: '',
    ends_at: '',
    location: '',
    visibility: 'public',
    capacity: null,
  };
}

// ─── Component ─────────────────────────────────────────────────────────
export default function AdminEvents() {
  const [subView, setSubView] = useState<SubView>('list');
  const [events, setEvents] = useState<SweetEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state (create/edit)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<SweetEvent>>(emptyForm());
  const [saving, setSaving] = useState(false);

  // Detail state
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<SweetEvent | null>(null);
  const [rsvps, setRsvps] = useState<EventRsvp[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Invite form
  const [inviteEmails, setInviteEmails] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [sendingInvites, setSendingInvites] = useState(false);
  const [inviteResults, setInviteResults] = useState<InviteResult[] | null>(null);

  // ── Data fetching ──
  useEffect(() => { void fetchEvents(); }, []);

  async function fetchEvents() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/events');
      const data = await res.json();
      setEvents(data.events || []);
    } catch { /* */ }
    setLoading(false);
  }

  async function fetchDetail(id: string) {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/events/${id}`);
      const data = await res.json();
      setSelectedEvent(data.event);
      setRsvps(data.rsvps || []);
    } catch { /* */ }
    setDetailLoading(false);
  }

  // ── List → form / detail navigation ──
  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setSubView('form');
  }

  function openEdit(event: SweetEvent) {
    setEditingId(event.id);
    setForm({
      title: event.title,
      tagline: event.tagline || '',
      description: event.description || '',
      cover_image_url: event.cover_image_url || '',
      starts_at: event.starts_at.slice(0, 16), // ISO → datetime-local
      ends_at: event.ends_at ? event.ends_at.slice(0, 16) : '',
      location: event.location || '',
      visibility: event.visibility,
      capacity: event.capacity,
    });
    setSubView('form');
  }

  function openDetail(event: SweetEvent) {
    setSelectedEventId(event.id);
    setSelectedEvent(event);
    setRsvps([]);
    setInviteEmails('');
    setInviteMessage('');
    setInviteResults(null);
    setSubView('detail');
    void fetchDetail(event.id);
  }

  function backToList() {
    setSubView('list');
    setSelectedEventId(null);
    setSelectedEvent(null);
    setEditingId(null);
  }

  // ── Save (create or update) ──
  async function saveEvent() {
    if (!form.title || !form.starts_at) {
      alert('Title and start time are required');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        title: form.title,
        tagline: form.tagline || null,
        description: form.description || null,
        cover_image_url: form.cover_image_url || null,
        starts_at: new Date(form.starts_at as string).toISOString(),
        ends_at: form.ends_at ? new Date(form.ends_at as string).toISOString() : null,
        location: form.location || null,
        visibility: form.visibility,
        capacity: form.capacity === null || form.capacity === undefined ? null : Number(form.capacity),
      };

      const res = await fetch(
        editingId ? `/api/admin/events/${editingId}` : '/api/admin/events',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to save event');
      } else {
        await fetchEvents();
        backToList();
      }
    } catch {
      alert('Network error');
    }
    setSaving(false);
  }

  // ── Cancel event ──
  async function cancelEvent(event: SweetEvent) {
    const reason = prompt(`Cancel "${event.title}"? Give a brief reason (shown to attendees):`);
    if (reason === null) return;
    const res = await fetch(`/api/admin/events/${event.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_cancelled: true, cancellation_reason: reason || null }),
    });
    if (res.ok) {
      await fetchEvents();
      if (selectedEventId === event.id) await fetchDetail(event.id);
    } else {
      alert('Failed to cancel event');
    }
  }

  async function uncancelEvent(event: SweetEvent) {
    if (!confirm(`Un-cancel "${event.title}"? The event will be listed again.`)) return;
    const res = await fetch(`/api/admin/events/${event.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_cancelled: false, cancellation_reason: null }),
    });
    if (res.ok) {
      await fetchEvents();
      if (selectedEventId === event.id) await fetchDetail(event.id);
    }
  }

  // ── Delete event (hard) ──
  async function deleteEvent(event: SweetEvent) {
    if (!confirm(`PERMANENTLY delete "${event.title}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/events/${event.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409 && confirm(`${data.error} Force delete anyway?`)) {
        const forced = await fetch(`/api/admin/events/${event.id}?force=true`, { method: 'DELETE' });
        if (forced.ok) {
          await fetchEvents();
          backToList();
        }
      } else {
        alert(data.error || 'Failed to delete');
      }
    } else {
      await fetchEvents();
      backToList();
    }
  }

  // ── Send invites ──
  async function sendInvites() {
    if (!selectedEventId) return;
    const emails = inviteEmails
      .split(/[,;\n]/)
      .map((e) => e.trim())
      .filter((e) => e.includes('@'));
    if (emails.length === 0) {
      alert('Enter at least one valid email');
      return;
    }
    setSendingInvites(true);
    setInviteResults(null);
    try {
      const res = await fetch(`/api/admin/events/${selectedEventId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails, message: inviteMessage }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteResults(data.results || []);
        setInviteEmails('');
        setInviteMessage('');
        await fetchDetail(selectedEventId);
      } else {
        alert(data.error || 'Failed to send invites');
      }
    } catch {
      alert('Network error');
    }
    setSendingInvites(false);
  }

  // ── Approve/deny a request ──
  async function decideRequest(rsvp: EventRsvp, decision: 'going' | 'not_going') {
    if (!selectedEventId) return;
    let declineReason: string | null = null;
    if (decision === 'not_going') {
      declineReason = prompt('Optional note to send with the decline email (leave blank to skip):') || null;
    }
    const res = await fetch(`/api/admin/events/${selectedEventId}/rsvps/${rsvp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: decision,
        declineReason: declineReason || undefined,
      }),
    });
    if (res.ok) await fetchDetail(selectedEventId);
    else alert('Failed to update RSVP');
  }

  async function deleteRsvp(rsvp: EventRsvp) {
    if (!selectedEventId) return;
    if (!confirm('Remove this RSVP/invitation entirely? No email will be sent.')) return;
    const res = await fetch(`/api/admin/events/${selectedEventId}/rsvps/${rsvp.id}`, {
      method: 'DELETE',
    });
    if (res.ok) await fetchDetail(selectedEventId);
  }

  // ── Derived ──
  const rsvpsByStatus = useMemo(() => {
    const buckets: Record<EventRsvpStatus, EventRsvp[]> = {
      requested: [], invited: [], going: [], maybe: [], not_going: [],
    };
    for (const r of rsvps) buckets[r.status].push(r);
    return buckets;
  }, [rsvps]);

  const now = new Date();
  const upcomingEvents = events.filter((e) => new Date(e.starts_at) >= now);
  const pastEvents = events.filter((e) => new Date(e.starts_at) < now);

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div>
      {subView === 'list' && (
        <ListView
          loading={loading}
          upcomingEvents={upcomingEvents}
          pastEvents={pastEvents}
          onCreate={openCreate}
          onEdit={openEdit}
          onCancel={cancelEvent}
          onUncancel={uncancelEvent}
          onDelete={deleteEvent}
          onOpen={openDetail}
        />
      )}

      {subView === 'form' && (
        <FormView
          form={form}
          setForm={setForm}
          editingId={editingId}
          saving={saving}
          onSave={saveEvent}
          onCancel={backToList}
        />
      )}

      {subView === 'detail' && selectedEvent && (
        <DetailView
          event={selectedEvent}
          rsvps={rsvps}
          rsvpsByStatus={rsvpsByStatus}
          loading={detailLoading}
          inviteEmails={inviteEmails}
          inviteMessage={inviteMessage}
          sendingInvites={sendingInvites}
          inviteResults={inviteResults}
          onBack={backToList}
          onEdit={() => openEdit(selectedEvent)}
          onCancel={() => cancelEvent(selectedEvent)}
          onUncancel={() => uncancelEvent(selectedEvent)}
          onDelete={() => deleteEvent(selectedEvent)}
          setInviteEmails={setInviteEmails}
          setInviteMessage={setInviteMessage}
          onSendInvites={sendInvites}
          onDecideRequest={decideRequest}
          onDeleteRsvp={deleteRsvp}
        />
      )}
    </div>
  );
}

// ─── Sub-components (inline for simplicity) ───────────────────────────

type EventAction = (e: SweetEvent) => void;

function ListView(props: {
  loading: boolean;
  upcomingEvents: SweetEvent[];
  pastEvents: SweetEvent[];
  onCreate: () => void;
  onEdit: EventAction;
  onCancel: EventAction;
  onUncancel: EventAction;
  onDelete: EventAction;
  onOpen: EventAction;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-sm font-bold uppercase tracking-wider mb-1">Events</h2>
          <p className="font-mono text-xs text-black/60">
            Create, edit, and manage showcases, Sweet Spot sessions, cook-up nights, and private events.
          </p>
        </div>
        <button
          onClick={props.onCreate}
          className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2.5 hover:bg-accent/90 inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New Event
        </button>
      </div>

      {props.loading ? (
        <p className="font-mono text-sm text-black/60 py-8 text-center">Loading events…</p>
      ) : (
        <>
          <EventTable
            title="Upcoming"
            events={props.upcomingEvents}
            emptyLabel="No upcoming events. Click New Event to create one."
            onEdit={props.onEdit}
            onCancel={props.onCancel}
            onUncancel={props.onUncancel}
            onDelete={props.onDelete}
            onOpen={props.onOpen}
          />
          {props.pastEvents.length > 0 && (
            <EventTable
              title="Past"
              events={props.pastEvents}
              emptyLabel=""
              onEdit={props.onEdit}
              onCancel={props.onCancel}
              onUncancel={props.onUncancel}
              onDelete={props.onDelete}
              onOpen={props.onOpen}
              isPast
            />
          )}
        </>
      )}
    </div>
  );
}

function EventTable(props: {
  title: string;
  events: SweetEvent[];
  emptyLabel: string;
  onEdit: EventAction;
  onCancel: EventAction;
  onUncancel: EventAction;
  onDelete: EventAction;
  onOpen: EventAction;
  isPast?: boolean;
}) {
  if (props.events.length === 0) {
    return props.emptyLabel ? (
      <div>
        <h3 className="font-mono text-[10px] font-bold uppercase tracking-wider text-black/50 mb-2">{props.title}</h3>
        <p className="font-mono text-xs text-black/50 py-6 text-center border border-black/10 border-dashed">{props.emptyLabel}</p>
      </div>
    ) : null;
  }
  return (
    <div>
      <h3 className="font-mono text-[10px] font-bold uppercase tracking-wider text-black/50 mb-2">{props.title}</h3>
      <div className="border border-black/10 divide-y divide-black/10">
        {props.events.map((event) => (
          <div key={event.id} className={`flex items-center gap-4 p-4 hover:bg-black/[0.02] ${props.isPast ? 'opacity-70' : ''}`}>
            <button onClick={() => props.onOpen(event)} className="flex-1 text-left min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <p className="font-mono text-sm font-bold truncate">{event.title}</p>
                <VisibilityPill visibility={event.visibility} />
                {event.is_cancelled && (
                  <span className="font-mono text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-red-100 text-red-700">
                    Cancelled
                  </span>
                )}
              </div>
              <p className="font-mono text-[11px] text-black/60">
                {fmtStampDateTime(event.starts_at, { year: 'numeric', minute: '2-digit' })}
                {event.location ? ` · ${event.location}` : ''}
              </p>
            </button>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <IconButton label="View" onClick={() => props.onOpen(event)} icon={<Users className="w-3.5 h-3.5" />} />
              <IconButton label="Edit" onClick={() => props.onEdit(event)} icon={<Edit2 className="w-3.5 h-3.5" />} />
              {event.is_cancelled ? (
                <IconButton label="Un-cancel" onClick={() => props.onUncancel(event)} icon={<CheckCircle className="w-3.5 h-3.5" />} />
              ) : (
                <IconButton label="Cancel" onClick={() => props.onCancel(event)} icon={<XCircle className="w-3.5 h-3.5" />} />
              )}
              <IconButton label="Delete" onClick={() => props.onDelete(event)} icon={<Trash2 className="w-3.5 h-3.5" />} danger />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IconButton({ label, onClick, icon, danger }: { label: string; onClick: () => void; icon: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`p-1.5 transition-colors ${danger ? 'hover:bg-red-50 text-red-500' : 'hover:bg-black/5 text-black/60 hover:text-black'}`}
    >
      {icon}
    </button>
  );
}

function VisibilityPill({ visibility }: { visibility: EventVisibility }) {
  const config: Record<EventVisibility, { label: string; cls: string; icon: React.ReactNode }> = {
    public: { label: 'Public', cls: 'bg-green-100 text-green-700', icon: <Eye className="w-2.5 h-2.5" /> },
    private_listed: { label: 'Private · Listed', cls: 'bg-amber-100 text-amber-700', icon: <Eye className="w-2.5 h-2.5" /> },
    private_hidden: { label: 'Private · Hidden', cls: 'bg-black text-white', icon: <EyeOff className="w-2.5 h-2.5" /> },
  };
  const c = config[visibility];
  return (
    <span className={`font-mono text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 inline-flex items-center gap-1 ${c.cls}`}>
      {c.icon}{c.label}
    </span>
  );
}

// ─── Form view ───────────────────────────────────────────────────────

function FormView(props: {
  form: Partial<SweetEvent>;
  setForm: (f: Partial<SweetEvent>) => void;
  editingId: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { form, setForm, editingId, saving, onSave, onCancel } = props;

  function update<K extends keyof SweetEvent>(key: K, value: SweetEvent[K] | string | null) {
    setForm({ ...form, [key]: value });
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <button onClick={onCancel} className="font-mono text-xs text-black/60 hover:text-black inline-flex items-center gap-1.5">
        <ArrowLeft className="w-3 h-3" /> Back to events
      </button>

      <div>
        <h2 className="font-mono text-sm font-bold uppercase tracking-wider mb-1">
          {editingId ? 'Edit Event' : 'New Event'}
        </h2>
        <p className="font-mono text-xs text-black/60">
          {editingId ? 'Changes go live immediately. Attendees with RSVPs keep them.' : 'The event will be visible based on its visibility setting as soon as it\'s saved.'}
        </p>
      </div>

      <Field label="Title" required>
        <input
          type="text"
          value={form.title || ''}
          onChange={(e) => update('title', e.target.value)}
          placeholder="Cook Sesh · Fall Edition"
          className="w-full border-2 border-black px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
        />
      </Field>

      <Field label="Tagline" hint="Short one-liner shown in list cards. Optional.">
        <input
          type="text"
          value={form.tagline || ''}
          onChange={(e) => update('tagline', e.target.value)}
          placeholder="Free collaborative session — bring ideas, leave with songs."
          className="w-full border-2 border-black px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
        />
      </Field>

      <Field label="Description" hint="Full details shown on the event page.">
        <textarea
          value={form.description || ''}
          onChange={(e) => update('description', e.target.value)}
          rows={6}
          placeholder="What's happening, who it's for, what to expect..."
          className="w-full border-2 border-black px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none resize-y"
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Starts at" required>
          <input
            type="datetime-local"
            value={(form.starts_at as string) || ''}
            onChange={(e) => update('starts_at', e.target.value)}
            className="w-full border-2 border-black px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
          />
        </Field>
        <Field label="Ends at" hint="Optional">
          <input
            type="datetime-local"
            value={(form.ends_at as string) || ''}
            onChange={(e) => update('ends_at', e.target.value)}
            className="w-full border-2 border-black px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
          />
        </Field>
      </div>

      <Field label="Location" hint="Free-form. e.g. Sweet Dreams Studio A, 123 Main St, or TBA.">
        <input
          type="text"
          value={form.location || ''}
          onChange={(e) => update('location', e.target.value)}
          placeholder="Sweet Dreams Music · Studio A"
          className="w-full border-2 border-black px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
        />
      </Field>

      <Field label="Flyer / cover image" hint="Upload at any size — the listing and detail page show it uncropped. JPG, PNG, WebP, GIF, or AVIF.">
        <FlyerUploader
          currentUrl={form.cover_image_url || null}
          onUploaded={(url) => update('cover_image_url', url)}
          onRemove={() => update('cover_image_url', null)}
        />
      </Field>

      <Field label="Visibility" required>
        <div className="space-y-2">
          {(['public', 'private_listed', 'private_hidden'] as const).map((v) => (
            <label key={v} className="flex items-start gap-3 cursor-pointer border border-black/10 p-3 hover:bg-black/[0.02]">
              <input
                type="radio"
                name="visibility"
                value={v}
                checked={form.visibility === v}
                onChange={() => update('visibility', v)}
                className="mt-1 accent-amber-500"
              />
              <div className="flex-1">
                <p className="font-mono text-xs font-bold uppercase tracking-wider">{visibilityLabel(v)}</p>
                <p className="font-mono text-[11px] text-black/60 mt-0.5">
                  {v === 'public' && 'Anyone can see and RSVP directly from /events.'}
                  {v === 'private_listed' && 'Visible on /events, but visitors must request to attend. You approve each one.'}
                  {v === 'private_hidden' && 'Not listed on /events. Only invited people see it.'}
                </p>
              </div>
            </label>
          ))}
        </div>
      </Field>

      <Field label="Capacity" hint="Optional. Leave blank for unlimited.">
        <input
          type="number"
          min={1}
          value={form.capacity ?? ''}
          onChange={(e) => update('capacity', e.target.value ? Number(e.target.value) : null)}
          placeholder="e.g. 50"
          className="w-40 border-2 border-black px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
        />
      </Field>

      <div className="flex items-center gap-3 pt-4 border-t border-black/10">
        <button
          onClick={onSave}
          disabled={saving}
          className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-6 py-3 hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create event'}
        </button>
        <button onClick={onCancel} className="font-mono text-sm text-black/60 hover:text-black">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1">
        {label}{required ? ' *' : ''}
      </label>
      {children}
      {hint && <p className="font-mono text-[10px] text-black/40 mt-1">{hint}</p>}
    </div>
  );
}

// ─── Flyer uploader ─────────────────────────────────────────────────
//
// Three-step signed-URL upload (same shape used by bands + profiles):
//   1. Ask /api/admin/events/cover/upload-url for a one-time URL
//   2. PUT the file directly to Supabase Storage (browser → Supabase)
//   3. Update the parent form with the resulting publicUrl
//
// Why direct-to-Supabase instead of multipart-to-our-API: Vercel functions
// cap request bodies at 4.5MB. Flyers (especially uncompressed photos) can
// blow that cap. The API stays in the auth + path-construction lane only.

function FlyerUploader(props: {
  currentUrl: string | null;
  onUploaded: (url: string) => void;
  onRemove: () => void;
}) {
  const { currentUrl, onUploaded, onRemove } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('That doesn\'t look like an image file.');
      return;
    }
    // 100MB cap. Generous because flyers tend to be larger than typical
    // profile photos (high-res / print-quality art). The browser uploads
    // direct to Supabase, so the Vercel 4.5MB body limit isn't the constraint
    // here — this cap is just to keep the bucket from growing wild.
    if (file.size > 100 * 1024 * 1024) {
      setError('File is too large. Max 100 MB.');
      return;
    }

    setUploading(true);
    try {
      // 1. Get signed URL.
      const urlRes = await fetch('/api/admin/events/cover/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name }),
      });
      if (!urlRes.ok) {
        const data = await urlRes.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to start upload');
      }
      const { signedUrl, publicUrl } = await urlRes.json();

      // 2. PUT directly to Supabase Storage.
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error('Upload to storage failed');

      // 3. Tell the parent form. The publicUrl gets persisted with the
      // event row when the admin clicks Save.
      onUploaded(publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = ''; // allow re-uploading the same file
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      {currentUrl ? (
        <div className="border-2 border-black p-3 space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentUrl}
            alt="Flyer preview"
            className="block max-h-80 w-auto mx-auto"
          />
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-black/10">
            <p className="font-mono text-[10px] text-black/50 truncate flex-1">
              {currentUrl.split('/').pop()}
            </p>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className="font-mono text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 bg-black/5 hover:bg-black/10 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <Upload className="w-3 h-3" />
                {uploading ? 'Uploading…' : 'Replace'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onRemove();
                  setError(null);
                }}
                disabled={uploading}
                className="font-mono text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3 h-3" /> Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full border-2 border-dashed border-black/30 hover:border-black hover:bg-black/[0.02] py-10 flex flex-col items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          {uploading ? (
            <>
              <Upload className="w-6 h-6 text-accent animate-pulse" />
              <p className="font-mono text-xs">Uploading…</p>
            </>
          ) : (
            <>
              <ImageIcon className="w-6 h-6 text-black/40" />
              <p className="font-mono text-xs font-bold uppercase tracking-wider">Choose a flyer</p>
              <p className="font-mono text-[10px] text-black/40">JPG / PNG / WebP — max 25 MB</p>
            </>
          )}
        </button>
      )}

      {error && (
        <p className="font-mono text-[10px] text-red-700 bg-red-50 px-2 py-1.5 inline-flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}
    </div>
  );
}

// ─── Detail view ────────────────────────────────────────────────────

function DetailView(props: {
  event: SweetEvent;
  rsvps: EventRsvp[];
  rsvpsByStatus: Record<EventRsvpStatus, EventRsvp[]>;
  loading: boolean;
  inviteEmails: string;
  inviteMessage: string;
  sendingInvites: boolean;
  inviteResults: InviteResult[] | null;
  onBack: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onUncancel: () => void;
  onDelete: () => void;
  setInviteEmails: (v: string) => void;
  setInviteMessage: (v: string) => void;
  onSendInvites: () => void;
  onDecideRequest: (rsvp: EventRsvp, decision: 'going' | 'not_going') => void;
  onDeleteRsvp: (rsvp: EventRsvp) => void;
}) {
  const { event, rsvpsByStatus, loading } = props;
  const confirmedAttendees = rsvpsByStatus.going.reduce((acc, r) => acc + 1 + r.guest_count, 0);

  return (
    <div className="space-y-6">
      <button onClick={props.onBack} className="font-mono text-xs text-black/60 hover:text-black inline-flex items-center gap-1.5">
        <ArrowLeft className="w-3 h-3" /> Back to events
      </button>

      {/* Header */}
      <div className="border border-black/10 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <VisibilityPill visibility={event.visibility} />
              {event.is_cancelled && (
                <span className="font-mono text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-red-100 text-red-700">Cancelled</span>
              )}
            </div>
            <h2 className="font-mono text-xl font-bold mb-1">{event.title}</h2>
            {event.tagline && <p className="font-mono text-sm text-black/70 mb-3">{event.tagline}</p>}
            <div className="flex items-center gap-4 flex-wrap text-xs font-mono text-black/60">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                {fmtStampDateTime(event.starts_at, { weekday: 'short', year: 'numeric', minute: '2-digit' })}
              </span>
              {event.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-3 h-3" /> {event.location}
                </span>
              )}
              {event.capacity !== null && (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="w-3 h-3" /> {confirmedAttendees} / {event.capacity}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={props.onEdit} className="bg-black/5 hover:bg-black/10 font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-2 inline-flex items-center gap-1.5">
              <Edit2 className="w-3 h-3" /> Edit
            </button>
            {event.is_cancelled ? (
              <button onClick={props.onUncancel} className="bg-black/5 hover:bg-black/10 font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-2 inline-flex items-center gap-1.5">
                <CheckCircle className="w-3 h-3" /> Un-cancel
              </button>
            ) : (
              <button onClick={props.onCancel} className="bg-black/5 hover:bg-black/10 font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-2 inline-flex items-center gap-1.5">
                <XCircle className="w-3 h-3" /> Cancel
              </button>
            )}
            <button onClick={props.onDelete} className="bg-red-50 hover:bg-red-100 text-red-700 font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-2 inline-flex items-center gap-1.5">
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        </div>
        {event.is_cancelled && event.cancellation_reason && (
          <div className="mt-4 bg-red-50 border border-red-200 px-3 py-2">
            <p className="font-mono text-xs text-red-800">
              <strong>Cancellation reason:</strong> {event.cancellation_reason}
            </p>
          </div>
        )}
      </div>

      {/* Invite sender */}
      <div className="border border-black/10 p-5">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider mb-3 inline-flex items-center gap-2">
          <Send className="w-3.5 h-3.5" /> Send Invitations
        </h3>
        <div className="space-y-3">
          <Field label="Email addresses" hint="Separate with commas, semicolons, or new lines.">
            <textarea
              value={props.inviteEmails}
              onChange={(e) => props.setInviteEmails(e.target.value)}
              rows={3}
              placeholder="someone@example.com, another@example.com"
              className="w-full border-2 border-black px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none resize-y"
            />
          </Field>
          <Field label="Personal note" hint="Optional — shown in the invitation email.">
            <textarea
              value={props.inviteMessage}
              onChange={(e) => props.setInviteMessage(e.target.value)}
              rows={2}
              placeholder="Hey — hoping you can make it. We'd love to have you there."
              className="w-full border-2 border-black px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none resize-y"
            />
          </Field>
          <button
            onClick={props.onSendInvites}
            disabled={props.sendingInvites || !props.inviteEmails.trim()}
            className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-4 py-2.5 hover:bg-accent/90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Mail className="w-4 h-4" />
            {props.sendingInvites ? 'Sending…' : 'Send invitations'}
          </button>

          {props.inviteResults && props.inviteResults.length > 0 && (
            <div className="mt-4 space-y-1">
              {props.inviteResults.map((r) => (
                <div key={r.email} className={`flex items-center gap-2 text-xs font-mono px-3 py-1.5 ${
                  r.status === 'sent' ? 'bg-green-50 text-green-800' :
                  r.status === 'skipped' ? 'bg-amber-50 text-amber-800' :
                  'bg-red-50 text-red-800'
                }`}>
                  {r.status === 'sent' && <CheckCircle className="w-3.5 h-3.5" />}
                  {r.status === 'skipped' && <AlertCircle className="w-3.5 h-3.5" />}
                  {r.status === 'failed' && <XCircle className="w-3.5 h-3.5" />}
                  <span className="font-bold uppercase tracking-wider w-16">{r.status}</span>
                  <span className="flex-1 truncate">{r.email}</span>
                  {r.reason && <span className="text-[10px] opacity-70">· {r.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RSVP roster */}
      <div className="border border-black/10 p-5">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider mb-3 inline-flex items-center gap-2">
          <Users className="w-3.5 h-3.5" /> Attendees ({props.rsvps.length})
        </h3>
        {loading ? (
          <p className="font-mono text-xs text-black/60 py-4 text-center">Loading…</p>
        ) : props.rsvps.length === 0 ? (
          <p className="font-mono text-xs text-black/60 py-6 text-center">No RSVPs yet. Send invitations above to get started.</p>
        ) : (
          <div className="space-y-5">
            {(['requested', 'invited', 'going', 'maybe', 'not_going'] as const).map((status) => {
              const rows = props.rsvpsByStatus[status];
              if (rows.length === 0) return null;
              return (
                <RsvpBucket
                  key={status}
                  status={status}
                  rows={rows}
                  onDecideRequest={props.onDecideRequest}
                  onDeleteRsvp={props.onDeleteRsvp}
                />
              );
            })}
          </div>
        )}
      </div>

      {event.description && (
        <div className="border border-black/10 p-5">
          <h3 className="font-mono text-xs font-bold uppercase tracking-wider mb-3 inline-flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5" /> Description
          </h3>
          <p className="font-mono text-xs text-black/80 whitespace-pre-wrap leading-relaxed">{event.description}</p>
        </div>
      )}
    </div>
  );
}

function RsvpBucket(props: {
  status: EventRsvpStatus;
  rows: EventRsvp[];
  onDecideRequest: (r: EventRsvp, d: 'going' | 'not_going') => void;
  onDeleteRsvp: (r: EventRsvp) => void;
}) {
  const statusColor: Record<EventRsvpStatus, string> = {
    requested: 'bg-amber-50 text-amber-800 border-amber-200',
    invited: 'bg-blue-50 text-blue-800 border-blue-200',
    going: 'bg-green-50 text-green-800 border-green-200',
    maybe: 'bg-black/5 text-black/70 border-black/10',
    not_going: 'bg-black/5 text-black/40 border-black/10',
  };
  return (
    <div>
      <h4 className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 border inline-block mb-2 ${statusColor[props.status]}`}>
        {rsvpStatusLabel(props.status)} · {props.rows.length}
      </h4>
      <div className="divide-y divide-black/10 border border-black/10">
        {props.rows.map((r) => {
          // Identity resolution priority:
          //   1. Joined profile (logged-in user RSVPed) → name + email + photo
          //   2. invited_email (token-only invite, no account yet) → email
          //   3. user_id slice (degraded; means the profile lookup missed)
          //
          // We deliberately show BOTH name AND email when a profile exists,
          // because an admin reviewing a 'requested' RSVP needs the email to
          // contact the person but the name to match against their gut sense
          // of "who actually shows up to these things".
          const p = r.profile ?? null;
          const primaryName = p?.display_name?.trim() || r.invited_email || (r.user_id ? `User ${r.user_id.slice(0, 8)}` : 'Unknown');
          const secondaryEmail = p?.email && p.email !== primaryName ? p.email : null;
          const profileSlug = p?.public_profile_slug || null;
          return (
            <div key={r.id} className="p-3 flex items-start gap-3">
              {/* Avatar — uses the user's profile picture when present, falls
                  back to a generic person icon. Decorative-only (the name
                  next to it is the accessible identifier). */}
              {p?.profile_picture_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.profile_picture_url}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-black/10"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center flex-shrink-0 border border-black/10">
                  <UserIcon className="w-3.5 h-3.5 text-black/40" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="font-mono text-xs font-bold truncate" title={primaryName}>
                    {primaryName}
                  </p>
                  {profileSlug && (
                    <Link
                      href={`/u/${profileSlug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-accent hover:underline inline-flex items-center gap-0.5 no-underline"
                      title="Open public profile"
                    >
                      profile <ExternalLink className="w-2.5 h-2.5" />
                    </Link>
                  )}
                </div>
                {secondaryEmail && (
                  <p className="font-mono text-[10px] text-black/60 truncate" title={secondaryEmail}>
                    {secondaryEmail}
                  </p>
                )}
                {!p && r.invited_email && (
                  // Token-invite case — no profile joined. Mark explicitly so
                  // admins know this person doesn't have an account yet.
                  <p className="font-mono text-[10px] text-black/50 italic">
                    invite-only (no account yet)
                  </p>
                )}
                {r.guest_count > 0 && (
                  <p className="font-mono text-[10px] text-black/60 mt-0.5">+ {r.guest_count} guest{r.guest_count !== 1 ? 's' : ''}</p>
                )}
                {r.message && (
                  <p className="font-mono text-[11px] text-black/70 mt-1 italic line-clamp-3">&ldquo;{r.message}&rdquo;</p>
                )}
                <p className="font-mono text-[9px] text-black/40 mt-1">
                  {props.status === 'requested' ? 'Requested' : props.status === 'invited' ? 'Invited' : 'Responded'}{' '}
                  {fmtStampDateTime(r.responded_at || r.created_at, { minute: '2-digit' })}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {props.status === 'requested' && (
                  <>
                    <button
                      onClick={() => props.onDecideRequest(r, 'going')}
                      title="Approve"
                      className="p-1.5 bg-green-50 hover:bg-green-100 text-green-700"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => props.onDecideRequest(r, 'not_going')}
                      title="Deny"
                      className="p-1.5 bg-red-50 hover:bg-red-100 text-red-700"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => props.onDeleteRsvp(r)}
                  title="Remove"
                  className="p-1.5 hover:bg-black/5 text-black/40 hover:text-black/70"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
