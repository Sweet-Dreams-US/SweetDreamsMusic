'use client';

// /listen/[token] — studio-branded private listening page (Plan 6 §5).
// Streams the unreleased track (short-TTL signed URL, no download UI),
// collects structured feedback, and ends every visit with the studio join
// prompt — every share is lead gen.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Play, Pause, Lock, Heart, Check } from 'lucide-react';

type State = 'loading' | 'gone' | 'ready';

export default function ListenPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [state, setState] = useState<State>('loading');
  const [goneReason, setGoneReason] = useState('This link is no longer available.');
  const [meta, setMeta] = useState<{ trackLabel: string; artistName: string; streamUrl: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const playCounted = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Feedback form
  const [form, setForm] = useState({ name: '', email: '', vibe: 7, comment: '' });
  const [favMoment, setFavMoment] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/listen/${token}`);
        const j = await res.json();
        if (!res.ok) {
          setGoneReason(j.error === 'expired' ? 'This link has expired.' : j.error === 'revoked' ? 'The artist has closed this link.' : 'This link doesn’t exist.');
          setState('gone');
          return;
        }
        setMeta(j);
        setState('ready');
      } catch { setState('gone'); }
    })();
  }, [token]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !meta) return;
    if (playing) { audio.pause(); setPlaying(false); return; }
    audio.play().then(() => {
      setPlaying(true);
      if (!playCounted.current) {
        playCounted.current = true;
        fetch(`/api/listen/${token}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'play' }),
        }).catch(() => {});
      }
    }).catch(() => {});
  }, [playing, meta, token]);

  async function submitFeedback() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/listen/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'feedback', name: form.name, email: form.email,
          vibe_score: form.vibe, favorite_moment_seconds: favMoment, comment: form.comment,
        }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || 'Could not submit'); setBusy(false); return; }
      setSubmitted(true);
    } catch { setErr('Network error'); }
    setBusy(false);
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  if (state === 'loading') return <main className="min-h-screen bg-black flex items-center justify-center"><p className="font-mono text-white/40 text-sm">Loading…</p></main>;
  if (state === 'gone') return (
    <main className="min-h-screen bg-black flex items-center justify-center p-6">
      <div className="text-center">
        <Lock className="w-8 h-8 text-white/30 mx-auto mb-4" />
        <p className="font-mono text-white text-sm">{goneReason}</p>
      </div>
    </main>
  );

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="max-w-xl mx-auto px-6 py-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40 mb-10 text-center">Private listening · Sweet Dreams Music</p>

        {/* Player */}
        <div className="border-2 border-white/15 p-8 text-center">
          <p className="font-mono text-[10px] uppercase tracking-wider text-white/40 mb-2">{meta!.artistName} — unreleased</p>
          <h1 className="font-heading text-2xl mb-8">{meta!.trackLabel}</h1>
          <audio
            ref={audioRef} src={meta!.streamUrl} preload="metadata"
            onTimeUpdate={(e) => setPosition((e.target as HTMLAudioElement).currentTime)}
            onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration || 0)}
            onEnded={() => setPlaying(false)}
            controlsList="nodownload" onContextMenu={(e) => e.preventDefault()}
          />
          <button onClick={toggle} className="w-16 h-16 rounded-full bg-accent text-black flex items-center justify-center mx-auto hover:scale-105 transition-transform">
            {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
          </button>
          <div className="mt-6">
            <div className="h-1 bg-white/10 cursor-pointer" onClick={(e) => {
              const rect = (e.target as HTMLElement).getBoundingClientRect();
              const frac = (e.clientX - rect.left) / rect.width;
              if (audioRef.current && duration) audioRef.current.currentTime = frac * duration;
            }}>
              <div className="h-1 bg-accent" style={{ width: duration ? `${(position / duration) * 100}%` : '0%' }} />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-white/40 mt-1">
              <span>{fmt(position)}</span><span>{duration ? fmt(duration) : '—'}</span>
            </div>
          </div>
          <button
            onClick={() => setFavMoment(Math.floor(position))}
            className="mt-4 font-mono text-[10px] uppercase tracking-wider text-white/50 hover:text-accent inline-flex items-center gap-1">
            <Heart className={`w-3 h-3 ${favMoment != null ? 'fill-accent text-accent' : ''}`} />
            {favMoment != null ? `Favorite moment: ${fmt(favMoment)}` : 'Tap when you hear your favorite moment'}
          </button>
        </div>

        {/* Feedback */}
        <div className="border-2 border-white/15 border-t-0 p-8">
          {submitted ? (
            <div className="text-center">
              <Check className="w-6 h-6 text-accent mx-auto mb-2" />
              <p className="font-mono text-sm">Sent. {meta!.artistName} will see it.</p>
            </div>
          ) : (
            <>
              <p className="font-mono text-xs font-bold uppercase tracking-wider mb-4">Tell {meta!.artistName} what you think</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <input placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="bg-transparent border-2 border-white/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" />
                <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="bg-transparent border-2 border-white/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none" />
              </div>
              <label className="font-mono text-[10px] uppercase tracking-wider text-white/40">Vibe: {form.vibe}/10</label>
              <input type="range" min={1} max={10} value={form.vibe}
                onChange={(e) => setForm({ ...form, vibe: Number(e.target.value) })}
                className="w-full accent-[var(--accent,#f5c518)] mb-3" />
              <textarea placeholder="Anything else? (optional)" value={form.comment} rows={2}
                onChange={(e) => setForm({ ...form, comment: e.target.value })}
                className="w-full bg-transparent border-2 border-white/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none mb-3" />
              {err && <p className="font-mono text-xs text-red-400 mb-2">{err}</p>}
              <button onClick={submitFeedback} disabled={busy}
                className="w-full bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider py-3 disabled:opacity-50">
                {busy ? 'Sending…' : 'Send feedback'}
              </button>
            </>
          )}
        </div>

        {/* Studio join prompt — every share is lead gen */}
        <div className="border-2 border-white/15 border-t-0 p-6 text-center bg-white/[0.03]">
          <p className="font-mono text-xs text-white/60 mb-3">Recorded at Sweet Dreams Music, Fort Wayne.</p>
          <Link href="/book" className="font-mono text-xs font-bold uppercase tracking-wider text-accent hover:underline">
            Make your own music here →
          </Link>
        </div>
      </div>
    </main>
  );
}
