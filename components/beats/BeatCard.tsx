'use client';

import { Play, Pause, Heart, PenLine, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { formatCents } from '@/lib/utils';
import { useAudioPlayer, type AudioTrack } from '@/components/audio/AudioPlayerContext';

export interface BeatData {
  id: string;
  title: string;
  producer: string;
  producer_id: string | null;
  genre: string | null;
  bpm: number | null;
  musical_key: string | null;
  tags: string[];
  preview_url: string | null;
  cover_image_url: string | null;
  mp3_lease_price: number | null;
  trackout_lease_price: number | null;
  exclusive_price: number | null;
  has_exclusive: boolean;
  contains_samples: boolean;
  lease_count: number;
  status: string;
  created_at: string;
  profiles?: {
    display_name: string;
    producer_name: string | null;
    public_profile_slug: string | null;
  } | null;
}

interface BeatCardProps {
  beat: BeatData;
  isSaved?: boolean;
  onToggleSave?: (beatId: string) => void;
  showWriteButton?: boolean;
}

export default function BeatCard({ beat, isSaved, onToggleSave, showWriteButton = true }: BeatCardProps) {
  const { currentTrack, isPlaying, play, pause } = useAudioPlayer();

  const isCurrentTrack = currentTrack?.id === beat.id;
  const isThisPlaying = isCurrentTrack && isPlaying;

  const producerName = beat.profiles?.producer_name || beat.profiles?.display_name || beat.producer;
  const producerSlug = beat.profiles?.public_profile_slug;

  function handlePlayToggle() {
    if (!beat.preview_url) return;

    if (isThisPlaying) {
      pause();
    } else {
      const track: AudioTrack = {
        id: beat.id,
        title: beat.title,
        producer: producerName,
        producerSlug: producerSlug || undefined,
        previewUrl: beat.preview_url,
        coverImageUrl: beat.cover_image_url || undefined,
        genre: beat.genre || undefined,
        bpm: beat.bpm || undefined,
        musicalKey: beat.musical_key || undefined,
      };
      play(track);
    }
  }

  return (
    <div className={`border-2 transition-colors group ${
      isCurrentTrack ? 'border-accent' : 'border-black/10 hover:border-black/30'
    }`}>
      {/* Play area */}
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          {/* Play button / Cover image */}
          <button
            onClick={handlePlayToggle}
            disabled={!beat.preview_url}
            className={`w-12 h-12 flex items-center justify-center flex-shrink-0 transition-colors relative overflow-hidden ${
              beat.cover_image_url ? '' : (isThisPlaying ? 'bg-accent text-black' : 'bg-black text-white hover:bg-accent hover:text-black')
            } disabled:opacity-30`}
          >
            {beat.cover_image_url ? (
              <>
                <Image
                  src={beat.cover_image_url}
                  alt=""
                  fill
                  sizes="48px"
                  className="object-cover"
                  unoptimized={false}
                />
                <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                  isThisPlaying ? 'bg-accent/80' : 'bg-black/40 hover:bg-accent/70'
                }`}>
                  {isThisPlaying ? <Pause className="w-5 h-5 text-black" /> : <Play className="w-5 h-5 ml-0.5 text-white" />}
                </div>
              </>
            ) : (
              isThisPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />
            )}
          </button>

          {/* Track info */}
          <div className="flex-1 min-w-0">
            <Link
              href={`/beats/${beat.id}`}
              className="font-mono text-sm font-bold truncate block hover:text-accent transition-colors no-underline"
            >
              {beat.title}
            </Link>
            <p className="font-mono text-xs text-black/70 mt-0.5">
              {producerSlug ? (
                <Link href={`/u/${producerSlug}`} className="hover:text-accent no-underline">
                  {producerName}
                </Link>
              ) : (
                producerName
              )}
            </p>
            {/* Tags */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {beat.genre && (
                <span className="font-mono text-[10px] text-black/60 border border-black/10 px-1.5 py-0.5">
                  {beat.genre}
                </span>
              )}
              {beat.bpm && (
                <span className="font-mono text-[10px] text-black/60 border border-black/10 px-1.5 py-0.5">
                  {beat.bpm} BPM
                </span>
              )}
              {beat.musical_key && (
                <span className="font-mono text-[10px] text-black/60 border border-black/10 px-1.5 py-0.5">
                  {beat.musical_key}
                </span>
              )}
              {beat.contains_samples ? (
                <span className="font-mono text-[10px] text-amber-600 border border-amber-200 bg-amber-50 px-1.5 py-0.5">
                  Contains Samples
                </span>
              ) : (
                <span className="font-mono text-[10px] text-green-600 border border-green-200 bg-green-50 px-1.5 py-0.5">
                  Original
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-1 flex-shrink-0">
            {onToggleSave && (
              <button
                onClick={() => onToggleSave(beat.id)}
                className={`p-2 transition-colors ${
                  isSaved ? 'text-red-500' : 'text-black/20 hover:text-red-400'
                }`}
                title={isSaved ? 'Remove from saved' : 'Save beat'}
              >
                <Heart className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
              </button>
            )}
            {showWriteButton && (
              <Link
                href={`/beats/${beat.id}/write`}
                className="p-2 text-black/20 hover:text-accent transition-colors"
                title="Write to this beat"
              >
                <PenLine className="w-4 h-4" />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Pricing bar */}
      <div className="border-t border-black/10 px-4 sm:px-5 py-3 flex items-center justify-between gap-2 bg-black/[0.02]">
        <div className="flex flex-wrap gap-3">
          {beat.mp3_lease_price && (
            <Link
              href={`/beats/${beat.id}?license=mp3_lease`}
              className="font-mono text-xs text-black/60 hover:text-accent no-underline transition-colors"
            >
              MP3 {formatCents(beat.mp3_lease_price)}
            </Link>
          )}
          {beat.trackout_lease_price && (
            <Link
              href={`/beats/${beat.id}?license=trackout_lease`}
              className="font-mono text-xs text-black/60 hover:text-accent no-underline transition-colors"
            >
              Trackout {formatCents(beat.trackout_lease_price)}
            </Link>
          )}
          {beat.exclusive_price && beat.has_exclusive && (
            <Link
              href={`/beats/${beat.id}?license=exclusive`}
              className="font-mono text-xs text-accent font-bold hover:text-accent/80 no-underline transition-colors"
            >
              Exclusive {formatCents(beat.exclusive_price)}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          {beat.lease_count > 0 && (
            <span className="font-mono text-[10px] text-black/60">{beat.lease_count} sold</span>
          )}
          {beat.has_exclusive && beat.exclusive_price && beat.lease_count >= 3 && (
            <span className="font-mono text-[10px] text-amber-600 inline-flex items-center gap-0.5" title="Exclusive price increases with demand">
              <TrendingUp className="w-3 h-3" /> Price rising
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
