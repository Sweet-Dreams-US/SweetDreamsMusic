'use client';

import { Play, Pause } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { formatCents } from '@/lib/utils';
import { useAudioPlayer, type AudioTrack } from '@/components/audio/AudioPlayerContext';

interface ProfileBeat {
  id: string;
  title: string;
  genre: string | null;
  bpm: number | null;
  musical_key: string | null;
  preview_url: string | null;
  cover_image_url: string | null;
  mp3_lease_price: number | null;
  trackout_lease_price: number | null;
  exclusive_price: number | null;
  has_exclusive: boolean;
  lease_count: number;
  producer?: string;
  producerSlug?: string;
}

export default function ProfileBeatGrid({ beats, producerName, producerSlug }: {
  beats: ProfileBeat[];
  producerName: string;
  producerSlug?: string;
}) {
  const { currentTrack, isPlaying, play, pause } = useAudioPlayer();

  function handlePlay(beat: ProfileBeat) {
    if (!beat.preview_url) return;

    const isThisPlaying = currentTrack?.id === beat.id && isPlaying;
    if (isThisPlaying) {
      pause();
    } else {
      const track: AudioTrack = {
        id: beat.id,
        title: beat.title,
        producer: producerName,
        producerSlug,
        previewUrl: beat.preview_url,
        genre: beat.genre || undefined,
        bpm: beat.bpm || undefined,
        musicalKey: beat.musical_key || undefined,
      };
      play(track);
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {beats.map((beat) => {
        const isThisPlaying = currentTrack?.id === beat.id && isPlaying;

        return (
          <div key={beat.id} className="border-2 border-black/10 hover:border-accent transition-colors overflow-hidden">
            <div className="flex items-stretch">
              {/* Cover + Play */}
              <button
                onClick={() => handlePlay(beat)}
                disabled={!beat.preview_url}
                className="w-20 h-20 flex-shrink-0 relative flex items-center justify-center bg-black/5 overflow-hidden group"
              >
                {beat.cover_image_url ? (
                  <Image
                    src={beat.cover_image_url}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                ) : null}
                <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                  beat.cover_image_url ? 'bg-black/40 opacity-0 group-hover:opacity-100' : ''
                }`}>
                  {isThisPlaying ? (
                    <Pause className="w-6 h-6 text-white" />
                  ) : (
                    <Play className="w-6 h-6 text-white ml-0.5" />
                  )}
                </div>
              </button>

              {/* Info */}
              <Link href={`/beats/${beat.id}`} className="flex-1 p-4 no-underline min-w-0">
                <p className="font-mono text-sm font-bold truncate">{beat.title}</p>
                <p className="font-mono text-xs text-black/60 mt-0.5">
                  {beat.genre}{beat.bpm ? ` · ${beat.bpm} BPM` : ''}{beat.musical_key ? ` · ${beat.musical_key}` : ''}
                </p>
                <div className="flex gap-3 mt-2">
                  {beat.mp3_lease_price && (
                    <span className="font-mono text-[10px] text-black/60">MP3 {formatCents(beat.mp3_lease_price)}</span>
                  )}
                  {beat.trackout_lease_price && (
                    <span className="font-mono text-[10px] text-black/60">Trackout {formatCents(beat.trackout_lease_price)}</span>
                  )}
                  {beat.exclusive_price && beat.has_exclusive && (
                    <span className="font-mono text-[10px] text-accent font-bold">Excl {formatCents(beat.exclusive_price)}</span>
                  )}
                </div>
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
