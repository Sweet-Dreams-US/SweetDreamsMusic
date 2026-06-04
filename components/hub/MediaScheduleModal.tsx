'use client';

// Artist schedules a media shoot against an owned credit (Phase 5). Pick a
// date/time (≥48h out, enforced both here and server-side) + type the vision.
// No studio room, no videographer — the media team confirms and plans. POSTs
// to /api/media/credits/schedule-request.
//
// Time handling: the inputs are studio-local (Eastern) wall-clock; the server
// converts to true UTC. The 48h helper is computed in studio-local too.

import { useState } from 'react';
import { X, Sparkles, AlertTriangle } from 'lucide-react';
import { CREDIT_KIND_LABELS, defaultDurationHoursForCreditKind, type CreditKind } from '@/lib/media-credits';
import { violates48hLead } from '@/lib/media-scheduling';
import { studioInputToUtcISO, toStudioInputValue } from '@/lib/studio-time';

interface SchedulableCredit {
  id: string;
  credit_kind: CreditKind;
  tier: string | null;
  remaining: number;
}

export default function MediaScheduleModal({
  credit,
  onClose,
  onScheduled,
}: {
  credit: SchedulableCredit;
  onClose: () => void;
  onScheduled: () => void;
}) {
  // Earliest selectable slot = the first clean hour at least 48h out, in
  // studio-local terms. Rounding up to the hour keeps the picker tidy and
  // guarantees the value is ≥48h (never rounds below the threshold).
  const minStudio = (() => {
    const d = new Date(Date.now() + 48 * 60 * 60 * 1000);
    if (d.getMinutes() !== 0 || d.getSeconds() !== 0) d.setHours(d.getHours() + 1);
    d.setMinutes(0, 0, 0);
    return toStudioInputValue(d.toISOString()); // "YYYY-MM-DDTHH:MM" Eastern
  })();

  // Single datetime-local control (was two clunky native pickers that let you
  // half-fill and blocked submit). Prefilled to the earliest valid slot.
  const [dt, setDt] = useState(minStudio);
  const [vision, setVision] = useState('');
  const [location, setLocation] = useState<'studio' | 'external'>('studio');
  const [externalText, setExternalText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const durationHours = defaultDurationHoursForCreditKind(credit.credit_kind);

  // Live 48h check on the chosen datetime.
  const chosenUtc = dt ? studioInputToUtcISO(dt) : null;
  const tooSoon = chosenUtc ? violates48hLead(chosenUtc) : false;

  async function submit() {
    setError('');
    if (!dt) { setError('Pick a date and time.'); return; }
    if (tooSoon) { setError('Media shoots must be at least 48 hours out.'); return; }
    if (vision.trim().length < 3) { setError('Tell the team your vision (a sentence is fine).'); return; }
    // datetime-local is "YYYY-MM-DDTHH:MM" — split for the API (date + start_time).
    const [date, time] = dt.split('T');
    setSaving(true);
    try {
      const res = await fetch('/api/media/credits/schedule-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credit_id: credit.id,
          date,
          start_time: time,
          vision: vision.trim(),
          location,
          external_location_text: location === 'external' ? externalText.trim() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not submit request'); return; }
      onScheduled();
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white border-2 border-black max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b-2 border-black/10">
          <div>
            <h3 className="font-mono text-lg font-bold uppercase tracking-wider">
              Schedule {CREDIT_KIND_LABELS[credit.credit_kind]}
            </h3>
            <p className="font-mono text-xs text-black/60 mt-0.5">
              {credit.remaining} remaining{credit.tier ? ` · ${credit.tier}` : ''} · ~{durationHours}hr shoot
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-black/5" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* 48h helper — always visible */}
          <div className="bg-accent/10 border border-accent/30 px-3 py-2 font-mono text-[11px] text-black/70">
            Shoots are booked at least <strong>48 hours</strong> in advance so the team can plan.
          </div>

          <div>
            <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1">
              Date &amp; time
            </label>
            <input
              type="datetime-local"
              value={dt}
              min={minStudio}
              step={900}
              onChange={(e) => setDt(e.target.value)}
              className="w-full border-2 border-black/20 px-3 py-3 font-mono text-sm focus:border-accent focus:outline-none"
            />
            <p className="font-mono text-[10px] text-black/45 mt-1">Fort Wayne (Eastern) time.</p>
          </div>

          {tooSoon && (
            <p className="font-mono text-[11px] text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> That&apos;s under 48 hours out — pick a later time.
            </p>
          )}

          {/* Location */}
          <div>
            <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1">Location</label>
            <div className="flex gap-2">
              {(['studio', 'external'] as const).map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setLocation(loc)}
                  className={`flex-1 font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 border-2 transition-colors ${
                    location === loc ? 'bg-black text-white border-black' : 'border-black/20 hover:border-black'
                  }`}
                >
                  {loc === 'studio' ? 'At the Studio' : 'On Location'}
                </button>
              ))}
            </div>
            {location === 'external' && (
              <input
                type="text"
                value={externalText}
                onChange={(e) => setExternalText(e.target.value)}
                placeholder="Where? (address / venue)"
                className="w-full mt-2 border-2 border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
              />
            )}
          </div>

          {/* Vision */}
          <div>
            <label className="font-mono text-[10px] text-black/60 uppercase tracking-wider block mb-1 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> Your vision / goals
            </label>
            <textarea
              value={vision}
              onChange={(e) => setVision(e.target.value)}
              rows={4}
              placeholder="What do you want this shoot to feel like? References, locations, looks, the story…"
              className="w-full border-2 border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none resize-vertical"
            />
            <p className="font-mono text-[10px] text-black/50 mt-1">
              The media team reads this before they call you to plan.
            </p>
          </div>

          {error && <p className="font-mono text-xs text-red-600">{error}</p>}

          <button
            onClick={submit}
            disabled={saving || tooSoon}
            className="w-full bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-5 py-3 hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Sending request…' : 'Request this shoot'}
          </button>
          <p className="font-mono text-[10px] text-black/50 text-center">
            This sends a request — the media team confirms the time and reaches out to plan.
          </p>
        </div>
      </div>
    </div>
  );
}
