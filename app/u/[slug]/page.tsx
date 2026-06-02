import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Music, ExternalLink, Settings } from 'lucide-react';
import { createServiceClient, createClient } from '@/lib/supabase/server';
import ProfileBeatGrid from '@/components/beats/ProfileBeatGrid';
import { fmtStampDate } from '@/lib/studio-time';

type Props = {
  params: Promise<{ slug: string }>;
};

const SOCIAL_ICONS: Record<string, string> = {
  spotify: 'Spotify',
  appleMusic: 'Apple Music',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  tiktok: 'TikTok',
  twitter: 'X',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const supabase = createServiceClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, bio')
    .eq('public_profile_slug', slug)
    .single();

  if (!profile) return { title: 'Profile Not Found' };

  return {
    title: `${profile.display_name}`,
    description: profile.bio || `${profile.display_name} on Sweet Dreams Music`,
  };
}

export default async function PublicProfilePage({ params }: Props) {
  const { slug } = await params;
  const supabase = createServiceClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('public_profile_slug', slug)
    .single();

  if (!profile) notFound();

  const authClient = await createClient();
  const { data: { user: currentUser } } = await authClient.auth.getUser();
  const isOwner = currentUser?.id === profile.user_id;

  // Fetch public audio showcase
  const { data: showcaseItems } = await supabase
    .from('profile_audio_showcase')
    .select(`
      id, custom_title, custom_description, display_order, is_public, is_released,
      spotify_link, apple_music_link, youtube_link, soundcloud_link, custom_links,
      deliverable_id, profile_audio_path
    `)
    .eq('user_id', profile.user_id)
    .eq('is_public', true)
    .order('display_order', { ascending: true });

  let deliverables: Record<string, { file_name: string; display_name: string; file_path: string; created_at: string }> = {};
  if (showcaseItems && showcaseItems.length > 0) {
    const deliverableIds = showcaseItems.map((item) => item.deliverable_id);
    const { data: deliverableData } = await supabase
      .from('deliverables')
      .select('id, file_name, display_name, file_path, created_at')
      .in('id', deliverableIds);

    if (deliverableData) {
      deliverables = Object.fromEntries(deliverableData.map((d) => [d.id, d]));
    }
  }

  // Fetch public projects
  const { data: projects } = await supabase
    .from('profile_projects')
    .select('*')
    .eq('user_id', profile.user_id)
    .eq('is_public', true)
    .order('display_order', { ascending: true });

  // Fetch producer beats if user is a producer
  let producerBeats: { id: string; title: string; genre: string | null; bpm: number | null; musical_key: string | null; preview_url: string | null; cover_image_url: string | null; mp3_lease_price: number | null; trackout_lease_price: number | null; exclusive_price: number | null; has_exclusive: boolean; lease_count: number }[] = [];
  if (profile.is_producer) {
    const { data: beats } = await supabase
      .from('beats')
      .select('id, title, genre, bpm, musical_key, preview_url, cover_image_url, mp3_lease_price, trackout_lease_price, exclusive_price, has_exclusive, lease_count')
      .eq('producer_id', profile.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    producerBeats = beats || [];
  }

  // Split into released vs unreleased
  const releasedItems = (showcaseItems || []).filter(item => item.is_released);
  const unreleasedItems = (showcaseItems || []).filter(item => !item.is_released);
  const hasShowcase = showcaseItems && showcaseItems.length > 0;
  const hasReleased = releasedItems.length > 0;
  const hasUnreleased = unreleasedItems.length > 0;
  const hasProjects = projects && projects.length > 0;
  const hasBeats = producerBeats.length > 0;
  const socialLinks = (profile.social_links || {}) as Record<string, string>;
  const hasSocialLinks = Object.values(socialLinks).some(Boolean);
  const isEmpty = !hasShowcase && !hasProjects && !hasBeats && !profile.bio;

  return (
    <>
      {/* Cover Photo */}
      {profile.cover_photo_url && (
        <div className="w-full aspect-[3/1] bg-black overflow-hidden">
          <img
            src={profile.cover_photo_url}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Profile Header */}
      <section className={`bg-black text-white ${profile.cover_photo_url ? 'py-10 sm:py-14' : 'py-16 sm:py-24'}`}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-8">
            {/* Profile Picture */}
            <div className={`w-32 h-32 sm:w-40 sm:h-40 flex-shrink-0 bg-white/5 flex items-center justify-center overflow-hidden ${profile.cover_photo_url ? '-mt-20 sm:-mt-24 border-4 border-black' : ''}`}>
              {profile.profile_picture_url ? (
                <img
                  src={profile.profile_picture_url}
                  alt={profile.display_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="font-heading text-5xl text-white/10">
                  {profile.display_name?.[0]?.toUpperCase() || '?'}
                </span>
              )}
            </div>

            <div className="text-center sm:text-left flex-1">
              <h1 className="text-display-sm mb-3">{profile.display_name}</h1>

              {/* Career Stage & Genre Badges */}
              {(profile.career_stage || profile.genre) && (
                <div className="flex flex-wrap gap-2 mb-3 justify-center sm:justify-start">
                  {profile.career_stage && (
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider bg-white/10 text-accent px-3 py-1">
                      {profile.career_stage}
                    </span>
                  )}
                  {profile.genre && (
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider bg-white/10 text-white/70 px-3 py-1">
                      {profile.genre}
                    </span>
                  )}
                </div>
              )}

              {profile.bio && (
                <p className="font-mono text-white/60 text-body-sm max-w-lg whitespace-pre-line">{profile.bio}</p>
              )}

              {/* Social Links */}
              {hasSocialLinks && (
                <div className="flex flex-wrap gap-3 mt-4 justify-center sm:justify-start">
                  {Object.entries(socialLinks).map(([platform, url]) => (
                    url && (
                      <a
                        key={platform}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-accent hover:text-white transition-colors uppercase tracking-wider inline-flex items-center gap-1"
                      >
                        {SOCIAL_ICONS[platform] || platform} <ExternalLink className="w-3 h-3" />
                      </a>
                    )
                  ))}
                </div>
              )}

              {isOwner && (
                <Link
                  href="/dashboard/profile"
                  className="inline-flex items-center gap-2 mt-6 border border-white/20 text-white/60 font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:border-accent hover:text-accent transition-colors no-underline"
                >
                  <Settings className="w-3 h-3" /> Edit Profile
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Owner empty state */}
      {isOwner && isEmpty && (
        <section className="bg-white text-black py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="font-mono text-sm text-black/70 mb-2">Your profile is looking empty.</p>
            <p className="font-mono text-xs text-black/60 max-w-md mx-auto">
              Add a bio, upload photos, link your socials, and showcase your music and projects.
            </p>
            <Link
              href="/dashboard/profile"
              className="inline-block mt-6 bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-6 py-3 hover:bg-accent/90 transition-colors no-underline"
            >
              Set Up Your Profile
            </Link>
          </div>
        </section>
      )}

      {/* Released Music */}
      {hasReleased && (
        <section className="bg-white text-black py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-heading-xl mb-8">MUSIC</h2>
            <div className="space-y-4">
              {releasedItems.map((item) => {
                const deliverable = deliverables[item.deliverable_id];
                const title = item.custom_title || deliverable?.display_name || deliverable?.file_name || 'Untitled';

                return (
                  <div key={item.id} className="border-2 border-black p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                    <Music className="w-8 h-8 text-accent flex-shrink-0" />
                    <div className="flex-1">
                      <h3 className="font-mono text-sm font-bold">{title}</h3>
                      {item.custom_description && (
                        <p className="font-mono text-xs text-black/70 mt-1">{item.custom_description}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.spotify_link && (
                        <a href={item.spotify_link} target="_blank" rel="noopener noreferrer"
                          className="font-mono text-xs border border-black/20 px-3 py-1 hover:border-accent transition-colors no-underline">
                          Spotify
                        </a>
                      )}
                      {item.apple_music_link && (
                        <a href={item.apple_music_link} target="_blank" rel="noopener noreferrer"
                          className="font-mono text-xs border border-black/20 px-3 py-1 hover:border-accent transition-colors no-underline">
                          Apple Music
                        </a>
                      )}
                      {item.youtube_link && (
                        <a href={item.youtube_link} target="_blank" rel="noopener noreferrer"
                          className="font-mono text-xs border border-black/20 px-3 py-1 hover:border-accent transition-colors no-underline">
                          YouTube
                        </a>
                      )}
                      {item.soundcloud_link && (
                        <a href={item.soundcloud_link} target="_blank" rel="noopener noreferrer"
                          className="font-mono text-xs border border-black/20 px-3 py-1 hover:border-accent transition-colors no-underline">
                          SoundCloud
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Unreleased Music */}
      {hasUnreleased && (
        <section className={`${hasReleased ? 'bg-black/[0.02]' : 'bg-white'} text-black py-16 sm:py-24`}>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-heading-xl mb-2">UNRELEASED</h2>
            <p className="font-mono text-xs text-black/60 mb-8">Exclusive previews — recorded at Sweet Dreams Music</p>
            <div className="space-y-4">
              {unreleasedItems.map((item) => {
                const deliverable = deliverables[item.deliverable_id];
                const title = item.custom_title || deliverable?.display_name || deliverable?.file_name || 'Untitled';
                const audioPath = item.profile_audio_path || deliverable?.file_path;
                const recordedDate = deliverable?.created_at
                  ? fmtStampDate(deliverable.created_at, { month: 'short', day: 'numeric', year: 'numeric' })
                  : null;

                return (
                  <div key={item.id} className="border-2 border-black/20 p-5 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <Music className="w-8 h-8 text-accent flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-mono text-sm font-bold truncate">{title}</h3>
                        <div className="font-mono text-xs text-black/60 mt-1 flex items-center gap-3 flex-wrap">
                          {recordedDate && <span>Recorded {recordedDate}</span>}
                          <span className="text-[10px] uppercase tracking-wider bg-black/5 px-2 py-0.5 font-bold">Unreleased</span>
                        </div>
                        {item.custom_description && (
                          <p className="font-mono text-xs text-black/70 mt-2">{item.custom_description}</p>
                        )}
                      </div>
                    </div>
                    {audioPath && (
                      <div className="mt-4">
                        <audio controls preload="none" className="w-full" style={{ height: '40px' }}>
                          <source
                            src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/profile-audio/${audioPath}`}
                            type="audio/mpeg"
                          />
                        </audio>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Projects */}
      {hasProjects && (
        <section className="bg-black text-white py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-heading-xl mb-8">PROJECTS</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {projects.map((project) => {
                const links = (project.links || {}) as Record<string, string>;
                const hasLinks = Object.values(links).some(Boolean) || project.link;
                const PLATFORM_LABELS: Record<string, string> = {
                  spotify: 'Spotify',
                  appleMusic: 'Apple Music',
                  youtube: 'YouTube',
                  soundcloud: 'SoundCloud',
                  tidal: 'Tidal',
                  amazonMusic: 'Amazon Music',
                  other: 'Listen',
                };

                return (
                  <div
                    key={project.id}
                    className="border border-white/10 overflow-hidden hover:border-accent/50 transition-colors"
                  >
                    {project.cover_image_url && (
                      <Image
                        src={project.cover_image_url}
                        alt={project.project_name}
                        width={400}
                        height={400}
                        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                        className="w-full aspect-square object-cover"
                      />
                    )}
                    <div className="p-6">
                      <h3 className="text-heading-sm mb-1 text-white">{project.project_name}</h3>
                      {project.project_type && (
                        <p className="font-mono text-xs text-accent uppercase tracking-wider mb-2">{project.project_type}</p>
                      )}
                      {project.description && (
                        <p className="font-mono text-xs text-white/80">{project.description}</p>
                      )}
                      {hasLinks && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {Object.entries(links).map(([platform, url]) => (
                            url && (
                              <a
                                key={platform}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-[10px] text-accent border border-accent/30 px-2.5 py-1 hover:bg-accent hover:text-black transition-colors no-underline inline-flex items-center gap-1"
                              >
                                {PLATFORM_LABELS[platform] || platform} <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )
                          ))}
                          {project.link && !Object.values(links).some(Boolean) && (
                            <a
                              href={project.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-[10px] text-accent border border-accent/30 px-2.5 py-1 hover:bg-accent hover:text-black transition-colors no-underline inline-flex items-center gap-1"
                            >
                              Listen <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Producer Beats */}
      {hasBeats && (
        <section className="bg-white text-black py-16 sm:py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-heading-xl mb-8">BEATS</h2>
            <ProfileBeatGrid
              beats={producerBeats}
              producerName={profile.producer_name || profile.display_name || ''}
              producerSlug={profile.public_profile_slug || undefined}
            />
          </div>
        </section>
      )}

      {/* Footer CTA */}
      {!isOwner && (
        <section className="bg-white text-black py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="font-mono text-sm text-black/70 mb-4">
              Want your own profile?
            </p>
            <Link href="/login"
              className="font-mono text-sm font-bold text-accent hover:underline">
              Create an account at Sweet Dreams Music
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
