'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, SlidersHorizontal, Music, X } from 'lucide-react';
import BeatCard, { type BeatData } from './BeatCard';
import { BEAT_GENRES } from '@/lib/constants';

interface BeatStoreClientProps {
  initialBeats: BeatData[];
}

const GENRE_OPTIONS = BEAT_GENRES.map(g => g.value);
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Most Popular' },
  { value: 'price_low', label: 'Price: Low to High' },
  { value: 'price_high', label: 'Price: High to Low' },
];

export default function BeatStoreClient({ initialBeats }: BeatStoreClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [beats, setBeats] = useState<BeatData[]>(initialBeats);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [genre, setGenre] = useState(searchParams.get('genre') || '');
  const [sampleFilter, setSampleFilter] = useState<'all' | 'original' | 'samples'>((searchParams.get('samples') as 'all' | 'original' | 'samples') || 'all');
  const [sort, setSort] = useState(searchParams.get('sort') || 'newest');
  const [showFilters, setShowFilters] = useState(!!(searchParams.get('genre') || searchParams.get('samples')));
  const [savedBeatIds, setSavedBeatIds] = useState<Set<string>>(new Set());

  // Sync filter state to URL (without page reload)
  const syncUrl = useCallback((q: string, g: string, s: string, sf: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (g) params.set('genre', g);
    if (sf && sf !== 'all') params.set('samples', sf);
    if (s && s !== 'newest') params.set('sort', s);
    const qs = params.toString();
    router.replace(qs ? `/beats?${qs}` : '/beats', { scroll: false });
  }, [router]);

  // Sync filters to URL
  useEffect(() => {
    syncUrl(search, genre, sort, sampleFilter);
  }, [search, genre, sort, sampleFilter, syncUrl]);

  // Fetch saved beats for logged-in users
  useEffect(() => {
    fetch('/api/beats/save')
      .then((r) => { if (r.ok) return r.json(); return null; })
      .then((d) => {
        if (d?.savedBeatIds) setSavedBeatIds(new Set(d.savedBeatIds));
      })
      .catch(() => {});
  }, []);

  // Client-side filtering (we could also re-fetch from API)
  const filtered = useMemo(() => {
    let result = beats;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((b) =>
        b.title.toLowerCase().includes(q) ||
        b.producer.toLowerCase().includes(q) ||
        b.genre?.toLowerCase().includes(q) ||
        b.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (genre) {
      result = result.filter((b) => b.genre?.toLowerCase() === genre.toLowerCase());
    }

    if (sampleFilter === 'original') {
      result = result.filter((b) => !b.contains_samples);
    } else if (sampleFilter === 'samples') {
      result = result.filter((b) => b.contains_samples);
    }

    // Sort
    switch (sort) {
      case 'popular':
        result = [...result].sort((a, b) => (b.lease_count || 0) - (a.lease_count || 0));
        break;
      case 'price_low':
        result = [...result].sort((a, b) => (a.mp3_lease_price || 0) - (b.mp3_lease_price || 0));
        break;
      case 'price_high':
        result = [...result].sort((a, b) => (b.mp3_lease_price || 0) - (a.mp3_lease_price || 0));
        break;
      default: // newest — already sorted from API
        break;
    }

    return result;
  }, [beats, search, genre, sampleFilter, sort]);

  // Get unique genres from beats
  const availableGenres = useMemo(() => {
    const genres = new Set(beats.map((b) => b.genre).filter(Boolean) as string[]);
    return Array.from(genres).sort();
  }, [beats]);

  async function handleToggleSave(beatId: string) {
    const res = await fetch('/api/beats/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beatId }),
    });
    if (res.ok) {
      const data = await res.json();
      setSavedBeatIds((prev) => {
        const next = new Set(prev);
        if (data.saved) next.add(beatId);
        else next.delete(beatId);
        return next;
      });
    }
  }

  function clearFilters() {
    setSearch('');
    setGenre('');
    setSampleFilter('all');
    setSort('newest');
  }

  const hasActiveFilters = search || genre || sampleFilter !== 'all' || sort !== 'newest';

  return (
    <div>
      {/* Search + Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-black/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search beats..."
            className="w-full border-2 border-black pl-10 pr-4 py-3 font-mono text-sm bg-transparent focus:border-accent focus:outline-none transition-colors"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="border-2 border-black px-3 py-3 font-mono text-xs uppercase bg-transparent focus:border-accent focus:outline-none"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`border-2 px-3 py-3 font-mono text-xs uppercase tracking-wider inline-flex items-center gap-1 transition-colors ${
              showFilters || hasActiveFilters ? 'border-accent text-accent font-bold' : 'border-black text-black hover:border-accent'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" /> Filters
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="border-2 border-black/10 p-4 mb-6 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs text-black/60 uppercase tracking-wider">Genre</p>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="font-mono text-[10px] text-accent uppercase tracking-wider inline-flex items-center gap-1">
                <X className="w-3 h-3" /> Clear all
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setGenre('')}
              className={`font-mono text-xs px-3 py-1.5 border transition-colors ${
                !genre ? 'border-accent bg-accent/10 text-accent font-bold' : 'border-black/20 text-black/50 hover:border-black/40'
              }`}
            >
              All
            </button>
            {(availableGenres.length > 0 ? availableGenres : GENRE_OPTIONS).map((g) => (
              <button
                key={g}
                onClick={() => setGenre(genre === g ? '' : g)}
                className={`font-mono text-xs px-3 py-1.5 border transition-colors ${
                  genre === g ? 'border-accent bg-accent/10 text-accent font-bold' : 'border-black/20 text-black/50 hover:border-black/40'
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          <div className="mt-3">
            <p className="font-mono text-xs text-black/60 uppercase tracking-wider mb-2">Sample Status</p>
            <div className="flex gap-2">
              {(['all', 'original', 'samples'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setSampleFilter(f)}
                  className={`font-mono text-xs px-3 py-1.5 border transition-colors ${
                    sampleFilter === f ? 'border-accent bg-accent/10 text-accent font-bold' : 'border-black/20 text-black/50 hover:border-black/40'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'original' ? '✓ Original' : '⚠ Has Samples'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Results count */}
      <p className="font-mono text-[10px] text-black/30 uppercase tracking-wider mb-4">
        {filtered.length} beat{filtered.length !== 1 ? 's' : ''}
        {hasActiveFilters && ' (filtered)'}
      </p>

      {/* Beat grid */}
      {filtered.length === 0 ? (
        <div className="border-2 border-black/10 p-12 text-center">
          <Music className="w-12 h-12 text-black/10 mx-auto mb-4" strokeWidth={1} />
          <p className="font-mono text-sm text-black/40">
            {hasActiveFilters ? 'No beats match your filters.' : 'No beats available yet. Check back soon.'}
          </p>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="font-mono text-xs text-accent mt-2 hover:underline">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((beat) => (
            <BeatCard
              key={beat.id}
              beat={beat}
              isSaved={savedBeatIds.has(beat.id)}
              onToggleSave={handleToggleSave}
            />
          ))}
        </div>
      )}
    </div>
  );
}
