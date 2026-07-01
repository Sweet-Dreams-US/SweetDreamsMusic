'use client';

import { useState, useEffect } from 'react';
import { Save, ExternalLink, Upload, X, Plus, GripVertical } from 'lucide-react';
import { BEAT_GENRES } from '@/lib/constants';
import { MIN_SOCIAL_LINKS } from '@/lib/profile-completion';

interface Profile {
  display_name: string;
  bio: string;
  profile_picture_url: string | null;
  cover_photo_url: string | null;
  social_links: Record<string, string>;
  public_profile_slug: string;
  career_stage: string | null;
  genre: string | null;
  genres: string[] | null;
}

interface Project {
  id: string;
  project_name: string;
  project_type: string;
  description: string;
  cover_image_url: string | null;
  link: string;
  links: Record<string, string>;
  is_public: boolean;
  display_order: number;
}

const PROJECT_LINK_FIELDS = [
  { key: 'spotify', label: 'Spotify', placeholder: 'https://open.spotify.com/...' },
  { key: 'appleMusic', label: 'Apple Music', placeholder: 'https://music.apple.com/...' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/watch?v=...' },
  { key: 'soundcloud', label: 'SoundCloud', placeholder: 'https://soundcloud.com/...' },
  { key: 'tidal', label: 'Tidal', placeholder: 'https://tidal.com/...' },
  { key: 'amazonMusic', label: 'Amazon Music', placeholder: 'https://music.amazon.com/...' },
  { key: 'other', label: 'Other Link', placeholder: 'https://...' },
];

// Keys here are the CANONICAL platform_connections keys (see
// SOCIAL_PLATFORM_KEYS in lib/social-links-server). The editor's social
// section is the unified source of truth, so it speaks the canonical
// namespace directly — note `apple_music` (snake_case), not `appleMusic`.
const SOCIAL_FIELDS = [
  { key: 'spotify', label: 'Spotify', placeholder: 'https://open.spotify.com/artist/...' },
  { key: 'apple_music', label: 'Apple Music', placeholder: 'https://music.apple.com/...' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/...' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/...' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/...' },
  { key: 'soundcloud', label: 'SoundCloud', placeholder: 'https://soundcloud.com/...' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@...' },
  { key: 'twitter', label: 'Twitter / X', placeholder: 'https://x.com/...' },
];

export default function ProfileEditor({ userId, profileSlug }: { userId: string; profileSlug: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState<'profile' | 'cover' | null>(null);

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [profilePicUrl, setProfilePicUrl] = useState('');
  const [coverPhotoUrl, setCoverPhotoUrl] = useState('');
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>({});
  const [genres, setGenres] = useState<string[]>([]);
  const [slug, setSlug] = useState(profileSlug || '');

  // Projects
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((data) => {
        if (data.profile) {
          const p = data.profile;
          setDisplayName(p.display_name || '');
          setBio(p.bio || '');
          setProfilePicUrl(p.profile_picture_url || '');
          setCoverPhotoUrl(p.cover_photo_url || '');
          // Prefill social links from the UNIFIED source (platform_connections),
          // which the GET route assembles via getUnifiedSocialLinks. This is the
          // single source of truth — no legacy social_links blob fallback, so a
          // link deleted in the metrics tracker never resurfaces here.
          setSocialLinks(p.social_links_unified || {});
          // genres is the multi-select source; fall back to the legacy single
          // `genre` so profiles saved before the migration still prefill.
          setGenres(
            Array.isArray(p.genres) && p.genres.length > 0
              ? p.genres
              : p.genre
                ? [p.genre]
                : [],
          );
          if (p.public_profile_slug) setSlug(p.public_profile_slug);
        }
      })
      .finally(() => setLoading(false));

    fetch('/api/profile/projects')
      .then((r) => r.json())
      .then((data) => setProjects(data.projects || []))
      .finally(() => setLoadingProjects(false));
  }, []);

  function updateSocial(key: string, value: string) {
    setSocialLinks((prev) => ({ ...prev, [key]: value }));
  }

  function toggleGenre(value: string) {
    setGenres((prev) =>
      prev.includes(value) ? prev.filter((g) => g !== value) : [...prev, value],
    );
  }

  // Count of non-empty social links — drives the >=3 completion hint.
  const filledSocialCount = SOCIAL_FIELDS.filter(
    (f) => (socialLinks[f.key] || '').trim().length > 0,
  ).length;

  async function handleSave() {
    setSaving(true);
    setSaved(false);

    // Filter out empty social links, keyed by CANONICAL platform key. The PUT
    // route fans these out to upsertSocialLink (platform_connections, canonical)
    // AND writes profiles.social_links for back-compat.
    const filteredLinks: Record<string, string> = {};
    Object.entries(socialLinks).forEach(([k, v]) => {
      if (v?.trim()) filteredLinks[k] = v.trim();
    });

    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: displayName,
        bio,
        social_links: filteredLinks,
        genres,
      }),
    });

    if (res.ok) {
      const data = await res.json().catch(() => null);
      // Slug is server-derived; reflect whatever the server persisted.
      if (data?.profile?.public_profile_slug) setSlug(data.profile.public_profile_slug);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } else {
      const err = await res.json().catch(() => null);
      alert(`Could not save: ${err?.error || 'Please try again.'}`);
    }
    setSaving(false);
  }

  async function uploadViaSigned(file: File, type: string, projectId?: string) {
    // Step 1: Get signed upload URL
    const urlRes = await fetch('/api/profile/photo/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, type, projectId }),
    });
    const urlData = await urlRes.json();
    if (!urlRes.ok) throw new Error(urlData.error || 'Could not prepare upload');

    // Step 2: Upload directly to Supabase Storage
    const uploadRes = await fetch(urlData.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'image/jpeg' },
      body: file,
    });
    if (!uploadRes.ok) throw new Error('Storage upload failed');

    // Step 3: Save record (get public URL back)
    const saveRes = await fetch('/api/profile/photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: urlData.filePath, type, projectId }),
    });
    const saveData = await saveRes.json();
    if (!saveRes.ok) throw new Error(saveData.error || 'Failed to save');

    return saveData.url;
  }

  async function handlePhotoUpload(file: File, type: 'profile' | 'cover') {
    setUploading(type);
    try {
      const url = await uploadViaSigned(file, type);
      if (url) {
        if (type === 'profile') setProfilePicUrl(url);
        else setCoverPhotoUrl(url);
      }
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : 'Please try again.'}`);
      console.error('Photo upload error:', err);
    } finally {
      setUploading(null);
    }
  }

  async function handleProjectImageUpload(file: File, projectId: string) {
    try {
      const url = await uploadViaSigned(file, 'project', projectId);
      if (url) {
        setProjects((prev) => prev.map((p) => p.id === projectId ? { ...p, cover_image_url: url } : p));
      }
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : 'Please try again.'}`);
      console.error('Project image upload error:', err);
    }
  }

  async function addProject() {
    const res = await fetch('/api/profile/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_name: 'New Project',
        project_type: '',
        description: '',
        link: '',
        display_order: projects.length,
      }),
    });
    const data = await res.json();
    if (data.project) setProjects((prev) => [...prev, data.project]);
  }

  async function updateProject(id: string, updates: Partial<Project>) {
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, ...updates } : p));
  }

  async function saveProject(project: Project) {
    await fetch('/api/profile/projects', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });
  }

  async function deleteProject(id: string) {
    await fetch(`/api/profile/projects?id=${id}`, { method: 'DELETE' });
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }

  if (loading) {
    return <p className="font-mono text-sm text-black/70">Loading profile...</p>;
  }

  return (
    <div className="space-y-10">
      {/* Cover Photo */}
      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-3">Cover Photo</label>
        <div className="relative w-full aspect-[3/1] bg-black/5 overflow-hidden mb-2">
          {coverPhotoUrl ? (
            <img src={coverPhotoUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="font-mono text-sm text-black/50">No cover photo</span>
            </div>
          )}
        </div>
        <label className="cursor-pointer inline-flex items-center gap-2 bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-black/80 transition-colors">
          <Upload className="w-3 h-3" />
          {uploading === 'cover' ? 'Uploading...' : 'Upload Cover'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f, 'cover'); }}
            disabled={uploading !== null}
          />
        </label>
        <span className="font-mono text-[10px] text-black/60 ml-3">Recommended: 1500×500, JPG or PNG, max 5MB</span>
      </div>

      {/* Profile Picture */}
      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-3">Profile Photo</label>
        <div className="flex items-center gap-6">
          <div className="w-24 h-24 bg-black/5 flex items-center justify-center overflow-hidden flex-shrink-0">
            {profilePicUrl ? (
              <img src={profilePicUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="font-heading text-3xl text-black/10">{displayName?.[0]?.toUpperCase() || '?'}</span>
            )}
          </div>
          <div>
            <label className="cursor-pointer inline-flex items-center gap-2 bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-black/80 transition-colors">
              <Upload className="w-3 h-3" />
              {uploading === 'profile' ? 'Uploading...' : 'Upload Photo'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f, 'profile'); }}
                disabled={uploading !== null}
              />
            </label>
            <p className="font-mono text-[10px] text-black/60 mt-2">Square recommended, max 5MB</p>
          </div>
        </div>
      </div>

      {/* Display Name */}
      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-1">Display Name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full border-2 border-black px-4 py-3 font-mono text-sm focus:border-accent focus:outline-none"
          placeholder="Your name or artist name"
        />
      </div>

      {/* Bio */}
      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-1">Bio</label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
          className="w-full border-2 border-black/20 px-4 py-3 font-mono text-sm focus:border-accent focus:outline-none resize-vertical"
          placeholder="Tell people about yourself..."
        />
      </div>

      {/* Career Stage */}
      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-1">Career Stage</label>
        <p className="font-mono text-xs text-black/50 border-2 border-dashed border-black/15 px-4 py-3">
          Your stage is earned, not picked — it advances automatically as you
          complete verified milestones. Track it in your Hub → Roadmap.
        </p>
      </div>

      {/* Genres — multi-select. Saved to profiles.genres (string[]); the PUT
          route also mirrors genres[0] to the legacy `genre` column. */}
      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-1">Genres</label>
        <p className="font-mono text-[10px] text-black/60 mb-3">
          Pick all that fit. {genres.length} selected{genres.length === 0 ? ' — pick at least 1' : ''}.
        </p>
        <div className="flex flex-wrap gap-2">
          {BEAT_GENRES.map((g) => {
            const selected = genres.includes(g.value);
            return (
              <button
                key={g.value}
                type="button"
                onClick={() => toggleGenre(g.value)}
                aria-pressed={selected}
                className={`font-mono text-xs px-3 py-2 border-2 transition-colors ${
                  selected
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-black border-black/20 hover:border-black/50'
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Social Links — unified source of truth. On save these are upserted into
          platform_connections (canonical) AND mirrored to profiles.social_links. */}
      <div>
        <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-1">Social Links</label>
        <p className={`font-mono text-[10px] mb-3 ${filledSocialCount >= MIN_SOCIAL_LINKS ? 'text-black/60' : 'text-accent'}`}>
          Connect at least {MIN_SOCIAL_LINKS} to complete your profile. {filledSocialCount}/{MIN_SOCIAL_LINKS} added.
        </p>
        <div className="space-y-3">
          {SOCIAL_FIELDS.map((field) => (
            <div key={field.key} className="flex items-center gap-3">
              <span className="font-mono text-xs text-black/70 w-28 flex-shrink-0">{field.label}</span>
              <input
                type="url"
                value={socialLinks[field.key] || ''}
                onChange={(e) => updateSocial(field.key, e.target.value)}
                className="flex-1 border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
                placeholder={field.placeholder}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Public profile link */}
      {/* Public profile link — READ-ONLY. The slug is auto-derived from the
          display name on save (deriveUniqueSlug); the artist never edits it. */}
      {slug && (
        <div className="border border-black/10 p-4 flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Your Public Profile</p>
            <p className="font-mono text-sm">/u/{slug}</p>
            <p className="font-mono text-[10px] text-black/50 mt-1">Auto-generated from your display name.</p>
          </div>
          <a
            href={`/u/${slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-accent hover:underline inline-flex items-center gap-1"
          >
            View <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Save Profile */}
      <button
        onClick={handleSave}
        disabled={saving || !displayName.trim()}
        className="w-full bg-accent text-black font-mono text-base font-bold uppercase tracking-wider py-4 hover:bg-accent/90 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        <Save className="w-4 h-4" />
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Profile'}
      </button>

      {/* ============ PROJECTS ============ */}
      <div className="border-t-2 border-black pt-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-heading-lg">PROJECTS</h2>
            <p className="font-mono text-xs text-black/60 mt-1">Showcase your releases, singles, and projects with cover art and links.</p>
          </div>
          <button
            onClick={addProject}
            className="inline-flex items-center gap-2 bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-black/80 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Project
          </button>
        </div>

        {loadingProjects ? (
          <p className="font-mono text-sm text-black/70">Loading projects...</p>
        ) : projects.length === 0 ? (
          <p className="font-mono text-xs text-black/60 border border-black/10 p-8 text-center">
            No projects yet. Add your first release, single, or project to showcase on your profile.
          </p>
        ) : (
          <div className="space-y-6">
            {projects.map((project) => (
              <div key={project.id} className="border-2 border-black/10 p-5">
                <div className="flex gap-4">
                  {/* Cover art */}
                  <div className="w-32 h-32 bg-black/5 flex-shrink-0 overflow-hidden relative group">
                    {project.cover_image_url ? (
                      <img src={project.cover_image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="font-mono text-[10px] text-black/50">No art</span>
                      </div>
                    )}
                    <label className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center">
                      <Upload className="w-5 h-5 text-white" />
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleProjectImageUpload(f, project.id); }}
                      />
                    </label>
                  </div>

                  {/* Fields */}
                  <div className="flex-1 space-y-3">
                    <input
                      type="text"
                      value={project.project_name}
                      onChange={(e) => updateProject(project.id, { project_name: e.target.value })}
                      className="w-full border border-black/20 px-3 py-2 font-mono text-sm font-bold focus:border-accent focus:outline-none"
                      placeholder="Project name"
                    />
                    <input
                      type="text"
                      value={project.project_type}
                      onChange={(e) => updateProject(project.id, { project_type: e.target.value })}
                      className="w-full border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
                      placeholder="Type (Single, EP, Album, Music Video...)"
                    />
                    <textarea
                      value={project.description}
                      onChange={(e) => updateProject(project.id, { description: e.target.value })}
                      rows={2}
                      className="w-full border border-black/20 px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none resize-vertical"
                      placeholder="Description (optional)"
                    />

                    {/* Platform Links */}
                    <div className="border border-black/10 p-3 space-y-2">
                      <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider font-bold">Platform Links</p>
                      {PROJECT_LINK_FIELDS.map((field) => (
                        <div key={field.key} className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-black/70 w-24 flex-shrink-0">{field.label}</span>
                          <input
                            type="url"
                            value={(project.links || {})[field.key] || ''}
                            onChange={(e) => {
                              const newLinks = { ...(project.links || {}), [field.key]: e.target.value };
                              updateProject(project.id, { links: newLinks });
                            }}
                            className="flex-1 border border-black/15 px-2 py-1.5 font-mono text-[11px] focus:border-accent focus:outline-none"
                            placeholder={field.placeholder}
                          />
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveProject(project)}
                          className="font-mono text-[10px] font-bold uppercase tracking-wider bg-black text-white px-3 py-1.5 hover:bg-black/80 transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => deleteProject(project.id)}
                          className="font-mono text-[10px] font-bold uppercase tracking-wider text-red-500 border border-red-300 px-3 py-1.5 hover:bg-red-50 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={project.is_public}
                          onChange={(e) => { updateProject(project.id, { is_public: e.target.checked }); }}
                          className="accent-accent"
                        />
                        <span className="font-mono text-[10px] text-black/60 uppercase tracking-wider">Public</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
