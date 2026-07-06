'use client';

// EngineerProfile — self-service profile photo for the logged-in engineer. Mirrors
// the admin EngineersManager.uploadPhoto flow (POST signed URL → PUT bytes → PATCH
// save) but is hard-locked to the engineer's OWN record server-side: the API
// resolves the row by the session user's email, never by a client-supplied id.

import { useEffect, useState } from 'react';
import { Loader2, Upload, User } from 'lucide-react';

interface Profile {
  id: string;
  name: string;
  display_name: string | null;
  photo_url: string | null;
  bio: string | null;
}

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export default function EngineerProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/engineer/profile', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setProfile(d.engineer ?? null);
        setDisplayName(d.engineer?.display_name || d.engineer?.name || '');
      })
      .catch(() => { if (alive) setError('Could not load your profile.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function uploadPhoto(file: File) {
    setError(''); setSuccess('');
    // Client-side validation, mirroring the admin component's accept="image/*" + size guard.
    if (!file.type.startsWith('image/')) { setError('Please choose an image file (JPG, PNG, or WebP).'); return; }
    if (file.size > MAX_BYTES) { setError('Image is too large — keep it under 10MB.'); return; }

    setUploading(true);
    try {
      const signRes = await fetch('/api/engineer/profile/upload-photo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name }),
      });
      const sign = await signRes.json();
      if (!sign.signedUrl) throw new Error(sign.error || 'no url');

      const put = await fetch(sign.signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error('upload failed');

      const saveRes = await fetch('/api/engineer/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photo_url: sign.publicUrl }),
      });
      if (!saveRes.ok) throw new Error((await saveRes.json()).error || 'save failed');

      setProfile((p) => (p ? { ...p, photo_url: sign.publicUrl } : p));
      setSuccess("Photo updated — it'll show on the engineers page shortly.");
    } catch {
      setError('Photo upload failed — use a JPG, PNG, or WebP under 10MB.');
    } finally {
      setUploading(false);
    }
  }

  // Save the display name shown on the public /engineers page. The canonical
  // payroll `name` is never touched — only `display_name` (the route whitelist
  // enforces this server-side too).
  async function saveName() {
    const trimmed = displayName.trim();
    if (!trimmed) { setError('Enter a display name.'); return; }
    setError(''); setSuccess(''); setSavingName(true);
    try {
      const res = await fetch('/api/engineer/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: trimmed }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'save failed');
      setProfile((p) => (p ? { ...p, display_name: trimmed } : p));
      setSuccess("Name updated — it'll show on the engineers page shortly.");
    } catch {
      setError('Could not save your name — try again.');
    } finally {
      setSavingName(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-black/40 font-mono text-sm py-8">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading your profile…
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-md border-2 border-black/10 p-5">
        <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-2">My Profile</h3>
        <p className="font-mono text-xs text-black/60 leading-relaxed">
          No engineer profile is linked to your account yet — ask an admin to set it up.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md space-y-4">
      <div className="border-2 border-black/10 p-5 space-y-4">
        <h3 className="font-mono text-sm font-bold uppercase tracking-wider">My Profile</h3>

        <div className="flex items-center gap-4">
          {profile.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photo_url} alt={profile.name} className="w-20 h-20 rounded-full object-cover border-2 border-black/10 shrink-0" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-black/5 border-2 border-black/10 flex items-center justify-center shrink-0">
              <User className="w-8 h-8 text-black/25" />
            </div>
          )}
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold truncate">{profile.display_name || profile.name}</p>
            <p className="font-mono text-[11px] text-black/40">Your engineers-page photo</p>
          </div>
        </div>

        <label className="font-mono text-[11px] font-bold uppercase px-3 py-2 border-2 border-black/15 hover:border-accent cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap">
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {uploading ? 'Uploading…' : 'Change photo'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(ev) => { const f = ev.target.files?.[0]; if (f) uploadPhoto(f); ev.target.value = ''; }}
          />
        </label>

        <div className="pt-3 border-t border-black/10 space-y-2">
          <label className="font-mono text-[11px] font-bold uppercase tracking-wider text-black/50 block">
            Display name{' '}
            <span className="text-black/30 normal-case font-normal">(shown on the engineers page)</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={60}
              placeholder="Your name as it should appear publicly"
              className="flex-1 min-w-0 border-2 border-black/15 focus:border-accent px-3 py-2 font-mono text-sm outline-none"
            />
            <button
              type="button"
              onClick={saveName}
              disabled={savingName || !displayName.trim()}
              className="font-mono text-[11px] font-bold uppercase px-4 py-2 border-2 border-black/15 hover:border-accent disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {savingName ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {savingName ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {success && <p className="font-mono text-xs text-green-700">{success}</p>}
        {error && <p className="font-mono text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
