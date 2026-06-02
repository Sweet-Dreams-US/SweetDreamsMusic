'use client';

// components/engineer/EngineerAvailability.tsx
//
// Self-service availability blocking for engineers. Mirrors the admin
// StudioBlocks UI but scoped to the signed-in engineer. Use this when
// you're going to be off (vacation, sick day, other gig) and you don't
// want bookings landing on you — other engineers stay bookable for the
// same time window because the block is engineer-specific (not studio-
// wide).
//
// Studio-wide blocks (admin-set, e.g., "studio closed for maintenance")
// continue to flow through admin → /api/admin/blocks. This component
// only manages the logged-in engineer's own blocks via /api/engineer/blocks.

import { useEffect, useState } from 'react';
import { CalendarOff, Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { fmtSessionDate, fmtSessionTime } from '@/lib/studio-time';

interface Block {
  id: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  engineer_name: string | null;
  created_at: string;
}

function generateTimeOptions(): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    out.push(`${String(h).padStart(2, '0')}:00`);
    out.push(`${String(h).padStart(2, '0')}:30`);
  }
  return out;
}

export default function EngineerAvailability() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [engineerName, setEngineerName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timeOptions = generateTimeOptions();

  async function fetchBlocks() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/engineer/blocks', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not load blocks.');
      } else {
        setBlocks(data.blocks || []);
        setEngineerName(data.engineer_name || null);
      }
    } catch {
      setError('Network error loading blocks.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchBlocks(); }, []);

  async function createBlock() {
    if (!date || !startTime || !endTime) {
      setError('Pick a date, start time, and end time.');
      return;
    }
    if (endTime <= startTime) {
      setError('End time must be after start time.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/engineer/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, startTime, endTime, reason: reason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not create block.');
      } else {
        setDate('');
        setStartTime('');
        setEndTime('');
        setReason('');
        await fetchBlocks();
      }
    } catch {
      setError('Network error creating block.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteBlock(id: string) {
    if (!confirm('Remove this block? Bookings can land on you again for this window.')) return;
    try {
      const res = await fetch('/api/engineer/blocks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Could not remove block.');
      } else {
        await fetchBlocks();
      }
    } catch {
      setError('Network error removing block.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-heading-md mb-2">My Availability</h2>
        <p className="font-mono text-xs text-black/60 max-w-2xl">
          Block off times when you can&apos;t take bookings. Other engineers stay available
          for the same window — only you are unavailable. The booking flow rejects requests
          for you during these blocks; admins can reassign or the buyer can pick another engineer.
        </p>
        {engineerName && (
          <p className="font-mono text-[11px] text-black/40 mt-2">
            Blocking as: <strong className="text-black/70">{engineerName}</strong>
          </p>
        )}
      </div>

      {/* Create block form */}
      <div className="border-2 border-black/10 p-5">
        <p className="font-mono text-[11px] uppercase tracking-wider text-black/60 mb-3 inline-flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" />
          New block
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-wider text-black/50 block mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-black/20 px-2 py-1 font-mono text-xs"
            />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-wider text-black/50 block mb-1">Start</label>
            <select
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full border border-black/20 px-2 py-1 font-mono text-xs"
            >
              <option value="">—</option>
              {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-wider text-black/50 block mb-1">End</label>
            <select
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full border border-black/20 px-2 py-1 font-mono text-xs"
            >
              <option value="">—</option>
              {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional, e.g. 'Vacation')"
          className="w-full border border-black/20 px-2 py-1 font-mono text-xs mb-2"
        />
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-900 font-mono text-[11px] px-2 py-1 mb-2 inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {error}
          </div>
        )}
        <button
          onClick={createBlock}
          disabled={saving}
          className="bg-black text-white font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 hover:bg-accent hover:text-black transition-colors disabled:opacity-50 inline-flex items-center gap-1"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CalendarOff className="w-3 h-3" />}
          Block this time
        </button>
      </div>

      {/* Block list */}
      <div>
        <p className="font-mono text-[11px] uppercase tracking-wider text-black/60 mb-2">
          Upcoming blocks {!loading && blocks.length > 0 && `(${blocks.length})`}
        </p>
        {loading ? (
          <div className="text-center py-6">
            <Loader2 className="w-4 h-4 animate-spin mx-auto text-black/40" />
          </div>
        ) : blocks.length === 0 ? (
          <div className="border-2 border-dashed border-black/10 p-8 text-center">
            <p className="font-mono text-xs text-black/50">No upcoming blocks. You&apos;re bookable for everything ahead.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {blocks.map((b) => {
              return (
                <li key={b.id} className="border-2 border-black/10 p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-sm">
                      {fmtSessionDate(b.start_time, { weekday: 'short', month: 'short', day: 'numeric' })}
                      {' · '}
                      {fmtSessionTime(b.start_time, { hour: 'numeric', minute: '2-digit' })}
                      {' – '}
                      {fmtSessionTime(b.end_time, { hour: 'numeric', minute: '2-digit' })}
                    </p>
                    {b.reason && (
                      <p className="font-mono text-[11px] text-black/60 italic mt-0.5">&ldquo;{b.reason}&rdquo;</p>
                    )}
                  </div>
                  <button
                    onClick={() => deleteBlock(b.id)}
                    className="text-black/40 hover:text-red-700 shrink-0"
                    title="Remove block"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
