'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';

/**
 * Minimal "new band" form: just enough to create the record. Cover image, bio,
 * social links, etc. all happen after on the edit page — getting a band
 * created should be two fields and a click.
 */
export default function CreateBandForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [genre, setGenre] = useState('');
  const [hometown, setHometown] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Band name is required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/bands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: name.trim(),
          genre: genre.trim() || null,
          hometown: hometown.trim() || null,
          is_public: isPublic,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create band');
      }

      // Land them in the new band's hub so they can invite members next.
      router.push(`/dashboard/bands/${data.band.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="border-2 border-red-500 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="font-mono text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Band name */}
      <div>
        <label htmlFor="band-name" className="font-mono text-xs font-bold uppercase tracking-wider block mb-2">
          Band name *
        </label>
        <input
          id="band-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          placeholder="The Sweet Dreamers"
          className="w-full border-2 border-black px-4 py-3 font-mono text-base focus:outline-none focus:border-accent"
          disabled={submitting}
        />
        <p className="font-mono text-xs text-black/50 mt-1.5">
          This is the display name on your public band page.
        </p>
      </div>

      {/* Genre */}
      <div>
        <label htmlFor="band-genre" className="font-mono text-xs font-bold uppercase tracking-wider block mb-2">
          Genre
        </label>
        <input
          id="band-genre"
          type="text"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          maxLength={60}
          placeholder="Indie rock, hip-hop, soul..."
          className="w-full border-2 border-black/20 px-4 py-3 font-mono text-base focus:outline-none focus:border-accent"
          disabled={submitting}
        />
      </div>

      {/* Hometown */}
      <div>
        <label htmlFor="band-hometown" className="font-mono text-xs font-bold uppercase tracking-wider block mb-2">
          Hometown
        </label>
        <input
          id="band-hometown"
          type="text"
          value={hometown}
          onChange={(e) => setHometown(e.target.value)}
          maxLength={80}
          placeholder="Fort Wayne, IN"
          className="w-full border-2 border-black/20 px-4 py-3 font-mono text-base focus:outline-none focus:border-accent"
          disabled={submitting}
        />
      </div>

      {/* Visibility */}
      <div>
        <span className="font-mono text-xs font-bold uppercase tracking-wider block mb-3">
          Visibility
        </span>
        <div className="space-y-2">
          <label className="flex items-start gap-3 border-2 border-black/10 p-4 cursor-pointer hover:border-black/30 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/5">
            <input
              type="radio"
              name="visibility"
              checked={isPublic}
              onChange={() => setIsPublic(true)}
              className="mt-1 accent-black"
              disabled={submitting}
            />
            <div>
              <p className="font-mono text-sm font-bold">Public</p>
              <p className="font-mono text-xs text-black/60 mt-0.5">
                Listed on sweetdreamsmusic.com/bands/[slug]. Anyone can find your page.
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 border-2 border-black/10 p-4 cursor-pointer hover:border-black/30 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/5">
            <input
              type="radio"
              name="visibility"
              checked={!isPublic}
              onChange={() => setIsPublic(false)}
              className="mt-1 accent-black"
              disabled={submitting}
            />
            <div>
              <p className="font-mono text-sm font-bold">Private</p>
              <p className="font-mono text-xs text-black/60 mt-0.5">
                Band hub works for members only. No public page. You can flip this later.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Submit */}
      <div className="pt-4">
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-8 py-4 hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Creating...
            </>
          ) : (
            'Create Band'
          )}
        </button>
        <p className="font-mono text-xs text-black/50 mt-3">
          You&apos;ll be able to add a profile picture, cover image, bio, and social links after your band is created.
        </p>
      </div>
    </form>
  );
}
