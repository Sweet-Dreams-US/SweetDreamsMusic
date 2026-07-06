'use client';

// components/admin/SocialManager.tsx — the admin Social tab (Phase 4 of the
// marketing hub): Instagram profile + recent posts with engagement (LIVE), and
// the Facebook Page side, which shows setup instructions until the Page asset
// is assigned to the system user in Business Settings.

import { useCallback, useEffect, useState } from 'react';
import { Instagram, Facebook, RefreshCw, Heart, MessageCircle, ExternalLink } from 'lucide-react';

type IgProfile = { username: string; followers: number; mediaCount: number };
type IgMedia = {
  id: string; caption: string | null; mediaType: string;
  mediaUrl: string | null; thumbnailUrl: string | null;
  permalink: string; timestamp: string;
  likeCount: number | null; commentsCount: number | null;
};
type PageProfile = { name: string; fanCount: number | null; followersCount: number | null };
type PagePost = {
  id: string; message: string | null; createdTime: string;
  permalink: string | null; picture: string | null;
  reactions: number | null; comments: number | null;
};

type SocialPayload = {
  ig: { profile: IgProfile | null; media: IgMedia[]; error: string | null };
  page: { profile: PageProfile | null; posts: PagePost[]; blocked: string | null };
};

const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));
const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function SocialManager() {
  const [data, setData] = useState<SocialPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/marketing/social', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to load');
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load social data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-heading-md inline-flex items-center gap-2">
            <Instagram className="w-6 h-6 text-accent" /> SOCIAL
          </h2>
          <p className="font-mono text-xs text-black/50 mt-1">
            Sweet Dreams Music on Instagram &amp; Facebook — content and engagement
          </p>
        </div>
        <button
          onClick={load}
          aria-label="Refresh"
          className="p-2 rounded bg-black/5 text-black/50 hover:bg-black/10 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="border-2 border-red-500/40 bg-red-50 p-4 font-mono text-sm text-red-700 mb-6">{error}</div>
      )}
      {loading && !data && <p className="font-mono text-sm text-black/50">Loading social data…</p>}

      {data && (
        <>
          {/* ── Instagram ── */}
          <div className="mb-10">
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                <Instagram className="w-4 h-4 text-accent" /> Instagram
              </h3>
              {data.ig.profile && (
                <p className="font-mono text-xs text-black/60">
                  <a
                    href={`https://instagram.com/${data.ig.profile.username}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    @{data.ig.profile.username}
                  </a>
                  {' '}· {num(data.ig.profile.followers)} followers · {num(data.ig.profile.mediaCount)} posts
                </p>
              )}
            </div>
            {data.ig.error && (
              <p className="font-mono text-xs text-amber-700 border border-amber-400/50 bg-amber-50 p-3 mb-3">{data.ig.error}</p>
            )}
            {data.ig.media.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {data.ig.media.map((m) => {
                  const img = m.mediaType === 'VIDEO' ? (m.thumbnailUrl ?? m.mediaUrl) : m.mediaUrl;
                  return (
                    <a
                      key={m.id}
                      href={m.permalink}
                      target="_blank" rel="noopener noreferrer"
                      className="group relative block aspect-square overflow-hidden bg-black/5 border border-black/10"
                      title={m.caption ?? ''}
                    >
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element -- IG CDN urls are short-lived; next/image remote config would break on rotation
                        <img src={img} alt={m.caption?.slice(0, 80) ?? 'Instagram post'} className="w-full h-full object-cover group-hover:opacity-80 transition-opacity" loading="lazy" />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-black/40 p-2 text-center">{m.mediaType}</span>
                      )}
                      <span className="absolute bottom-0 inset-x-0 bg-black/70 text-white font-mono text-[10px] px-1.5 py-1 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="inline-flex items-center gap-1"><Heart className="w-3 h-3" />{num(m.likeCount)}</span>
                        <span className="inline-flex items-center gap-1"><MessageCircle className="w-3 h-3" />{num(m.commentsCount)}</span>
                        <span>{when(m.timestamp)}</span>
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Facebook Page ── */}
          <div>
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                <Facebook className="w-4 h-4 text-accent" /> Facebook Page
              </h3>
              {data.page.profile && (
                <p className="font-mono text-xs text-black/60">
                  {data.page.profile.name} · {num(data.page.profile.followersCount ?? data.page.profile.fanCount)} followers
                </p>
              )}
            </div>
            {data.page.blocked ? (
              <div className="font-mono text-xs text-amber-700 border border-amber-400/50 bg-amber-50 p-4">
                <p className="font-bold mb-1">Facebook Page not connected yet</p>
                <p>
                  Assign the Sweet Dreams Music Page to the system user:
                  Business Settings → System users → Conversions API System User → Assign assets → Pages →
                  Sweet Dreams Music → Manage Page. This section activates automatically afterwards.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.page.posts.map((p) => (
                  <div key={p.id} className="border border-black/10 p-3 flex items-start gap-3">
                    {p.picture && (
                      // eslint-disable-next-line @next/next/no-img-element -- FB CDN urls are short-lived
                      <img src={p.picture} alt="" className="w-14 h-14 object-cover shrink-0" loading="lazy" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs line-clamp-2">{p.message || '(no text)'}</p>
                      <p className="font-mono text-[10px] text-black/40 mt-1 flex items-center gap-3">
                        <span>{when(p.createdTime)}</span>
                        <span className="inline-flex items-center gap-1"><Heart className="w-3 h-3" />{num(p.reactions)}</span>
                        <span className="inline-flex items-center gap-1"><MessageCircle className="w-3 h-3" />{num(p.comments)}</span>
                        {p.permalink && (
                          <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
                            View <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
                {data.page.posts.length === 0 && (
                  <p className="font-mono text-xs text-black/40 border border-black/10 p-4">No recent posts.</p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
