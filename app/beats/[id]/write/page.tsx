import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth';
import { SITE_URL } from '@/lib/constants';
import { getBrand } from '@/lib/brand-server';
import WritingPad from '@/components/beats/WritingPad';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: beat } = await supabase
    .from('beats')
    .select('title, producer')
    .eq('id', id)
    .single();

  const brand = await getBrand();
  return {
    title: beat ? `Write to "${beat.title}"` : 'Writing Pad',
    description: beat ? `Write lyrics to "${beat.title}" by ${beat.producer} on ${brand.name}.` : 'Write lyrics to beats.',
    alternates: { canonical: `${SITE_URL}/beats/${id}/write` },
  };
}

export default async function WritePage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getSessionUser();

  const { data: beat, error } = await supabase
    .from('beats')
    .select('id, title, producer, producer_id, bpm, musical_key, genre, preview_url, profiles!producer_id(display_name, producer_name, public_profile_slug)')
    .eq('id', id)
    .single();

  if (error || !beat) notFound();

  const producer = Array.isArray(beat.profiles) ? beat.profiles[0] : beat.profiles;
  const producerName = producer?.producer_name || producer?.display_name || beat.producer;
  const producerSlug = producer?.public_profile_slug;

  return (
    <>
      {/* Header */}
      <section className="bg-black text-white py-8 sm:py-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link href={`/beats/${beat.id}`} className="font-mono text-xs text-white/60 hover:text-accent uppercase tracking-wider no-underline mb-4 block">
            &larr; Back to beat
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-heading-lg mb-1">{beat.title}</h1>
              <p className="font-mono text-white/80 text-sm">
                by{' '}
                {producerSlug ? (
                  <Link href={`/u/${producerSlug}`} className="text-accent no-underline hover:underline">
                    {producerName}
                  </Link>
                ) : (
                  producerName
                )}
                {beat.bpm && ` · ${beat.bpm} BPM`}
                {beat.musical_key && ` · ${beat.musical_key}`}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Writing Pad */}
      <section className="bg-white text-black py-8 sm:py-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <WritingPad
            beat={{
              id: beat.id,
              title: beat.title,
              producer: producerName,
              producerSlug: producerSlug || undefined,
              previewUrl: beat.preview_url,
              bpm: beat.bpm,
            }}
            isLoggedIn={!!user}
          />
        </div>
      </section>
    </>
  );
}
