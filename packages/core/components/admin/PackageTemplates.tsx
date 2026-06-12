'use client';

// components/admin/PackageTemplates.tsx
//
// Round B-enabled list view: lists templates and opens the calculator
// for create / edit. Archived templates are still shown (faded) so
// admin can see history; "Archive" is the soft-delete action.

import { useEffect, useState, useCallback } from 'react';
import { Loader2, AlertCircle, Package, Crown, Users, Clock, Film, Music, Archive, Plus, Pencil, Send, FileText, Layers, Inbox } from 'lucide-react';
import PackageCalculator, { type PackageTemplateForEdit } from './PackageCalculator';
import GenerateQuoteModal from './GenerateQuoteModal';
import PackageQuotes from './PackageQuotes';
import PackageAddonRequests from './PackageAddonRequests';

interface TemplateLine {
  id: string;
  kind: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
  quantity: number;
  media_offering_id: string | null;
  full_price_cents: number;
  package_value_cents: number;
  notes: string | null;
  sort_order: number;
}

interface PackageTemplate {
  id: string;
  name: string;
  description: string | null;
  slug: string | null;
  audience: 'solo' | 'band';
  is_membership: boolean;
  duration_days: number | null;
  membership_months: number | null;
  price_cents: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  lines: TemplateLine[];
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function lineKindLabel(line: TemplateLine): string {
  switch (line.kind) {
    case 'studio_hours':
      return `${line.quantity} studio hour${line.quantity === 1 ? '' : 's'}`;
    case 'media_offering':
      return line.notes || `Media offering × ${line.quantity}`;
    case 'beat_credit':
      return `${line.quantity} beat credit${line.quantity === 1 ? '' : 's'}`;
    case 'custom':
      return line.notes || `Custom × ${line.quantity}`;
  }
}

function lineKindIcon(kind: TemplateLine['kind']) {
  switch (kind) {
    case 'studio_hours': return Clock;
    case 'media_offering': return Film;
    case 'beat_credit': return Music;
    case 'custom': return Package;
  }
}

// Convert a PackageTemplate (server shape) → PackageTemplateForEdit
// (calculator-friendly shape with localId on each line).
function toEditShape(t: PackageTemplate): PackageTemplateForEdit {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    audience: t.audience,
    is_membership: t.is_membership,
    duration_days: t.duration_days,
    membership_months: t.membership_months,
    price_cents: t.price_cents,
    is_active: t.is_active,
    // The calculator's EditableLine shape ignores DB sort_order and uses
    // array position instead — server lines arrive pre-sorted by sort_order
    // (the API's GET orders by it), so map order is correct.
    lines: t.lines.map((l) => ({
      localId: `srv-${l.id}`,
      kind: l.kind,
      quantity: l.quantity,
      full_price_cents: l.full_price_cents,
      package_value_cents: l.package_value_cents,
      media_offering_id: l.media_offering_id,
      notes: l.notes,
    })),
  };
}

type SubTab = 'templates' | 'quotes' | 'addon-requests';

export default function PackageTemplates() {
  const [subTab, setSubTab] = useState<SubTab>('templates');
  const [templates, setTemplates] = useState<PackageTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PackageTemplateForEdit | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  // Generate-quote-from-template modal: holds the template being quoted from.
  const [quotingFrom, setQuotingFrom] = useState<PackageTemplate | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/packages/templates', { cache: 'no-store' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || 'Could not load package templates.');
        return;
      }
      const body = await res.json();
      setTemplates((body.templates ?? []) as PackageTemplate[]);
    } catch {
      setError('Network error while loading templates.');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function archive(id: string) {
    if (!confirm('Archive this template? Existing entitlements continue working; new quotes will be blocked.')) return;
    setArchiving(id);
    try {
      const res = await fetch(`/api/admin/packages/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body?.error || 'Archive failed.');
        return;
      }
      await refresh();
    } finally {
      setArchiving(null);
    }
  }

  if (error) {
    return (
      <div className="border-2 border-red-300 bg-red-50 p-4 inline-flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-red-700" />
        <p className="font-mono text-sm text-red-900">{error}</p>
      </div>
    );
  }

  if (templates === null) {
    return (
      <div className="text-center py-16">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-black/40" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + primary action */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-2">
            Admin · Packages & Memberships
          </p>
          <h1 className="text-heading-xl mb-2">PACKAGES</h1>
          <p className="font-mono text-xs text-black/60 max-w-2xl">
            One-time bundles and 3-month memberships you can quote to customers.
            All session valuations use Studio B rate as the baseline. Studio A,
            Sweet 4, same-day, and night surcharges are paid separately at
            booking time.
          </p>
        </div>
        {subTab === 'templates' && (
          <button
              onClick={() => setEditing({
              // Inline construction so we can set the seed without mutating
              // the calculator's blankTemplate(). Calculator handles the rest.
              name: '',
              description: '',
              audience: 'solo',
              is_membership: false,
              duration_days: 60,
              membership_months: 3,
              price_cents: 0,
              is_active: true,
              lines: [],
            })}
            className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 hover:bg-black/80 transition-colors inline-flex items-center gap-2"
          >
            <Plus className="w-3.5 h-3.5" /> New Template
          </button>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-black/15">
        <button
          onClick={() => setSubTab('templates')}
          className={`font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 border-b-2 transition-colors inline-flex items-center gap-1.5 ${
            subTab === 'templates' ? 'border-accent text-accent' : 'border-transparent text-black/55 hover:text-black'
          }`}
        >
          <Layers className="w-3.5 h-3.5" /> Templates ({templates.length})
        </button>
        <button
          onClick={() => setSubTab('quotes')}
          className={`font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 border-b-2 transition-colors inline-flex items-center gap-1.5 ${
            subTab === 'quotes' ? 'border-accent text-accent' : 'border-transparent text-black/55 hover:text-black'
          }`}
        >
          <FileText className="w-3.5 h-3.5" /> Quotes
        </button>
        <button
          onClick={() => setSubTab('addon-requests')}
          className={`font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 border-b-2 transition-colors inline-flex items-center gap-1.5 ${
            subTab === 'addon-requests' ? 'border-accent text-accent' : 'border-transparent text-black/55 hover:text-black'
          }`}
        >
          <Inbox className="w-3.5 h-3.5" /> Add-on Requests
        </button>
      </div>

      {subTab === 'quotes' ? (
        <PackageQuotes />
      ) : subTab === 'addon-requests' ? (
        <PackageAddonRequests />
      ) : (
      /* Body — Templates tab */
      <>
      {/* Body */}
      {templates.length === 0 ? (
        <div className="border-2 border-dashed border-black/10 p-12 text-center">
          <Package className="w-8 h-8 text-black/30 mx-auto mb-3" />
          <p className="font-mono text-sm text-black/60 mb-2">
            No package templates yet.
          </p>
          <p className="font-mono text-[11px] text-black/45 max-w-md mx-auto">
            Click "New Template" to build a bundle. Round C will add the quoting
            flow — for now you're shaping the catalog admin will draw from later.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {templates.map((tpl) => {
            const totalFullPrice = tpl.lines.reduce((s, l) => s + l.full_price_cents, 0);
            const grossRevenue = tpl.is_membership
              ? tpl.price_cents * (tpl.membership_months ?? 0)
              : tpl.price_cents;
            const discountCents = Math.max(0, totalFullPrice - grossRevenue);
            const discountPct = totalFullPrice > 0
              ? Math.round((discountCents / totalFullPrice) * 100)
              : 0;
            return (
              <li key={tpl.id}>
                <div className={`border-2 p-5 ${tpl.is_active ? 'border-black/15' : 'border-black/5 bg-black/[0.02]'}`}>
                  <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-bold text-base">{tpl.name}</h3>
                        {tpl.is_membership && (
                          <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-accent text-black font-bold inline-flex items-center gap-1">
                            <Crown className="w-2.5 h-2.5" />
                            Membership
                          </span>
                        )}
                        {tpl.audience === 'band' && (
                          <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-black/30 font-bold inline-flex items-center gap-1">
                            <Users className="w-2.5 h-2.5" />
                            Band
                          </span>
                        )}
                        {!tpl.is_active && (
                          <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-black/10 text-black/50 font-bold inline-flex items-center gap-1">
                            <Archive className="w-2.5 h-2.5" />
                            Archived
                          </span>
                        )}
                      </div>
                      {tpl.description && (
                        <p className="font-mono text-xs text-black/65">{tpl.description}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-black/50">
                        {tpl.is_membership ? 'Per month' : 'One-time'}
                      </p>
                      <p className="font-bold text-lg">{formatMoney(tpl.price_cents)}</p>
                      {tpl.is_membership && tpl.membership_months && (
                        <p className="font-mono text-[10px] text-black/50">
                          × {tpl.membership_months} months ({formatMoney(grossRevenue)})
                        </p>
                      )}
                      {discountCents > 0 && (
                        <p className="font-mono text-[10px] text-accent font-bold mt-1">
                          {discountPct}% off retail
                        </p>
                      )}
                    </div>
                  </div>

                  {tpl.lines.length > 0 && (
                    <div className="border-t border-black/10 pt-3 mt-3">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-black/45 mb-2">
                        Includes
                      </p>
                      <ul className="space-y-1">
                        {tpl.lines.map((line) => {
                          const Icon = lineKindIcon(line.kind);
                          return (
                            <li key={line.id} className="flex items-center justify-between gap-3 text-sm">
                              <div className="inline-flex items-center gap-2 min-w-0">
                                <Icon className="w-3.5 h-3.5 text-black/45 shrink-0" />
                                <span className="font-mono text-xs truncate">{lineKindLabel(line)}</span>
                              </div>
                              <div className="font-mono text-[10px] text-black/45 shrink-0">
                                Retail {formatMoney(line.full_price_cents)}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Row actions */}
                  <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-black/10 flex-wrap">
                    {tpl.is_active && (
                      <button
                        onClick={() => setQuotingFrom(tpl)}
                        className="font-mono text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 bg-black text-white inline-flex items-center gap-1.5"
                      >
                        <Send className="w-3 h-3" />
                        Quote To Customer
                      </button>
                    )}
                    <button
                      onClick={() => setEditing(toEditShape(tpl))}
                      className="font-mono text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 border border-black/20 hover:border-black inline-flex items-center gap-1.5"
                    >
                      <Pencil className="w-3 h-3" />
                      Edit
                    </button>
                    {tpl.is_active && (
                      <button
                        onClick={() => archive(tpl.id)}
                        disabled={archiving === tpl.id}
                        className="font-mono text-[10px] uppercase tracking-wider font-bold px-3 py-1.5 border border-black/20 hover:border-red-700 hover:text-red-700 inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {archiving === tpl.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Archive className="w-3 h-3" />
                        )}
                        Archive
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      </>
      )}

      {editing && (
        <PackageCalculator
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {quotingFrom && (
        <GenerateQuoteModal
          template={{
            id: quotingFrom.id,
            name: quotingFrom.name,
            audience: quotingFrom.audience,
            is_membership: quotingFrom.is_membership,
            membership_months: quotingFrom.membership_months,
            duration_days: quotingFrom.duration_days,
            price_cents: quotingFrom.price_cents,
          }}
          onClose={() => setQuotingFrom(null)}
          onCreated={() => {
            setQuotingFrom(null);
            // Jump to the Quotes tab so admin sees what they just made.
            setSubTab('quotes');
          }}
        />
      )}
    </div>
  );
}
