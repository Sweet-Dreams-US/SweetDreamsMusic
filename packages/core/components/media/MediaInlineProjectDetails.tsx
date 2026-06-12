'use client';

// components/media/MediaInlineProjectDetails.tsx
//
// Inline project-details form used inside PackageCard + AlaCarteCard.
// Round 6 reshape:
//
//   - No artist name. We know who the buyer is from their session;
//     the webhook stamps profile.display_name onto media_bookings
//     server-side.
//   - All fields are optional. Buyer can add to cart with everything
//     blank — admin reaches out by phone to plan anyway.
//   - "Songs" toggle expands a multi-row input where buyers can list
//     each song with an optional per-song note (e.g. "use this for the
//     cover art", "shorts will pull from the chorus here").
//   - Slot-aware extras: when the parent passes `slotKeys` we render
//     dedicated mini-fields for the package's actual slots — "Cover
//     art name" only appears for offerings that include cover art,
//     "Songs for shorts" only for offerings with shorts. This keeps
//     non-package items (à la carte) clean.
//
// Stateless: parent owns the value + change handler.

import { Plus, Trash2 } from 'lucide-react';
import type { MediaProjectDetails, MediaProjectSong } from '@/lib/media-cart';

export default function MediaInlineProjectDetails({
  value,
  onChange,
  slotKeys,
  showSongsByDefault = false,
}: {
  value: MediaProjectDetails;
  onChange: (v: MediaProjectDetails) => void;
  /** Slot keys present on the parent offering. Drives which extra
   *  mini-fields appear (cover_art / shorts / etc). Pass an empty array
   *  for à la carte items. */
  slotKeys?: string[];
  /** Whether the songs panel starts expanded. Packages → true; à la
   *  carte → false (tighter UI for single-item adds). */
  showSongsByDefault?: boolean;
}) {
  const set = <K extends keyof MediaProjectDetails>(k: K, v: MediaProjectDetails[K]) =>
    onChange({ ...value, [k]: v });

  const songs = value.songs_breakdown ?? [];

  function addSong() {
    set('songs_breakdown', [...songs, { title: '', notes: '' }]);
  }
  function updateSong(idx: number, field: keyof MediaProjectSong, val: string) {
    const next = songs.map((s, i) => (i === idx ? { ...s, [field]: val } : s));
    set('songs_breakdown', next);
  }
  function removeSong(idx: number) {
    set('songs_breakdown', songs.filter((_, i) => i !== idx));
  }

  // Slot-aware extra-field flags. Each slot key maps to a relevant
  // dedicated micro-input so the buyer can drop a quick name without
  // hunting through a giant notes box.
  const hasCoverArt = !!slotKeys?.some((k) => k === 'cover_art' || k === 'main_cover' || k === 'single_covers');
  const hasShorts = !!slotKeys?.some((k) => k === 'shorts' || k === 'shorts_per_song');

  // Songs panel — auto-open when packages explicitly want it OR when
  // there's already at least one row (which can happen on edit / round
  // trip from sessionStorage).
  const songsOpen = showSongsByDefault || songs.length > 0;

  return (
    <div className="space-y-3">
      <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/60">
        Project details (optional)
      </p>

      <Field label="Project name">
        <input
          type="text"
          value={value.project_name ?? ''}
          onChange={(e) => set('project_name', e.target.value)}
          placeholder='"My EP", "Summer Single"...'
          className={inputCls}
        />
      </Field>

      {/* SONGS PANEL */}
      <div className="border border-black/10 bg-black/[0.02] p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-wider font-bold text-black/70">
            Songs in this plan
          </p>
          {!songsOpen && (
            <button
              type="button"
              onClick={addSong}
              className="font-mono text-[11px] text-accent hover:underline inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add songs
            </button>
          )}
        </div>
        {songsOpen && (
          <>
            {songs.length === 0 && (
              <p className="font-mono text-[11px] text-black/45">
                Add each song you want covered. Per-song notes are optional —
                great for &quot;use this for the cover art&quot; or &quot;shorts will pull
                from this song&quot;.
              </p>
            )}
            <ul className="space-y-2">
              {songs.map((song, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={song.title}
                      onChange={(e) => updateSong(idx, 'title', e.target.value)}
                      placeholder={`Song ${idx + 1} title`}
                      className={inputCls}
                    />
                    <input
                      type="text"
                      value={song.notes ?? ''}
                      onChange={(e) => updateSong(idx, 'notes', e.target.value)}
                      placeholder="Notes (optional)"
                      className={inputCls}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSong(idx)}
                    className="text-black/40 hover:text-red-700 mt-2 shrink-0"
                    aria-label={`Remove song ${idx + 1}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={addSong}
              className="font-mono text-[11px] text-accent hover:underline inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add another song
            </button>
          </>
        )}
      </div>

      {/* SLOT-AWARE EXTRAS — only render fields relevant to the offering */}
      {hasCoverArt && (
        <Field label="Cover art name">
          <input
            type="text"
            value={value.cover_art_name ?? ''}
            onChange={(e) => set('cover_art_name', e.target.value)}
            placeholder="What's the release named?"
            className={inputCls}
          />
        </Field>
      )}
      {hasShorts && (
        <Field label="Songs to use for shorts">
          <input
            type="text"
            value={value.shorts_song_targets ?? ''}
            onChange={(e) => set('shorts_song_targets', e.target.value)}
            placeholder="Song titles or 'all of them'"
            className={inputCls}
          />
        </Field>
      )}

      <Field label="Vibe / mood">
        <input
          type="text"
          value={value.vibe ?? ''}
          onChange={(e) => set('vibe', e.target.value)}
          placeholder='"Dark + atmospheric", "warm acoustic"...'
          className={inputCls}
        />
      </Field>

      <Field label="References">
        <input
          type="text"
          value={value.references ?? ''}
          onChange={(e) => set('references', e.target.value)}
          placeholder="Links or artist names"
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Target release">
          <input
            type="date"
            value={value.release_date ?? ''}
            onChange={(e) => set('release_date', e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Notes">
          <input
            type="text"
            value={value.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Anything else"
            className={inputCls}
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-mono text-[10px] uppercase tracking-wider text-black/55 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full bg-white border-2 border-black/15 px-2.5 py-1.5 text-sm focus:border-black outline-none';
