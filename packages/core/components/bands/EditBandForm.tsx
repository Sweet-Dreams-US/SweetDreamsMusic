'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Loader2, Upload, AlertCircle, Users, ImageIcon, Save } from 'lucide-react';
import type { Band } from '@/lib/bands';

type SocialField =
  | 'spotify_link'
  | 'apple_music_link'
  | 'instagram_link'
  | 'facebook_link'
  | 'youtube_link'
  | 'soundcloud_link'
  | 'tiktok_link'
  | 'twitter_link';

const SOCIAL_FIELDS: { key: SocialField; label: string; placeholder: string }[] = [
  { key: 'spotify_link', label: 'Spotify', placeholder: 'https://open.spotify.com/artist/...' },
  { key: 'apple_music_link', label: 'Apple Music', placeholder: 'https://music.apple.com/...' },
  { key: 'instagram_link', label: 'Instagram', placeholder: 'https://instagram.com/yourband' },
  { key: 'youtube_link', label: 'YouTube', placeholder: 'https://youtube.com/@yourband' },
  { key: 'tiktok_link', label: 'TikTok', placeholder: 'https://tiktok.com/@yourband' },
  { key: 'soundcloud_link', label: 'SoundCloud', placeholder: 'https://soundcloud.com/yourband' },
  { key: 'facebook_link', label: 'Facebook', placeholder: 'https://facebook.com/yourband' },
  { key: 'twitter_link', label: 'Twitter / X', placeholder: 'https://twitter.com/yourband' },
];

/**
 * Edit form for a band. Text fields update on submit; image uploads happen
 * inline via signed URL pattern (same as solo profile photo upload).
 */
export default function EditBandForm({ band, isOwner }: { band: Band; isOwner: boolean }) {
  const router = useRouter();

  const [displayName, setDisplayName] = useState(band.display_name);
  const [bio, setBio] = useState(band.bio ?? '');
  const [genre, setGenre] = useState(band.genre ?? '');
  const [hometown, setHometown] = useState(band.hometown ?? '');
  const [isPublic, setIsPublic] = useState(band.is_public);
  const [profilePicture, setProfilePicture] = useState(band.profile_picture_url);
  const [coverImage, setCoverImage] = useState(band.cover_image_url);

  const [socialLinks, setSocialLinks] = useState<Record<SocialField, string>>(() => {
    const out: Record<string, string> = {};
    for (const { key } of SOCIAL_FIELDS) out[key] = band[key] ?? '';
    return out as Record<SocialField, string>;
  });

  const [saving, setSaving] = useState(false);
  const [uploadingType, setUploadingType] = useState<'profile' | 'cover' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  async function handleImageUpload(
    file: File,
    type: 'profile' | 'cover'
  ): Promise<string | null> {
    setUploadingType(type);
    setError(null);
    try {
      // 1. Ask our API for a signed upload URL.
      const urlRes = await fetch(`/api/bands/${band.id}/photo/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, type }),
      });
      if (!urlRes.ok) {
        const data = await urlRes.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to get upload URL');
      }
      const { signedUrl, publicUrl } = await urlRes.json();

      // 2. Upload the file directly to Supabase storage.
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error('Upload failed');

      // 3. Save the path on the band via PATCH.
      const field = type === 'profile' ? 'profile_picture_url' : 'cover_image_url';
      const patchRes = await fetch(`/api/bands/${band.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: publicUrl }),
      });
      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save image');
      }

      router.refresh();
      return publicUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      return null;
    } finally {
      setUploadingType(null);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>, type: 'profile' | 'cover') {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await handleImageUpload(file, type);
    if (url) {
      if (type === 'profile') setProfilePicture(url);
      else setCoverImage(url);
    }
    // reset the input so selecting the same file again retriggers onChange
    e.target.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaveSuccess(false);

    if (!displayName.trim()) {
      setError('Band name is required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/bands/${band.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName.trim(),
          bio: bio.trim() || null,
          genre: genre.trim() || null,
          hometown: hometown.trim() || null,
          is_public: isPublic,
          ...Object.fromEntries(
            SOCIAL_FIELDS.map(({ key }) => [key, socialLinks[key].trim() || null])
          ),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setSaveSuccess(true);
      router.refresh();
      // Clear the success flash after a few seconds.
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-10">
      {error && (
        <div className="border-2 border-red-500 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="font-mono text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Cover image */}
      <section>
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider mb-3">Cover Image</h3>
        <div className="relative aspect-[3/1] bg-black border-2 border-black/20 overflow-hidden">
          {coverImage ? (
            <Image
              src={coverImage}
              alt={`${band.display_name} cover`}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 768px"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <ImageIcon className="w-10 h-10 text-white/30" strokeWidth={1.5} />
            </div>
          )}
          <label className="absolute bottom-3 right-3 bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 hover:bg-black/80 cursor-pointer transition-colors inline-flex items-center gap-2">
            {uploadingType === 'cover' ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> Uploading
              </>
            ) : (
              <>
                <Upload className="w-3 h-3" /> Change
              </>
            )}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleFileChange(e, 'cover')}
              className="hidden"
              disabled={uploadingType !== null}
            />
          </label>
        </div>
        <p className="font-mono text-xs text-black/50 mt-2">
          Wide banner image on your public band page. 1200x400 or larger works best.
        </p>
      </section>

      {/* Profile picture */}
      <section>
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider mb-3">Profile Picture</h3>
        <div className="flex items-center gap-4">
          <div className="relative w-24 h-24 border-2 border-black flex-shrink-0 bg-black">
            {profilePicture ? (
              <Image
                src={profilePicture}
                alt={band.display_name}
                fill
                className="object-cover"
                sizes="96px"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <Users className="w-10 h-10 text-white/30" strokeWidth={1.5} />
              </div>
            )}
          </div>
          <label className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-3 hover:bg-black/80 cursor-pointer transition-colors inline-flex items-center gap-2">
            {uploadingType === 'profile' ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" /> Uploading
              </>
            ) : (
              <>
                <Upload className="w-3 h-3" /> Upload
              </>
            )}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleFileChange(e, 'profile')}
              className="hidden"
              disabled={uploadingType !== null}
            />
          </label>
        </div>
      </section>

      {/* Core fields */}
      <section className="space-y-5">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider">Core Info</h3>

        <div>
          <label htmlFor="band-name" className="font-mono text-xs font-bold uppercase tracking-wider block mb-2">
            Band name *
          </label>
          <input
            id="band-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={80}
            className="w-full border-2 border-black px-4 py-3 font-mono text-base focus:outline-none focus:border-accent"
            disabled={saving}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              className="w-full border-2 border-black/20 px-4 py-3 font-mono text-base focus:outline-none focus:border-accent"
              disabled={saving}
            />
          </div>
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
              className="w-full border-2 border-black/20 px-4 py-3 font-mono text-base focus:outline-none focus:border-accent"
              disabled={saving}
            />
          </div>
        </div>

        <div>
          <label htmlFor="band-bio" className="font-mono text-xs font-bold uppercase tracking-wider block mb-2">
            Bio
          </label>
          <textarea
            id="band-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={5}
            maxLength={1000}
            placeholder="Tell people about your band..."
            className="w-full border-2 border-black/20 px-4 py-3 font-mono text-sm focus:outline-none focus:border-accent resize-none"
            disabled={saving}
          />
          <p className="font-mono text-xs text-black/50 mt-1.5">{bio.length} / 1000</p>
        </div>
      </section>

      {/* Visibility */}
      <section>
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider mb-3">Visibility</h3>
        <label className="flex items-start gap-3 border-2 border-black/10 p-4 cursor-pointer hover:border-black/30 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/5">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="mt-1 accent-black"
            disabled={saving}
          />
          <div>
            <p className="font-mono text-sm font-bold">Public band page</p>
            <p className="font-mono text-xs text-black/60 mt-0.5">
              When on, your band page is live at sweetdreamsmusic.com/bands/{band.slug}
            </p>
          </div>
        </label>
      </section>

      {/* Social links */}
      <section>
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider mb-3">Social Links</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SOCIAL_FIELDS.map(({ key, label, placeholder }) => (
            <div key={key}>
              <label
                htmlFor={`social-${key}`}
                className="font-mono text-xs text-black/70 block mb-1.5"
              >
                {label}
              </label>
              <input
                id={`social-${key}`}
                type="url"
                value={socialLinks[key]}
                onChange={(e) => setSocialLinks({ ...socialLinks, [key]: e.target.value })}
                placeholder={placeholder}
                className="w-full border-2 border-black/20 px-3 py-2 font-mono text-xs focus:outline-none focus:border-accent"
                disabled={saving}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Owner-only: slug warning */}
      {isOwner && (
        <div className="border-2 border-black/10 bg-black/5 p-4">
          <p className="font-mono text-xs text-black/70">
            <strong className="uppercase tracking-wider">URL slug:</strong>{' '}
            <span className="font-semibold">{band.slug}</span>
          </p>
          <p className="font-mono text-xs text-black/60 mt-1.5">
            Slug changes require an admin request — reach out to support to update.
          </p>
        </div>
      )}

      {/* Submit */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center pt-4 border-t-2 border-black/5">
        <button
          type="submit"
          disabled={saving || !displayName.trim()}
          className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-8 py-4 hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" /> Save changes
            </>
          )}
        </button>
        {saveSuccess && (
          <p className="font-mono text-xs text-accent font-bold uppercase tracking-wider">
            ✓ Saved
          </p>
        )}
      </div>
    </form>
  );
}
