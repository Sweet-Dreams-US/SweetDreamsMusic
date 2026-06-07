'use client';

// FeaturesNavPanel — the "Features & Navigation" section of the Studio Control
// Panel. Toggles whole features (bands/events/media) and individual nav/marketing
// pages (about/contact/engineers/blog) on/off. Studio Sessions + Beat Store are
// shown LOCKED ON (no toggle). Disabling anything opens the ConfirmDialog
// persuasion; disabling Events shows an extra "keep it on" nudge.

import { useEffect, useState } from 'react';
import { Lock, Loader2, Sparkles } from 'lucide-react';
import type { SiteSettings } from '@/lib/site-settings';
import ConfirmDialog from './ConfirmDialog';

interface ToggleDef {
  col: string;
  label: string;
  desc: string;
  get: (s: SiteSettings) => boolean;
  encouraged?: boolean;
}

const FEATURE_TOGGLES: ToggleDef[] = [
  { col: 'bands_enabled', label: 'Bands', desc: 'Public Bands page + band session booking + band hub.', get: (s) => s.bandsEnabled },
  { col: 'events_enabled', label: 'Events', desc: 'Public Events page + RSVPs.', get: (s) => s.eventsEnabled, encouraged: true },
  { col: 'media_enabled', label: 'Media', desc: 'Media services catalog (video / photo / packages).', get: (s) => s.mediaEnabled },
];

const NAV_TOGGLES: ToggleDef[] = [
  { col: 'nav_about_enabled', label: 'About page', desc: 'The /about marketing page + its nav link.', get: (s) => s.nav.about },
  { col: 'nav_contact_enabled', label: 'Contact page', desc: 'The /contact page + its nav link.', get: (s) => s.nav.contact },
  { col: 'nav_engineers_enabled', label: 'Engineers page', desc: 'The /engineers roster page + its nav link.', get: (s) => s.nav.engineers },
  { col: 'nav_blog_enabled', label: 'Blog', desc: 'The /blog + its footer link.', get: (s) => s.nav.blog },
];

const LOCKED = [
  { label: 'Studio Sessions', desc: 'Booking + pricing. The core of your studio — always on.' },
  { label: 'Beat Store', desc: 'Beats marketplace + producer applications — always on.' },
];

type PendingDisable = { col: string; label: string; kind: 'feature' | 'nav'; encouraged?: boolean };

export default function FeaturesNavPanel() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<PendingDisable | null>(null);

  useEffect(() => {
    fetch('/api/admin/site-settings')
      .then((r) => r.json())
      .then((d) => { if (d.settings) setSettings(d.settings); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save(update: Record<string, boolean>) {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/site-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      const data = await res.json();
      if (data.settings) setSettings(data.settings);
    } catch {
      /* keep previous state on failure */
    } finally {
      setSaving(false);
      setPending(null);
    }
  }

  function onToggle(def: ToggleDef, kind: 'feature' | 'nav', current: boolean) {
    if (current) {
      // Disabling → require confirmation (persuasion).
      setPending({ col: def.col, label: def.label, kind, encouraged: def.encouraged });
    } else {
      // Enabling → no friction.
      save({ [def.col]: true });
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-black/40 font-mono text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }
  if (!settings) {
    return <div className="font-mono text-sm text-red-600 py-8">Couldn&apos;t load settings.</div>;
  }
  const s = settings;

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Locked features */}
      <section>
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black/50 mb-3">Always on</h3>
        <div className="space-y-2">
          {LOCKED.map((f) => (
            <div key={f.label} className="flex items-center gap-4 border-2 border-black/10 bg-black/[0.03] p-4">
              <Lock className="w-4 h-4 text-black/40 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm font-bold">{f.label}</p>
                <p className="font-mono text-xs text-black/50 mt-0.5">{f.desc}</p>
              </div>
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-black/40 px-2 py-1 border border-black/15 rounded">Locked on</span>
            </div>
          ))}
        </div>
      </section>

      {/* Toggleable features */}
      <section>
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black/50 mb-3">Features</h3>
        <div className="space-y-2">
          {FEATURE_TOGGLES.map((f) => (
            <ToggleRow key={f.col} def={f} kind="feature" value={f.get(s)} disabled={saving} onToggle={onToggle} />
          ))}
        </div>
      </section>

      {/* Nav pages */}
      <section>
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-black/50 mb-3">Navigation pages</h3>
        <div className="space-y-2">
          {NAV_TOGGLES.map((f) => (
            <ToggleRow key={f.col} def={f} kind="nav" value={f.get(s)} disabled={saving} onToggle={onToggle} />
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={!!pending}
        tier={pending?.kind === 'feature' ? 'type-to-confirm' : 'simple'}
        tone={pending?.encouraged ? 'warning' : 'danger'}
        title={pending ? `Turn off ${pending.label}?` : ''}
        confirmWord={pending?.label.toUpperCase()}
        confirmLabel={`Turn off ${pending?.label ?? ''}`}
        cancelLabel={pending?.encouraged ? `Keep ${pending?.label} on` : 'Cancel'}
        busy={saving}
        persuasion={pending?.encouraged
          ? 'We recommend keeping Events on. An active events page drives bookings and showcases your studio — most studios see more inbound interest with it live.'
          : undefined}
        impact={pending
          ? pending.kind === 'feature'
            ? `Visitors will no longer see the ${pending.label} page or its nav link, and the page will return “not found.” Existing ${pending.label.toLowerCase()} data is kept — nothing is deleted.`
            : `The ${pending.label} will be hidden from navigation and return “not found” to visitors. You can turn it back on anytime.`
          : ''}
        onConfirm={() => { if (pending) save({ [pending.col]: false }); }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function ToggleRow({
  def, kind, value, disabled, onToggle,
}: {
  def: ToggleDef;
  kind: 'feature' | 'nav';
  value: boolean;
  disabled: boolean;
  onToggle: (def: ToggleDef, kind: 'feature' | 'nav', current: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4 border-2 border-black/10 p-4">
      <div className="flex-1 min-w-0">
        <p className="font-mono text-sm font-bold flex items-center gap-2">
          {def.label}
          {def.encouraged && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-accent">
              <Sparkles className="w-3 h-3" /> Recommended
            </span>
          )}
        </p>
        <p className="font-mono text-xs text-black/50 mt-0.5">{def.desc}</p>
        {def.encouraged && value && (
          <p className="font-mono text-[11px] text-black/40 mt-1">Encouraged — events help fill the calendar.</p>
        )}
      </div>
      <button
        role="switch"
        aria-checked={value}
        aria-label={`${value ? 'Disable' : 'Enable'} ${def.label}`}
        disabled={disabled}
        onClick={() => onToggle(def, kind, value)}
        className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${value ? 'bg-accent' : 'bg-black/20'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}
