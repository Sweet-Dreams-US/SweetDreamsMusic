import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/server';
import { formatCents } from '@/lib/utils';
import { BEAT_LICENSES, SITE_URL } from '@/lib/constants';
import { looksLikeUuid, beatHref } from '@/lib/slug';
import BeatDetailClient from '@/components/beats/BeatDetailClient';
import BuyButton from '@/components/beats/BuyButton';
import MessageButton from '@/components/messaging/MessageButton';
import { getSessionUser } from '@/lib/auth';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const byUuid = looksLikeUuid(id);
  const { data: beat } = await (byUuid
    ? supabase.from('beats').select('title, producer, genre, slug').eq('id', id)
    : supabase.from('beats').select('title, producer, genre, slug').eq('slug', id)
  ).maybeSingle();

  if (!beat) return { title: 'Beat Not Found' };

  return {
    title: `${beat.title} by ${beat.producer}`,
    description: `Buy "${beat.title}" by ${beat.producer}. ${beat.genre || 'Beat'} available for lease or exclusive purchase on Sweet Dreams Music.`,
    alternates: { canonical: `${SITE_URL}/beats/${beat.slug || id}` },
  };
}

export default async function BeatDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const byUuid = looksLikeUuid(id);

  // Resolve by slug (readable URL) or UUID (legacy/back-compat). user_id is
  // needed for the "Message Producer" DM button (Round 9d) — the FK to
  // auth.users, distinct from profiles.id (the row's PK).
  const sel = '*, profiles!producer_id(id, user_id, display_name, producer_name, public_profile_slug, profile_picture_url, bio)';
  const { data: beat, error } = await (byUuid
    ? supabase.from('beats').select(sel).eq('id', id)
    : supabase.from('beats').select(sel).eq('slug', id)
  ).maybeSingle();

  if (error || !beat) notFound();

  // Canonicalize: a hit via the legacy UUID 308-redirects to the readable slug.
  if (byUuid && beat.slug) permanentRedirect(`/beats/${beat.slug}`);

  // Round 9d: only show "Message Producer" to logged-in users who aren't
  // the producer themselves. Anonymous viewers get a sign-in prompt
  // baked into the auth flow elsewhere.
  const viewer = await getSessionUser();

  const producer = beat.profiles;
  const producerName = producer?.producer_name || producer?.display_name || beat.producer;
  const canMessageProducer =
    !!viewer &&
    !!producer?.user_id &&
    producer.user_id !== viewer.id;

  return (
    <>
      {/* Hero section */}
      <section className="bg-black text-white py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row gap-12">
            {/* Left: Beat info + player */}
            <div className="flex-1">
              <Link href="/beats" className="font-mono text-xs text-white/60 hover:text-accent uppercase tracking-wider no-underline mb-4 block">
                &larr; Back to beats
              </Link>
              <div className="flex items-start gap-6 mb-6">
                {beat.cover_image_url && (
                  <Image
                    src={beat.cover_image_url}
                    alt={beat.title}
                    width={160}
                    height={160}
                    sizes="(min-width: 640px) 160px, 128px"
                    priority
                    className="w-32 h-32 sm:w-40 sm:h-40 object-cover flex-shrink-0 border border-white/10"
                  />
                )}
                <div>
                  <h1 className="text-display-md mb-3">{beat.title}</h1>
                  <p className="font-mono text-white/80 text-lg mb-3">
                    by{' '}
                    {producer?.public_profile_slug ? (
                      <Link href={`/u/${producer.public_profile_slug}`} className="text-accent hover:underline no-underline">
                        {producerName}
                      </Link>
                    ) : (
                      producerName
                    )}
                  </p>
                  {canMessageProducer && (
                    <MessageButton
                      targetUserId={producer.user_id}
                      targetLabel={producerName}
                      size="sm"
                      variant="secondary"
                    />
                  )}
                </div>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-2 mb-8">
                {beat.genre && (
                  <span className="font-mono text-xs text-white/80 border border-white/20 px-3 py-1">
                    {beat.genre}
                  </span>
                )}
                {beat.bpm && (
                  <span className="font-mono text-xs text-white/80 border border-white/20 px-3 py-1">
                    {beat.bpm} BPM
                  </span>
                )}
                {beat.musical_key && (
                  <span className="font-mono text-xs text-white/80 border border-white/20 px-3 py-1">
                    {beat.musical_key}
                  </span>
                )}
                {beat.tags?.map((tag: string) => (
                  <span key={tag} className="font-mono text-xs text-white/60 border border-white/10 px-3 py-1">
                    {tag}
                  </span>
                ))}
              </div>

              {/* Player */}
              <BeatDetailClient beat={{
                id: beat.id,
                title: beat.title,
                producer: producerName,
                producerSlug: producer?.public_profile_slug || undefined,
                previewUrl: beat.preview_url,
                genre: beat.genre,
                bpm: beat.bpm,
                musicalKey: beat.musical_key,
              }} />

              {/* Info badges */}
              <div className="flex flex-wrap gap-3 mt-4">
                {beat.lease_count > 0 && (
                  <span className="font-mono text-[10px] text-white/60">
                    {beat.lease_count} lease{beat.lease_count !== 1 ? 's' : ''} sold
                  </span>
                )}
                {beat.contains_samples && (
                  <span className="font-mono text-[10px] text-amber-400 border border-amber-400/30 px-2 py-0.5">
                    Contains Samples
                  </span>
                )}
                {beat.has_exclusive && beat.exclusive_price && beat.lease_count >= 3 && (
                  <span className="font-mono text-[10px] text-amber-400 border border-amber-400/30 px-2 py-0.5">
                    Exclusive price increases with demand
                  </span>
                )}
              </div>
            </div>

            {/* Right: License pricing table */}
            <div className="lg:w-96 flex-shrink-0">
              <h2 className="font-mono text-xs text-white/60 uppercase tracking-wider mb-4">Choose a License</h2>
              <div className="space-y-3">
                {beat.mp3_lease_price && (
                  <LicenseOption
                    beatId={beat.id}
                    type="mp3_lease"
                    name={BEAT_LICENSES.mp3_lease.name}
                    description={BEAT_LICENSES.mp3_lease.description}
                    delivery={BEAT_LICENSES.mp3_lease.deliveryFormat}
                    price={beat.mp3_lease_price}
                  />
                )}
                {beat.trackout_lease_price && (
                  <LicenseOption
                    beatId={beat.id}
                    type="trackout_lease"
                    name={BEAT_LICENSES.trackout_lease.name}
                    description={BEAT_LICENSES.trackout_lease.description}
                    delivery={BEAT_LICENSES.trackout_lease.deliveryFormat}
                    price={beat.trackout_lease_price}
                  />
                )}
                {beat.exclusive_price && beat.has_exclusive && (
                  <LicenseOption
                    beatId={beat.id}
                    type="exclusive"
                    name={BEAT_LICENSES.exclusive.name}
                    description={BEAT_LICENSES.exclusive.description}
                    delivery={BEAT_LICENSES.exclusive.deliveryFormat}
                    price={beat.exclusive_price}
                    isExclusive
                  />
                )}
              </div>

              <Link
                href={`${beatHref(beat)}/write`}
                className="mt-6 w-full border border-white/20 text-white font-mono text-sm font-bold uppercase tracking-wider px-6 py-3 hover:border-accent hover:text-accent transition-colors no-underline flex items-center justify-center"
              >
                Write to This Beat
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function LicenseOption({
  beatId,
  type,
  name,
  description,
  delivery,
  price,
  isExclusive,
}: {
  beatId: string;
  type: string;
  name: string;
  description: string;
  delivery: string;
  price: number;
  isExclusive?: boolean;
}) {
  return (
    <div className={`border p-5 ${isExclusive ? 'border-accent' : 'border-white/10'} hover:border-accent/50 transition-colors`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-mono text-sm font-bold">{name}</h3>
          <p className="font-mono text-[10px] text-white/70 mt-1">{description}</p>
        </div>
        <span className={`font-mono text-lg font-bold flex-shrink-0 ml-4 ${isExclusive ? 'text-accent' : 'text-white'}`}>
          {formatCents(price)}
        </span>
      </div>
      <p className="font-mono text-[10px] text-white/60 mb-3">Delivery: {delivery}</p>
      <BuyButton beatId={beatId} licenseType={type} isExclusive={isExclusive} />
    </div>
  );
}

