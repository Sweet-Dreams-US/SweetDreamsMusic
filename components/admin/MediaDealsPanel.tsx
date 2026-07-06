'use client';

// components/admin/MediaDealsPanel.tsx — manage promotional deals (mounted at
// the top of the Media Catalog tab). Create a deal by picking a fixed-price
// offering + a marketing title/tagline + special price; while active, every
// artist-facing surface shows/charges the deal price and promotes it with a
// red banner (public /media + hub Media tab). The offering's real price is
// never edited — toggling the deal off restores it instantly.

import { useCallback, useEffect, useState } from 'react';
import { Flame, Trash2 } from 'lucide-react';
import { formatCents } from '@/lib/utils';

type Deal = {
  id: string;
  offering_id: string;
  title: string;
  tagline: string | null;
  deal_price_cents: number;
  active: boolean;
};
type OfferingOpt = { id: string; slug: string; title: string; price_cents: number | null; is_active: boolean };

export default function MediaDealsPanel() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [offerings, setOfferings] = useState<OfferingOpt[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ offering_id: '', title: '', tagline: '', price: '' });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/media/deals', { cache: 'no-store' });
      const body = await res.json();
      if (res.ok) { setDeals(body.deals ?? []); setOfferings(body.offerings ?? []); }
    } catch { /* panel is additive */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const offeringById = new Map(offerings.map((o) => [o.id, o]));

  async function createDeal() {
    const priceCents = Math.round(parseFloat(form.price) * 100);
    if (!form.offering_id || !form.title.trim() || !Number.isInteger(priceCents) || priceCents <= 0) {
      setMsg('Pick a product, give the deal a title, and set a price.');
      return;
    }
    setBusy(true);
    setMsg('');
    const res = await fetch('/api/admin/media/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offering_id: form.offering_id,
        title: form.title.trim(),
        tagline: form.tagline.trim(),
        deal_price_cents: priceCents,
      }),
    });
    const body = await res.json().catch(() => null);
    setMsg(res.ok ? 'Deal created — it is live on the site now.' : body?.error || 'Failed to create deal');
    if (res.ok) setForm({ offering_id: '', title: '', tagline: '', price: '' });
    setBusy(false);
    load();
  }

  async function toggle(deal: Deal) {
    await fetch('/api/admin/media/deals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deal.id, active: !deal.active }),
    }).catch(() => null);
    load();
  }

  async function remove(deal: Deal) {
    if (!confirm(`Delete the deal "${deal.title}"? The offering returns to its normal price.`)) return;
    await fetch('/api/admin/media/deals', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deal.id }),
    }).catch(() => null);
    load();
  }

  return (
    <div className="border-2 border-red-600 mb-8">
      <div className="bg-red-600 text-white px-4 py-2.5 flex items-center gap-2">
        <Flame className="w-4 h-4" />
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider">Deals &amp; Specials</h3>
        <span className="font-mono text-[10px] text-white/75">
          Active deals override the product&apos;s price everywhere artists see it + show a red promo banner
        </span>
      </div>
      <div className="p-4 space-y-4">
        {/* Create */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <select
            value={form.offering_id}
            onChange={(e) => setForm((f) => ({ ...f, offering_id: e.target.value }))}
            className="border border-black/20 px-2 py-2 font-mono text-xs lg:col-span-1"
          >
            <option value="">Pick a product…</option>
            {offerings.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title} ({o.price_cents != null ? formatCents(o.price_cents) : '—'}){o.is_active ? '' : ' [inactive]'}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Deal title (e.g. Music Video Special)"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="border border-black/20 px-3 py-2 font-mono text-xs lg:col-span-1"
          />
          <input
            type="text"
            placeholder="Tagline (optional)"
            value={form.tagline}
            onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
            className="border border-black/20 px-3 py-2 font-mono text-xs lg:col-span-1"
          />
          <input
            type="number"
            min="1"
            step="0.01"
            placeholder="Deal price ($)"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            className="border border-black/20 px-3 py-2 font-mono text-xs lg:col-span-1"
          />
          <button
            onClick={createDeal}
            disabled={busy}
            className="bg-red-600 text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-red-700 transition-colors disabled:opacity-50 lg:col-span-1"
          >
            {busy ? 'Creating…' : 'Launch deal'}
          </button>
        </div>
        {msg && <p className="font-mono text-xs text-black/60">{msg}</p>}

        {/* Existing */}
        {deals.length > 0 && (
          <div className="space-y-2">
            {deals.map((d) => {
              const o = offeringById.get(d.offering_id);
              return (
                <div key={d.id} className={`border p-3 flex flex-wrap items-center gap-3 ${d.active ? 'border-red-400 bg-red-50/40' : 'border-black/10 opacity-60'}`}>
                  <div className="flex-1 min-w-[200px]">
                    <p className="font-mono text-sm font-bold">
                      {d.title} — {formatCents(d.deal_price_cents)}
                      {o?.price_cents != null && o.price_cents !== d.deal_price_cents && (
                        <span className="text-black/40 line-through ml-2 font-normal">{formatCents(o.price_cents)}</span>
                      )}
                    </p>
                    <p className="font-mono text-[11px] text-black/50">
                      {o ? `${o.title} (${o.slug})` : d.offering_id}{d.tagline ? ` · ${d.tagline}` : ''}
                    </p>
                  </div>
                  <label className="font-mono text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={d.active} onChange={() => toggle(d)} className="accent-red-600 w-4 h-4" />
                    {d.active ? 'Live' : 'Off'}
                  </label>
                  <button onClick={() => remove(d)} aria-label="Delete deal" className="text-red-600 hover:bg-red-50 p-1.5 rounded">
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
