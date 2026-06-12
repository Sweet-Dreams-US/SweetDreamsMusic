'use client';

// components/hub/RedeemBeatModal.tsx
//
// Round G1: customer redeems a beat_credit balance to claim a free
// beat license. Shows the beat catalog, lets customer pick a beat +
// license tier, submits to /api/packages/entitlements/[id]/redeem-beat.
//
// On success, customer is sent to the download page so they can grab
// their files.

import { useEffect, useState } from 'react';
import { X, Loader2, Music, AlertCircle, CheckCircle2, Search } from 'lucide-react';
import { BEAT_LICENSES, type BeatLicenseType } from '@/lib/constants';

interface BeatLite {
  id: string;
  title: string;
  bpm: number | null;
  genre: string | null;
  has_exclusive: boolean | null;
  trackout_file_path: string | null;
  cover_image_url: string | null;
  producer_name: string | null;
}

interface Entitlement {
  id: string;
  template_name: string;
  balances: Array<{
    kind: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
    quantity_granted: number;
    quantity_redeemed: number;
  }>;
}

interface Props {
  entitlement: Entitlement;
  onClose: () => void;
  onRedeemed: () => void;
}

export default function RedeemBeatModal({ entitlement, onClose, onRedeemed }: Props) {
  const [beats, setBeats] = useState<BeatLite[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedBeat, setSelectedBeat] = useState<BeatLite | null>(null);
  const [licenseType, setLicenseType] = useState<BeatLicenseType>('trackout_lease');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const beatBalance = entitlement.balances.find((b) => b.kind === 'beat_credit');
  const remaining = beatBalance ? beatBalance.quantity_granted - beatBalance.quantity_redeemed : 0;

  // Load active beats once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/beats?limit=100');
        if (cancelled) return;
        if (!res.ok) {
          setError('Could not load beat catalog.');
          return;
        }
        const body = await res.json();
        setBeats((body.beats ?? []) as BeatLite[]);
      } catch {
        if (!cancelled) setError('Network error.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function submit() {
    setError(null);
    if (!selectedBeat) {
      setError('Pick a beat first.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/packages/entitlements/${entitlement.id}/redeem-beat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beat_id: selectedBeat.id, license_type: licenseType }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || 'Redeem failed.');
        return;
      }
      setSuccess(true);
      // Land on /dashboard/purchases so they can download.
      setTimeout(() => {
        window.location.href = '/dashboard/purchases';
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  // Filter the catalog by search query.
  const q = search.trim().toLowerCase();
  const filtered = q
    ? beats.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          (b.producer_name?.toLowerCase().includes(q) ?? false) ||
          (b.genre?.toLowerCase().includes(q) ?? false),
      )
    : beats;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex items-start justify-center p-4 py-8">
        <div className="bg-white text-black w-full max-w-2xl border-2 border-black">
          <div className="border-b-2 border-black px-5 py-3 flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">Redeem Beat Credit</p>
              <h2 className="font-bold text-base truncate">{entitlement.template_name}</h2>
              <p className="font-mono text-[10px] text-black/55">
                {remaining} credit{remaining === 1 ? '' : 's'} remaining
              </p>
            </div>
            <button onClick={onClose} className="text-black/40 hover:text-black"><X className="w-4 h-4" /></button>
          </div>

          {success ? (
            <div className="px-5 py-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-3" />
              <p className="font-bold text-base mb-1">Beat claimed</p>
              <p className="font-mono text-xs text-black/65">Redirecting to your downloads…</p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {!selectedBeat ? (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/35" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search beats by title, producer, or genre…"
                      className="w-full border-2 border-black pl-9 pr-3 py-2 font-mono text-sm bg-transparent focus:border-accent focus:outline-none"
                    />
                  </div>

                  {loading ? (
                    <div className="text-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-black/40" />
                    </div>
                  ) : filtered.length === 0 ? (
                    <p className="font-mono text-xs text-black/55 italic">No beats match.</p>
                  ) : (
                    <ul className="max-h-80 overflow-y-auto border-2 border-black/15 divide-y divide-black/10">
                      {filtered.map((beat) => (
                        <li key={beat.id}>
                          <button
                            onClick={() => setSelectedBeat(beat)}
                            className="w-full text-left px-3 py-2 hover:bg-black/[0.04] inline-flex items-center gap-3"
                          >
                            <Music className="w-3.5 h-3.5 text-black/45 shrink-0" />
                            <div className="min-w-0">
                              <p className="font-bold text-xs truncate">{beat.title}</p>
                              <p className="font-mono text-[10px] text-black/55 truncate">
                                {beat.producer_name ?? '—'}
                                {beat.bpm ? ` · ${beat.bpm}bpm` : ''}
                                {beat.genre ? ` · ${beat.genre}` : ''}
                              </p>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>
                  <div className="border-2 border-black p-3 flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 min-w-0">
                      <Music className="w-4 h-4 text-black/45 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">{selectedBeat.title}</p>
                        <p className="font-mono text-[10px] text-black/55">{selectedBeat.producer_name ?? '—'}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedBeat(null)}
                      className="text-black/40 hover:text-black"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div>
                    <label className="block font-mono text-[10px] uppercase tracking-wider font-bold text-black/55 mb-2">
                      License tier
                    </label>
                    <div className="space-y-1.5">
                      {(['mp3_lease', 'trackout_lease', 'exclusive'] as BeatLicenseType[]).map((lt) => {
                        const license = BEAT_LICENSES[lt];
                        const disabled = (lt === 'exclusive' && selectedBeat.has_exclusive === false)
                          || (lt === 'trackout_lease' && !selectedBeat.trackout_file_path);
                        return (
                          <label
                            key={lt}
                            className={`flex items-start gap-2 border-2 p-2 cursor-pointer ${
                              licenseType === lt ? 'border-black bg-black/[0.03]' : 'border-black/15'
                            } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                          >
                            <input
                              type="radio"
                              name="license"
                              value={lt}
                              checked={licenseType === lt}
                              onChange={() => setLicenseType(lt)}
                              disabled={disabled}
                              className="mt-0.5"
                            />
                            <div className="min-w-0">
                              <p className="font-bold text-xs">
                                {license.name} {disabled && lt === 'exclusive' && '(already sold)'}
                                {disabled && lt === 'trackout_lease' && '(no trackout)'}
                              </p>
                              <p className="font-mono text-[10px] text-black/65">{license.description}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {error && (
                <div className="border-2 border-red-300 bg-red-50 p-3 inline-flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                  <p className="font-mono text-xs text-red-900">{error}</p>
                </div>
              )}
            </div>
          )}

          {!success && (
            <div className="border-t-2 border-black px-5 py-3 flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 border border-black/20 hover:border-black"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || !selectedBeat || remaining < 1}
                className="font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 bg-black text-white inline-flex items-center gap-2 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Music className="w-3 h-3" />}
                {busy ? 'Claiming…' : 'Claim Beat (1 credit)'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
