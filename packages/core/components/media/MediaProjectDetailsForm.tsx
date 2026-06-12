'use client';

// components/media/MediaProjectDetailsForm.tsx
//
// Project details questionnaire — collected at the END of the media
// booking flow, BEFORE the Stripe checkout call. Fields are intentionally
// flexible (mostly free text) because every project is different. The
// data lands in `media_bookings.project_details` JSONB so production
// can read it when prepping shoots / edits.
//
// State carried in from previous steps (the configurator wizard, when
// applicable) lives in sessionStorage under the key
//   `media-config:${offering.slug}`
// and is keyed by slug so the user can have multiple offerings being
// configured in different tabs without cross-pollution.

import { useState, useEffect } from 'react';
import { ArrowRight, AlertCircle } from 'lucide-react';
import type { ConfiguredComponents } from '@/lib/media-config';

const SS_KEY = (slug: string) => `media-config:${slug}`;

export default function MediaProjectDetailsForm({
  slug,
  offeringTitle,
  isConfigurable,
}: {
  slug: string;
  offeringTitle: string;
  /** Whether to look in sessionStorage for a pre-built configurator
   *  snapshot. If true and nothing is there, we fail closed and route
   *  the user back to /configure. */
  isConfigurable: boolean;
}) {
  // Form state. Defaults are empty; the form requires at least artist_name
  // + songs + vibe (the production team needs at minimum to know who, what,
  // and how-it-should-feel). Everything else is optional.
  const [projectName, setProjectName] = useState('');
  const [artistName, setArtistName] = useState('');
  const [songs, setSongs] = useState('');
  const [references, setReferences] = useState('');
  const [vibe, setVibe] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [notes, setNotes] = useState('');

  // The configurator snapshot, if applicable, recovered from sessionStorage.
  // We only need it for configurable offerings — for non-configurable, the
  // checkout API will use the offering's base price.
  const [config, setConfig] = useState<ConfiguredComponents | null>(null);
  const [missingConfig, setMissingConfig] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigurable) return;
    if (typeof window === 'undefined') return;
    const raw = window.sessionStorage.getItem(SS_KEY(slug));
    if (!raw) {
      setMissingConfig(true);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as ConfiguredComponents;
      if (parsed && parsed.selections && typeof parsed.selections === 'object') {
        setConfig(parsed);
      } else {
        setMissingConfig(true);
      }
    } catch {
      setMissingConfig(true);
    }
  }, [slug, isConfigurable]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (artistName.trim().length < 2) {
      setError('Artist name is required so we know who this is for.');
      return;
    }
    if (songs.trim().length < 2) {
      setError('Tell us about the song(s) — title or count is fine.');
      return;
    }
    if (vibe.trim().length < 2) {
      setError('A short vibe or mood note helps the team prep.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/media/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          // Pass the configurator snapshot only when we have one; the
          // checkout API tolerates a missing field for non-configurable
          // offerings.
          configured_components: config ?? undefined,
          project_details: {
            project_name: projectName.trim() || null,
            artist_name: artistName.trim(),
            songs: songs.trim(),
            references: references.trim() || null,
            vibe: vibe.trim(),
            release_date: releaseDate || null,
            notes: notes.trim() || null,
          },
        }),
      });

      if (res.status === 401) {
        window.location.href = `/login?redirect=/dashboard/media/${slug}/details`;
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to start checkout. Try again.');
        setSubmitting(false);
        return;
      }
      // Clear the sessionStorage snapshot so a back-button refresh doesn't
      // re-prompt with stale data.
      if (isConfigurable && typeof window !== 'undefined') {
        window.sessionStorage.removeItem(SS_KEY(slug));
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError('Checkout URL missing — please try again.');
        setSubmitting(false);
      }
    } catch (err) {
      console.error('[media-details] submit error:', err);
      setError('Network error — try again.');
      setSubmitting(false);
    }
  }

  // Configurable but no snapshot — push them back to /configure so they
  // don't accidentally check out with default selections + lose their
  // earlier choices.
  if (missingConfig) {
    return (
      <div className="border-2 border-yellow-300 bg-yellow-50 p-6">
        <div className="flex items-start gap-3 mb-3">
          <AlertCircle className="w-5 h-5 text-yellow-700 mt-0.5 shrink-0" />
          <div>
            <p className="font-bold mb-1">Configuration step missed</p>
            <p className="font-mono text-sm text-black/70 mb-4">
              We didn&apos;t pick up your package configuration. Hit configure first
              so the price reflects your selections — then come back here for project details.
            </p>
            <a
              href={`/dashboard/media/${slug}/configure`}
              className="inline-flex items-center gap-2 bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-accent hover:text-black no-underline"
            >
              Go to configure
              <ArrowRight className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Project name (optional)">
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder='"My EP", "Summer Single"...'
            className={inputCls}
          />
        </Field>
        <Field label="Artist name *">
          <input
            type="text"
            value={artistName}
            onChange={(e) => setArtistName(e.target.value)}
            placeholder="Name we should put on credits"
            className={inputCls}
            required
            minLength={2}
          />
        </Field>
      </div>

      <Field label="Songs *">
        <textarea
          value={songs}
          onChange={(e) => setSongs(e.target.value)}
          placeholder="Song titles, count, or a short description of what we're recording / filming."
          rows={3}
          className={inputCls}
          required
          minLength={2}
        />
      </Field>

      <Field label="Vibe / mood *">
        <textarea
          value={vibe}
          onChange={(e) => setVibe(e.target.value)}
          placeholder='"Dark + atmospheric", "warm acoustic", "high-energy hip-hop"...'
          rows={2}
          className={inputCls}
          required
          minLength={2}
        />
      </Field>

      <Field label="References (optional)">
        <textarea
          value={references}
          onChange={(e) => setReferences(e.target.value)}
          placeholder="Links or artist names — songs / videos that capture what you're going for."
          rows={2}
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Target release date (optional)">
          <input
            type="date"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Notes (optional)">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything else we should know"
            className={inputCls}
          />
        </Field>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 font-mono text-xs">
          {error}
        </div>
      )}

      <div className="pt-4 border-t border-black/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="font-mono text-xs text-black/50">
          Continuing will take you to Stripe to complete payment for{' '}
          <strong className="text-black">{offeringTitle}</strong>.
        </p>
        <button
          type="submit"
          disabled={submitting}
          className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-6 py-3 hover:bg-accent hover:text-black transition-colors inline-flex items-center gap-2 disabled:opacity-50 shrink-0"
        >
          {submitting ? 'Starting checkout…' : 'Continue to checkout'}
          {!submitting && <ArrowRight className="w-3 h-3" />}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block font-mono text-[11px] uppercase tracking-wider font-bold text-black/60 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full bg-white border-2 border-black/15 px-3 py-2 text-sm focus:border-black outline-none';
