import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Users, MapPin, ExternalLink, Settings } from 'lucide-react';
import { createServiceClient, createClient } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/constants';
import { getBrand } from '@/lib/brand-server';
import type { Band, BandMember } from '@/lib/bands';

type Props = { params: Promise<{ slug: string }> };

const SOCIAL_LINKS: { field: keyof Band; label: string }[] = [
  { field: 'spotify_link', label: 'Spotify' },
  { field: 'apple_music_link', label: 'Apple Music' },
  { field: 'instagram_link', label: 'Instagram' },
  { field: 'youtube_link', label: 'YouTube' },
  { field: 'tiktok_link', label: 'TikTok' },
  { field: 'soundcloud_link', label: 'SoundCloud' },
  { field: 'facebook_link', label: 'Facebook' },
  { field: 'twitter_link', label: 'X / Twitter' },
];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createServiceClient();

  const { data: band } = await supabase
    .from('bands')
    .select('display_name, bio, profile_picture_url, is_public')
    .eq('slug', slug)
    .maybeSingle();

  if (!band || !band.is_public) return { title: 'Band Not Found' };

  const brand = await getBrand();
  return {
    title: `${band.display_name}`,
    description: band.bio || `${band.display_name} on ${brand.name}`,
    alternates: { canonical: `${SITE_URL}/bands/${slug}` },
    openGraph: {
      title: `${band.display_name}`,
      description: band.bio || `${band.display_name} on ${brand.name}`,
      url: `${SITE_URL}/bands/${slug}`,
      images: band.profile_picture_url ? [{ url: band.profile_picture_url }] : undefined,
    },
  };
}

export default async function PublicBandPage({ params }: Props) {
  const { slug } = await params;
  const supabase = createServiceClient();

  // 1. Band
  const { data: bandRow } = await supabase
    .from('bands')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  const band = bandRow as Band | null;
  if (!band || !band.is_public) notFound();

  // 2. Members with their profile display names
  const { data: memberRows } = await supabase
    .from('band_members')
    .select('*')
    .eq('band_id', band.id)
    .order('role', { ascending: true })
    .order('joined_at', { ascending: true });

  const members = (memberRows || []) as BandMember[];

  const { data: profileRows } = await supabase
    .from('profiles')
    .select('user_id, display_name, public_profile_slug, profile_picture_url')
    .in('user_id', members.map((m) => m.user_id));
  const profileLookup = new Map(
    (profileRows || []).map((p) => [
      p.user_id,
      p as { user_id: string; display_name: string; public_profile_slug: string; profile_picture_url: string | null },
    ])
  );

  // 3. Is the viewer a manager of this band? If so, show an "Edit" shortcut.
  const authClient = await createClient();
  const { data: { user: viewer } } = await authClient.auth.getUser();
  let viewerCanManage = false;
  if (viewer) {
    const { data: viewerMembership } = await supabase
      .from('band_members')
      .select('role, can_edit_public_page')
      .eq('band_id', band.id)
      .eq('user_id', viewer.id)
      .maybeSingle();
    viewerCanManage = !!viewerMembership && (viewerMembership.role === 'owner' || viewerMembership.can_edit_public_page);
  }

  const socials = SOCIAL_LINKS.filter(({ field }) => !!band[field]);

  return (
    <>
      {/* Hero — black with cover bleed */}
      <section className="relative bg-black text-white overflow-hidden">
        {band.cover_image_url && (
          <Image
            src={band.cover_image_url}
            alt={band.display_name}
            fill
            className="object-cover opacity-40"
            priority
            sizes="100vw"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/40 to-black/90" />
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          {viewerCanManage && (
            <Link
              href={`/dashboard/bands/${band.id}/edit`}
              className="inline-flex items-center gap-2 border border-white/30 text-white font-mono text-xs font-bold uppercase tracking-wider px-3 py-2 hover:border-accent hover:text-accent no-underline transition-colors mb-6"
            >
              <Settings className="w-3 h-3" /> Edit band
            </Link>
          )}
          <div className="flex flex-col sm:flex-row sm:items-end gap-6">
            {/* Profile picture */}
            <div className="relative w-28 h-28 sm:w-36 sm:h-36 border-4 border-white flex-shrink-0 bg-black">
              {band.profile_picture_url ? (
                <Image
                  src={band.profile_picture_url}
                  alt={band.display_name}
                  fill
                  className="object-cover"
                  sizes="144px"
                  priority
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Users className="w-12 h-12 text-white/40" strokeWidth={1.5} />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-mono text-accent text-xs sm:text-sm font-semibold tracking-[0.3em] uppercase mb-2">
                Band
              </p>
              <h1 className="text-display-md truncate">{band.display_name}</h1>
              <div className="font-mono text-sm text-white/70 mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {band.genre && <span>{band.genre}</span>}
                {band.hometown && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {band.hometown}
                  </span>
                )}
                <span>
                  {members.length} member{members.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bio + Socials */}
      {(band.bio || socials.length > 0) && (
        <section className="bg-white text-black py-16 sm:py-20 border-b-2 border-black/5">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-3 gap-10">
            <div className="lg:col-span-2">
              {band.bio && (
                <>
                  <p className="font-mono text-xs font-semibold tracking-[0.3em] uppercase mb-3 text-black/50">
                    About
                  </p>
                  <p className="font-mono text-body-md text-black/80 whitespace-pre-line leading-relaxed">
                    {band.bio}
                  </p>
                </>
              )}
            </div>

            {socials.length > 0 && (
              <div>
                <p className="font-mono text-xs font-semibold tracking-[0.3em] uppercase mb-3 text-black/50">
                  Listen & Follow
                </p>
                <div className="space-y-2">
                  {socials.map(({ field, label }) => (
                    <a
                      key={field}
                      href={band[field] as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-2 border-black/10 p-3 flex items-center justify-between hover:border-accent transition-colors no-underline group"
                    >
                      <span className="font-mono text-sm font-bold text-black group-hover:text-accent transition-colors">
                        {label}
                      </span>
                      <ExternalLink className="w-4 h-4 text-black/40 group-hover:text-accent transition-colors" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Members */}
      <section className="bg-white text-black py-16 sm:py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="font-mono text-xs font-semibold tracking-[0.3em] uppercase mb-3 text-black/50">
            Lineup
          </p>
          <h2 className="text-heading-lg mb-10">THE BAND</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
            {members.map((m) => {
              const profile = profileLookup.get(m.user_id);
              const displayName = m.stage_name || profile?.display_name || 'Member';
              const linkHref = profile?.public_profile_slug
                ? `/u/${profile.public_profile_slug}`
                : null;
              const avatar = profile?.profile_picture_url;
              const card = (
                <div className="border-2 border-black/10 hover:border-accent transition-colors overflow-hidden">
                  <div className="relative aspect-square bg-black">
                    {avatar ? (
                      <Image
                        src={avatar}
                        alt={displayName}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 50vw, 200px"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Users className="w-10 h-10 text-white/30" strokeWidth={1.5} />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="font-mono text-sm font-bold truncate">{displayName}</p>
                    <p className="font-mono text-xs text-black/60 mt-1 truncate">
                      {m.band_role || <span className="italic">Member</span>}
                    </p>
                  </div>
                </div>
              );

              return linkHref ? (
                <Link
                  key={m.id}
                  href={linkHref}
                  className="no-underline text-black hover:text-black"
                >
                  {card}
                </Link>
              ) : (
                <div key={m.id}>{card}</div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
