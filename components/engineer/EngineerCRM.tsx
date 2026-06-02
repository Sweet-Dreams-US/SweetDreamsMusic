'use client';

import { useState, useEffect, useMemo } from 'react';
import { Search, Copy, Check, ChevronDown, ChevronUp, ArrowUpDown, Phone, Mail, User, FileText, ExternalLink } from 'lucide-react';
import { formatCents, formatDuration } from '@/lib/utils';
import { fmtSessionDate, fmtSessionTime } from '@/lib/studio-time';

interface EngineerClient {
  id: string;
  user_id: string | null;
  display_name: string;
  profile_picture_url: string | null;
  public_profile_slug: string | null;
  email: string;
  is_producer: boolean;
  producer_name: string | null;
  files_count: number;
  notes_count: number;
  session_count: number;
  total_revenue: number;
  last_session: string | null;
  phone: string | null;
}

interface ClientBooking {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  artist_name: string | null;
  start_time: string;
  end_time: string;
  duration: number;
  room: string | null;
  total_amount: number;
  deposit_amount: number;
  remainder_amount: number;
  actual_deposit_paid: number | null;
  status: string;
  engineer_name: string | null;
  created_at: string;
  admin_notes: string | null;
}

type SortKey = 'display_name' | 'session_count' | 'total_revenue' | 'last_session';
type SortDir = 'asc' | 'desc';

export default function EngineerCRM({ userEmail }: { userEmail: string }) {
  const [clients, setClients] = useState<EngineerClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [engineerName, setEngineerName] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('last_session');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/engineer/clients')
      .then(r => r.json())
      .then(data => {
        setClients(data.clients || []);
        setEngineerName(data.engineerName || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = clients;
    if (q) {
      list = clients.filter(c =>
        (c.display_name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      if (sortKey === 'display_name') {
        av = (a.display_name || '').toLowerCase();
        bv = (b.display_name || '').toLowerCase();
      } else if (sortKey === 'session_count') {
        av = a.session_count; bv = b.session_count;
      } else if (sortKey === 'total_revenue') {
        av = a.total_revenue; bv = b.total_revenue;
      } else if (sortKey === 'last_session') {
        av = a.last_session || ''; bv = b.last_session || '';
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [clients, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'display_name' ? 'asc' : 'desc');
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 text-black/30" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  }

  if (loading) {
    return <p className="font-mono text-sm text-black/70">Loading your clients...</p>;
  }

  const totalSessions = clients.reduce((s, c) => s + c.session_count, 0);
  const totalRevenue = clients.reduce((s, c) => s + c.total_revenue, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-mono text-lg font-bold uppercase tracking-wider">My Clients</h2>
          <p className="font-mono text-xs text-black/60 mt-1">
            {clients.length} client{clients.length !== 1 ? 's' : ''} you&apos;ve worked with
          </p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="My Clients" value={String(clients.length)} />
        <StatCard label="My Sessions" value={String(totalSessions)} />
        <StatCard label="Session Revenue" value={formatCents(totalRevenue)} />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/40" />
        <input
          type="text"
          placeholder="Search by name, email, or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 font-mono text-sm border-2 border-black/10 focus:border-black/30 outline-none transition-colors"
        />
      </div>

      {/* Desktop Table */}
      <div className="hidden lg:block border-2 border-black/10 overflow-hidden">
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="bg-black/5 text-left">
              <SortHeader label="Name" col="display_name" onClick={toggleSort} icon={<SortIcon col="display_name" />} />
              <th className="px-3 py-2.5 font-semibold uppercase tracking-wider">Email</th>
              <th className="px-3 py-2.5 font-semibold uppercase tracking-wider">Phone</th>
              <SortHeader label="Sessions" col="session_count" onClick={toggleSort} icon={<SortIcon col="session_count" />} />
              <SortHeader label="Revenue" col="total_revenue" onClick={toggleSort} icon={<SortIcon col="total_revenue" />} />
              <SortHeader label="Last Session" col="last_session" onClick={toggleSort} icon={<SortIcon col="last_session" />} />
              <th className="px-3 py-2.5 font-semibold uppercase tracking-wider">Files / Notes</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <>
                <tr
                  key={c.id}
                  onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  className={`border-t border-black/5 cursor-pointer transition-colors ${expandedId === c.id ? 'bg-accent/5' : 'hover:bg-black/[0.02]'}`}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {c.profile_picture_url ? (
                        <img src={c.profile_picture_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-black/10 flex items-center justify-center">
                          <User className="w-3 h-3 text-black/40" />
                        </div>
                      )}
                      <span className="font-semibold">{c.display_name || '—'}</span>
                      {c.is_producer && c.producer_name && (
                        <span className="font-mono text-[10px] bg-accent/20 text-amber-700 px-1.5 py-0.5 font-bold uppercase">Producer</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <CopyCell value={c.email} />
                  </td>
                  <td className="px-3 py-2.5">
                    <CopyCell value={c.phone} />
                  </td>
                  <td className="px-3 py-2.5 text-center">{c.session_count || '—'}</td>
                  <td className="px-3 py-2.5">{c.total_revenue ? formatCents(c.total_revenue) : '—'}</td>
                  <td className="px-3 py-2.5">
                    {c.last_session
                      ? fmtSessionDate(c.last_session, { month: 'short', day: 'numeric', year: '2-digit' })
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3 text-black/30" />
                      {c.files_count} / {c.notes_count}
                    </span>
                  </td>
                </tr>
                {expandedId === c.id && (
                  <tr key={`${c.id}-detail`}>
                    <td colSpan={7} className="p-0">
                      <ClientDetail client={c} engineerName={engineerName} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="font-mono text-xs text-black/60 p-6 text-center">No clients found</p>
        )}
      </div>

      {/* Mobile Cards */}
      <div className="lg:hidden space-y-3">
        {filtered.map((c) => (
          <div key={c.id} className={`border-2 ${expandedId === c.id ? 'border-accent/40' : 'border-black/10'}`}>
            <button
              onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
              className="w-full text-left p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {c.profile_picture_url ? (
                    <img src={c.profile_picture_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-black/10 flex items-center justify-center">
                      <User className="w-4 h-4 text-black/40" />
                    </div>
                  )}
                  <div>
                    <p className="font-mono text-sm font-bold">{c.display_name || '—'}</p>
                    {c.email && <p className="font-mono text-[10px] text-black/60">{c.email}</p>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-semibold">{c.session_count} session{c.session_count !== 1 ? 's' : ''}</p>
                  <p className="font-mono text-[10px] text-black/60">
                    {c.total_revenue ? formatCents(c.total_revenue) : '—'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 mt-2 font-mono text-[10px] text-black/50">
                {c.phone && <span>Phone: {c.phone}</span>}
                {c.last_session && (
                  <span>Last: {fmtSessionDate(c.last_session, { month: 'short', day: 'numeric' })}</span>
                )}
                <span>{c.files_count} files, {c.notes_count} notes</span>
              </div>
            </button>
            {expandedId === c.id && (
              <div className="border-t border-black/10">
                <ClientDetail client={c} engineerName={engineerName} />
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="font-mono text-xs text-black/60 border border-black/10 p-6 text-center">No clients found</p>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-black/10 p-3">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-black/50">{label}</p>
      <p className="font-mono text-lg font-bold mt-0.5">{value}</p>
    </div>
  );
}

function SortHeader({ label, col, onClick, icon }: { label: string; col: SortKey; onClick: (col: SortKey) => void; icon: React.ReactNode }) {
  return (
    <th
      className="px-3 py-2.5 font-semibold uppercase tracking-wider cursor-pointer hover:bg-black/5 transition-colors select-none"
      onClick={() => onClick(col)}
    >
      <div className="flex items-center gap-1">
        {label}
        {icon}
      </div>
    </th>
  );
}

function CopyCell({ value }: { value: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!value) return <span className="text-black/30">—</span>;

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(value!);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={handleCopy}
      className="group flex items-center gap-1 hover:text-black transition-colors text-left"
      title="Click to copy"
    >
      <span className="truncate max-w-[160px]">{value}</span>
      {copied ? (
        <Check className="w-3 h-3 text-green-600 shrink-0" />
      ) : (
        <Copy className="w-3 h-3 text-black/20 group-hover:text-black/50 shrink-0" />
      )}
    </button>
  );
}

function ClientDetail({ client, engineerName }: { client: EngineerClient; engineerName: string }) {
  const [bookings, setBookings] = useState<ClientBooking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [note, setNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [noteSuccess, setNoteSuccess] = useState(false);

  useEffect(() => {
    if (!client.email) {
      setLoadingBookings(false);
      return;
    }
    fetch(`/api/admin/client-bookings?email=${encodeURIComponent(client.email)}`)
      .then(r => r.json())
      .then(data => {
        // Filter to only this engineer's sessions
        const all: ClientBooking[] = data.bookings || [];
        const mine = all.filter(b =>
          b.engineer_name === engineerName ||
          b.engineer_name?.toLowerCase() === engineerName.toLowerCase()
        );
        setBookings(mine);
      })
      .catch(() => {})
      .finally(() => setLoadingBookings(false));
  }, [client.email, engineerName]);

  async function addNote() {
    if (!note.trim() || !client.user_id) return;
    setAddingNote(true);
    try {
      const res = await fetch('/api/admin/library/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: client.user_id, content: note.trim() }),
      });
      if (res.ok) {
        setNote('');
        setNoteSuccess(true);
        setTimeout(() => setNoteSuccess(false), 2000);
      }
    } catch {
      // silent
    } finally {
      setAddingNote(false);
    }
  }

  return (
    <div className="bg-black/[0.02] p-4 sm:p-5 space-y-5">
      {/* Contact Card */}
      <div className="space-y-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-black/50">Contact</p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <User className="w-3.5 h-3.5 text-black/40" />
            <span className="font-mono text-xs font-semibold">{client.display_name}</span>
            {client.is_producer && client.producer_name && (
              <span className="font-mono text-[10px] bg-accent/20 text-amber-700 px-1.5 py-0.5 font-bold uppercase">Producer</span>
            )}
          </div>
          {client.email && (
            <div className="flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 text-black/40" />
              <CopyCell value={client.email} />
            </div>
          )}
          {client.phone && (
            <div className="flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-black/40" />
              <CopyCell value={client.phone} />
            </div>
          )}
          {client.public_profile_slug && (
            <div className="flex items-center gap-2">
              <ExternalLink className="w-3.5 h-3.5 text-black/40" />
              <a
                href={`/${client.public_profile_slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-accent hover:underline"
              >
                Profile
              </a>
            </div>
          )}
          <div className="flex items-center gap-3 font-mono text-[10px] text-black/50 mt-1">
            <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {client.files_count} files</span>
            <span>{client.notes_count} notes</span>
          </div>
        </div>
      </div>

      {/* Session History */}
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-black/50 mb-2">
          My Sessions with {client.display_name} ({bookings.length})
        </p>
        {loadingBookings ? (
          <p className="font-mono text-xs text-black/40">Loading sessions...</p>
        ) : bookings.length === 0 ? (
          <p className="font-mono text-xs text-black/40">No sessions found</p>
        ) : (
          <div className="border border-black/10 overflow-x-auto">
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="bg-black/5 text-left">
                  <th className="px-2 py-1.5 font-semibold uppercase tracking-wider">Date</th>
                  <th className="px-2 py-1.5 font-semibold uppercase tracking-wider">Room</th>
                  <th className="px-2 py-1.5 font-semibold uppercase tracking-wider">Duration</th>
                  <th className="px-2 py-1.5 font-semibold uppercase tracking-wider">Status</th>
                  <th className="px-2 py-1.5 font-semibold uppercase tracking-wider text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => {
                  return (
                    <tr key={b.id} className="border-t border-black/5">
                      <td className="px-2 py-1.5">
                        {fmtSessionDate(b.start_time, { month: 'short', day: 'numeric', year: '2-digit' })}
                        <span className="text-black/40 ml-1">
                          {fmtSessionTime(b.start_time, { hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        {b.room === 'studio_a' ? 'Studio A' : b.room === 'studio_b' ? 'Studio B' : b.room || '—'}
                      </td>
                      <td className="px-2 py-1.5">{formatDuration(b.duration)}</td>
                      <td className="px-2 py-1.5">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold">{formatCents(b.total_amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Note */}
      {client.user_id && (
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-black/50 mb-2">
            Quick Note
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Add a note about this client..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addNote()}
              className="flex-1 font-mono text-xs px-3 py-2 border border-black/10 focus:border-black/30 outline-none transition-colors"
            />
            <button
              onClick={addNote}
              disabled={!note.trim() || addingNote}
              className="font-mono text-xs font-bold uppercase tracking-wider bg-black text-white px-4 py-2 hover:bg-black/80 disabled:opacity-50 transition-colors"
            >
              {noteSuccess ? 'Saved!' : addingNote ? '...' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    confirmed: 'bg-accent/20 text-amber-700',
    completed: 'bg-green-100 text-green-700',
    pending: 'bg-blue-100 text-blue-700',
    pending_deposit: 'bg-blue-100 text-blue-700',
    approved: 'bg-accent/20 text-amber-700',
    cancelled: 'bg-red-100 text-red-500',
  };
  const label = status === 'pending_deposit' ? 'Pending' : status;
  return (
    <span className={`font-bold uppercase text-[10px] px-1.5 py-0.5 ${styles[status] || 'bg-black/5 text-black/70'}`}>
      {label}
    </span>
  );
}
