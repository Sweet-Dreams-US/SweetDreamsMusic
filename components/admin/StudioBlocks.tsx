'use client';

import { useState, useEffect } from 'react';
import { Clock, Trash2, Plus } from 'lucide-react';
import { formatTime } from '@/lib/utils';
import { fmtSessionDate, fmtSessionTime } from '@/lib/studio-time';

interface Block {
  id: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  /** Set = engineer-scoped block (only that engineer is unavailable;
   *  studio + other engineers stay bookable). Null = studio-wide
   *  closure (maintenance, private event — closes the room calendar). */
  engineer_name: string | null;
}

function generateTimeOptions() {
  const options: string[] = [];
  for (let h = 0; h < 24; h++) {
    options.push(`${h}:00`);
    options.push(`${h}:30`);
  }
  return options;
}

export default function StudioBlocks() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const timeOptions = generateTimeOptions();

  useEffect(() => {
    fetchBlocks();
  }, []);

  async function fetchBlocks() {
    setLoading(true);
    const res = await fetch('/api/admin/blocks');
    const data = await res.json();
    setBlocks(data.blocks || []);
    setLoading(false);
  }

  async function createBlock() {
    if (!date || !startTime || !endTime) {
      alert('Select a date, start time, and end time');
      return;
    }
    setSaving(true);
    const res = await fetch('/api/admin/blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, startTime, endTime, reason }),
    });
    if (res.ok) {
      setDate('');
      setStartTime('');
      setEndTime('');
      setReason('');
      fetchBlocks();
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to create block');
    }
    setSaving(false);
  }

  async function deleteBlock(id: string) {
    if (!confirm('Remove this block-off time?')) return;
    await fetch('/api/admin/blocks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    fetchBlocks();
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-heading-sm mb-2">BLOCK OFF TIME</h2>
        <p className="font-mono text-xs text-black/40">
          Block time slots to prevent bookings. Use this to close the studio for maintenance, events, or any reason.
        </p>
      </div>

      {/* Create new block */}
      <div className="border-2 border-black p-6 space-y-4">
        <h3 className="font-mono text-sm font-bold uppercase tracking-wider">Add Block-Off</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Start Time</label>
            <select
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
            >
              <option value="">Select...</option>
              {timeOptions.map((t) => (
                <option key={t} value={t}>{formatTime(t)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">End Time</label>
            <select
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
            >
              <option value="">Select...</option>
              {timeOptions.map((t) => (
                <option key={t} value={t}>{formatTime(t)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-mono text-[10px] text-black/40 uppercase tracking-wider mb-1">Reason (optional)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
              placeholder="e.g. Maintenance"
            />
          </div>
        </div>

        <button
          onClick={createBlock}
          disabled={saving || !date || !startTime || !endTime}
          className="inline-flex items-center gap-2 bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-black/80 transition-colors disabled:opacity-50"
        >
          <Plus className="w-3 h-3" />
          {saving ? 'Saving...' : 'Block Off Time'}
        </button>
      </div>

      {/* Existing blocks */}
      <div>
        <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-4">
          Upcoming Blocks ({blocks.length})
        </h3>

        {loading ? (
          <p className="font-mono text-sm text-black/40">Loading...</p>
        ) : blocks.length === 0 ? (
          <p className="font-mono text-xs text-black/30 border border-black/10 p-6 text-center">
            No block-off times scheduled.
          </p>
        ) : (
          <div className="space-y-2">
            {blocks.map((block) => {
              const dateStr = fmtSessionDate(block.start_time, { weekday: 'short', month: 'short', day: 'numeric' });
              const startStr = fmtSessionTime(block.start_time);
              const endStr = fmtSessionTime(block.end_time);

              return (
                <div key={block.id} className="flex items-center justify-between border border-black/10 px-4 py-3">
                  <div className="flex items-center gap-4">
                    {/* Engineer-scoped blocks use a muted clock — they
                        don't close the studio, so they're not "red". */}
                    <Clock className={`w-4 h-4 ${block.engineer_name ? 'text-black/30' : 'text-red-500'}`} />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-mono text-sm font-bold">{dateStr}</p>
                        {block.engineer_name ? (
                          <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-black/25 text-black/55">
                            {block.engineer_name} only
                          </span>
                        ) : (
                          <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-red-100 text-red-700 font-bold">
                            Studio-wide
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-xs text-black/50">
                        {startStr} — {endStr}
                        {block.reason && <span className="ml-2 text-black/40">({block.reason})</span>}
                      </p>
                      {block.engineer_name && (
                        <p className="font-mono text-[10px] text-black/35 mt-0.5">
                          Engineer self-block — studio stays bookable with other engineers.
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteBlock(block.id)}
                    className="text-red-500 hover:text-red-700 transition-colors p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
