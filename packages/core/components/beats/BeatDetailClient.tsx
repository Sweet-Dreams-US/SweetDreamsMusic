'use client';

import { Play, Pause, Repeat } from 'lucide-react';
import { useAudioPlayer, type AudioTrack } from '@/components/audio/AudioPlayerContext';

interface BeatDetailClientProps {
  beat: {
    id: string;
    title: string;
    producer: string;
    producerSlug?: string;
    previewUrl: string | null;
    genre?: string | null;
    bpm?: number | null;
    musicalKey?: string | null;
  };
}

export default function BeatDetailClient({ beat }: BeatDetailClientProps) {
  const { currentTrack, isPlaying, isLooping, play, pause, toggleLoop } = useAudioPlayer();

  const isCurrentTrack = currentTrack?.id === beat.id;
  const isThisPlaying = isCurrentTrack && isPlaying;

  function handlePlayToggle() {
    if (!beat.previewUrl) return;

    if (isThisPlaying) {
      pause();
    } else {
      const track: AudioTrack = {
        id: beat.id,
        title: beat.title,
        producer: beat.producer,
        producerSlug: beat.producerSlug,
        previewUrl: beat.previewUrl,
        genre: beat.genre || undefined,
        bpm: beat.bpm || undefined,
        musicalKey: beat.musicalKey || undefined,
      };
      play(track);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={handlePlayToggle}
        disabled={!beat.previewUrl}
        className={`w-16 h-16 flex items-center justify-center flex-shrink-0 transition-colors ${
          isThisPlaying
            ? 'bg-accent text-black'
            : 'bg-white text-black hover:bg-accent'
        } disabled:opacity-30`}
      >
        {isThisPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-1" />}
      </button>

      <button
        onClick={toggleLoop}
        className={`p-3 border transition-colors ${
          isLooping && isCurrentTrack
            ? 'border-accent text-accent'
            : 'border-white/20 text-white/40 hover:text-white/70'
        }`}
        title={isLooping ? 'Loop on' : 'Loop off'}
      >
        <Repeat className="w-5 h-5" />
      </button>

      <p className="font-mono text-xs text-white/70">
        {isThisPlaying ? 'Playing...' : beat.previewUrl ? 'Click to preview' : 'No preview available'}
      </p>
    </div>
  );
}
