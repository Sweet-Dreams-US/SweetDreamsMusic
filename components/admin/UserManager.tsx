'use client';

import { useState, useEffect, useMemo } from 'react';
import { Search, ExternalLink, Shield, Wrench, Music, User, Check, Users as UsersIcon, Eye, EyeOff } from 'lucide-react';
import { fmtStampDate } from '@/lib/studio-time';

interface Profile {
  id: string;
  user_id: string;
  display_name: string;
  public_profile_slug: string;
  profile_picture_url: string | null;
  role: string;
  email: string | null;
  is_producer: boolean;
  producer_name: string | null;
  files_count: number;
  notes_count: number;
}

interface Band {
  id: string;
  slug: string;
  display_name: string;
  profile_picture_url: string | null;
  genre: string | null;
  hometown: string | null;
  is_public: boolean;
  member_count: number;
  created_at: string;
  creator: {
    user_id: string;
    display_name: string | null;
    email: string | null;
    public_profile_slug: string | null;
  } | null;
}

const ROLE_OPTIONS = [
  { value: 'user', label: 'User', icon: User },
  { value: 'engineer', label: 'Engineer', icon: Wrench },
  { value: 'admin', label: 'Admin', icon: Shield },
];

type FilterKey = 'all' | 'user' | 'engineer' | 'admin' | 'producer' | 'bands';

export default function UserManager() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Bands are loaded lazily — only when the admin clicks the Bands tab —
  // because the user-profile list is the dominant traffic pattern, and
  // pulling bands + member-count joins on every page mount would add
  // ~150ms to the common case. Once loaded, we cache them on this
  // component instance so toggling between tabs is instant.
  const [bands, setBands] = useState<Band[] | null>(null);
  const [bandsLoading, setBandsLoading] = useState(false);

  useEffect(() => {
    fetch('/api/admin/library/clients')
      .then((r) => r.json())
      .then((d) => setProfiles(d.clients || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (filter !== 'bands') return;
    if (bands !== null) return; // already loaded
    setBandsLoading(true);
    fetch('/api/admin/bands')
      .then((r) => r.json())
      .then((d) => setBands(d.bands || []))
      .catch(() => setBands([]))
      .finally(() => setBandsLoading(false));
  }, [filter, bands]);

  async function updateRole(profileId: string, role: string) {
    setUpdatingId(profileId);
    const res = await fetch('/api/admin/users/update-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, role }),
    });
    if (res.ok) {
      setProfiles((prev) => prev.map((p) => p.id === profileId ? { ...p, role } : p));
    }
    setUpdatingId(null);
  }

  async function toggleProducer(profileId: string, currentValue: boolean) {
    setUpdatingId(profileId);
    const res = await fetch('/api/admin/users/update-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, is_producer: !currentValue }),
    });
    if (res.ok) {
      setProfiles((prev) => prev.map((p) => p.id === profileId ? { ...p, is_producer: !currentValue } : p));
    }
    setUpdatingId(null);
  }

  const filtered = useMemo(() => {
    let result = profiles;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((p) =>
        p.display_name?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q) ||
        p.producer_name?.toLowerCase().includes(q)
      );
    }
    if (filter === 'producer') {
      result = result.filter((p) => p.is_producer);
    } else if (filter !== 'all') {
      result = result.filter((p) => p.role === filter);
    }
    return result;
  }, [profiles, search, filter]);

  const counts = useMemo(() => ({
    all: profiles.length,
    user: profiles.filter((p) => p.role === 'user').length,
    engineer: profiles.filter((p) => p.role === 'engineer').length,
    admin: profiles.filter((p) => p.role === 'admin').length,
    producer: profiles.filter((p) => p.is_producer).length,
    // Count uses the eager-loaded value when present; null = "not yet
    // fetched" so we render '—' rather than 0 to avoid implying empty.
    bands: bands?.length ?? null,
  }), [profiles, bands]);

  const filteredBands = useMemo(() => {
    if (!bands) return [];
    if (!search.trim()) return bands;
    const q = search.toLowerCase();
    return bands.filter((b) =>
      b.display_name?.toLowerCase().includes(q) ||
      b.slug?.toLowerCase().includes(q) ||
      b.genre?.toLowerCase().includes(q) ||
      b.hometown?.toLowerCase().includes(q) ||
      b.creator?.display_name?.toLowerCase().includes(q) ||
      b.creator?.email?.toLowerCase().includes(q),
    );
  }, [bands, search]);

  const isBandsTab = filter === 'bands';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-heading-md">
          {isBandsTab
            ? `BANDS (${counts.bands ?? '—'})`
            : `USERS (${profiles.length})`}
        </h2>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-0 border-b border-black/10 mb-6 overflow-x-auto">
        {([
          { key: 'all', label: 'All' },
          { key: 'user', label: 'Users' },
          { key: 'engineer', label: 'Engineers' },
          { key: 'admin', label: 'Admins' },
          { key: 'producer', label: 'Producers' },
          { key: 'bands', label: 'Bands' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`font-mono text-xs uppercase tracking-wider px-4 py-3 border-b-2 transition-colors flex-shrink-0 ${
              filter === tab.key
                ? 'border-accent text-black font-bold'
                : 'border-transparent text-black/40 hover:text-black/70'
            }`}
          >
            {tab.label} ({counts[tab.key] ?? '—'})
          </button>
        ))}
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-black/30" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={isBandsTab
            ? 'Search bands by name, slug, genre, hometown, or creator…'
            : 'Search by name, email, or producer name…'}
          className="w-full border-2 border-black/20 pl-10 pr-4 py-3 font-mono text-sm focus:border-accent focus:outline-none"
        />
      </div>

      {isBandsTab ? (
        bandsLoading || bands === null ? (
          <p className="font-mono text-sm text-black/40">Loading bands…</p>
        ) : (
          <div className="space-y-2">
            {filteredBands.map((band) => (
              <div key={band.id} className="border border-black/10 p-4 hover:border-black/20 transition-colors">
                <div className="flex items-center gap-4">
                  {/* Avatar — band picture or generic users icon */}
                  <div className="w-10 h-10 bg-black/5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {band.profile_picture_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={band.profile_picture_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <UsersIcon className="w-5 h-5 text-black/30" />
                    )}
                  </div>

                  {/* Band info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-mono text-sm font-semibold truncate" title={band.display_name}>
                        {band.display_name}
                      </p>
                      {/* Public/private — visible badge so admins can spot
                          drafts that haven't been published yet. */}
                      <span
                        className={`font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 inline-flex items-center gap-1 ${
                          band.is_public
                            ? 'bg-green-50 text-green-700 border border-green-200'
                            : 'bg-black/5 text-black/60 border border-black/10'
                        }`}
                      >
                        {band.is_public ? (
                          <>
                            <Eye className="w-3 h-3" /> Public
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3 h-3" /> Private
                          </>
                        )}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-black/50 truncate">
                      {band.member_count} member{band.member_count !== 1 ? 's' : ''}
                      {band.genre && ` · ${band.genre}`}
                      {band.hometown && ` · ${band.hometown}`}
                    </p>
                    <p className="font-mono text-[10px] text-black/40 truncate mt-0.5">
                      Created {fmtStampDate(band.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                      {band.creator && (
                        <>
                          {' · by '}
                          {band.creator.public_profile_slug ? (
                            <a
                              href={`/u/${band.creator.public_profile_slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:underline no-underline"
                            >
                              {band.creator.display_name || band.creator.email || 'unknown'}
                            </a>
                          ) : (
                            <span>{band.creator.display_name || band.creator.email || 'unknown'}</span>
                          )}
                        </>
                      )}
                    </p>
                  </div>

                  {/* Public band page link — only when public, since the
                      private/admin route is /dashboard/bands/[id] and that
                      requires the band owner's session. The public page
                      at /bands/[slug] returns 404 for private bands so we
                      hide the link to avoid sending admins to a dead end. */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {band.is_public && band.slug && (
                      <a
                        href={`/bands/${band.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline p-1.5 flex-shrink-0"
                        title="View public band page"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {filteredBands.length === 0 && (
              <p className="font-mono text-sm text-black/30 text-center py-8">
                {bands?.length ? 'No bands match your search.' : 'No bands yet.'}
              </p>
            )}
          </div>
        )
      ) : loading ? (
        <p className="font-mono text-sm text-black/40">Loading users...</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((profile) => (
            <div key={profile.id} className="border border-black/10 p-4 hover:border-black/20 transition-colors">
              <div className="flex items-center gap-4">
                {/* Avatar */}
                <div className="w-10 h-10 bg-black/5 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {profile.profile_picture_url ? (
                    <img src={profile.profile_picture_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="font-heading text-lg text-black/20">{profile.display_name?.[0]}</span>
                  )}
                </div>

                {/* User info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm font-semibold truncate">{profile.display_name}</p>
                    {profile.is_producer && (
                      <span className="bg-accent/20 text-accent font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5">
                        Producer
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-xs text-black/40 truncate">
                    {profile.email || 'No email'}
                    {profile.producer_name && ` · ${profile.producer_name}`}
                  </p>
                  <p className="font-mono text-[10px] text-black/30 mt-0.5">
                    {profile.files_count} files · {profile.notes_count} notes
                  </p>
                </div>

                {/* Role dropdown */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <select
                    value={profile.role}
                    onChange={(e) => updateRole(profile.id, e.target.value)}
                    disabled={updatingId === profile.id}
                    className="border border-black/20 px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none bg-white disabled:opacity-50"
                  >
                    {ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>

                  {/* Producer toggle */}
                  <button
                    onClick={() => toggleProducer(profile.id, profile.is_producer)}
                    disabled={updatingId === profile.id}
                    title={profile.is_producer ? 'Remove producer access' : 'Grant producer access'}
                    className={`border px-2 py-1.5 font-mono text-xs uppercase tracking-wider inline-flex items-center gap-1 transition-colors disabled:opacity-50 ${
                      profile.is_producer
                        ? 'border-accent bg-accent/10 text-accent font-bold'
                        : 'border-black/20 text-black/40 hover:border-accent hover:text-accent'
                    }`}
                  >
                    <Music className="w-3 h-3" />
                    {profile.is_producer ? <Check className="w-3 h-3" /> : null}
                  </button>

                  {/* Profile link */}
                  {profile.public_profile_slug && (
                    <a
                      href={`/u/${profile.public_profile_slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline p-1.5 flex-shrink-0"
                      title="View profile"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="font-mono text-sm text-black/30 text-center py-8">No users found</p>
          )}
        </div>
      )}
    </div>
  );
}
