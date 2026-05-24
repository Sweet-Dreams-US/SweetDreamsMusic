'use client';

import { useAudioPlayer } from './AudioPlayerContext';
import { Play, Pause, Repeat, Volume2, VolumeX, X } from 'lucide-react';
import Link from 'next/link';

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AudioPlayerBar() {
  const {
    currentTrack,
    isPlaying,
    isLooping,
    currentTime,
    duration,
    volume,
    toggle,
    seekTo,
    setVolume,
    toggleLoop,
    close,
  } = useAudioPlayer();

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seekTo(pct * duration);
  }

  // Keyboard support for the seek bar — Left/Right = ±5s, Home/End = jump
  // to start/end, PageUp/PageDown = ±15s. WCAG 2.1.1 (Keyboard) and ARIA
  // slider best practice.
  function handleProgressKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!duration) return;
    let target: number | null = null;
    switch (e.key) {
      case 'ArrowLeft': target = Math.max(0, currentTime - 5); break;
      case 'ArrowRight': target = Math.min(duration, currentTime + 5); break;
      case 'PageDown': target = Math.max(0, currentTime - 15); break;
      case 'PageUp': target = Math.min(duration, currentTime + 15); break;
      case 'Home': target = 0; break;
      case 'End': target = duration; break;
      default: return;
    }
    if (target !== null) {
      e.preventDefault();
      seekTo(target);
    }
  }

  const trackLabel = `${currentTrack.title} by ${currentTrack.producer}`;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 bg-black text-white z-40 border-t border-white/10"
      role="region"
      aria-label="Audio player"
    >
      {/* Progress bar — exposed as an ARIA slider so screen readers + keyboard
          users can scrub. Click handler stays for mouse users; keyboard
          users get ±5s arrows, ±15s PageUp/Down, Home/End for ends. */}
      <div
        className="h-1 bg-white/10 cursor-pointer group focus:outline-none focus:ring-2 focus:ring-accent"
        onClick={handleProgressClick}
        onKeyDown={handleProgressKey}
        role="slider"
        tabIndex={0}
        aria-label={`Seek through ${currentTrack.title}`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.floor(duration))}
        aria-valuenow={Math.floor(currentTime)}
        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
      >
        <div
          className="h-full bg-accent transition-[width] duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 py-3">
          {/* Play/Pause */}
          <button
            onClick={toggle}
            className="w-10 h-10 bg-accent text-black flex items-center justify-center flex-shrink-0 hover:bg-accent/90 transition-colors"
            aria-label={isPlaying ? `Pause ${trackLabel}` : `Play ${trackLabel}`}
            aria-pressed={isPlaying}
          >
            {isPlaying ? <Pause className="w-5 h-5" aria-hidden="true" /> : <Play className="w-5 h-5 ml-0.5" aria-hidden="true" />}
          </button>

          {/* Track info */}
          <div className="flex-1 min-w-0">
            <p className="font-mono text-sm font-semibold truncate">{currentTrack.title}</p>
            <p className="font-mono text-xs text-white/70 truncate">
              {currentTrack.producerSlug ? (
                <Link href={`/u/${currentTrack.producerSlug}`} className="hover:text-accent no-underline">
                  {currentTrack.producer}
                </Link>
              ) : (
                currentTrack.producer
              )}
              {currentTrack.bpm && ` · ${currentTrack.bpm} BPM`}
              {currentTrack.musicalKey && ` · ${currentTrack.musicalKey}`}
            </p>
          </div>

          {/* Time */}
          <span
            className="font-mono text-[10px] text-white/60 hidden sm:block flex-shrink-0"
            aria-live="off"
          >
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Loop */}
          <button
            onClick={toggleLoop}
            className={`p-2 transition-colors flex-shrink-0 ${
              isLooping ? 'text-accent' : 'text-white/30 hover:text-white/60'
            }`}
            aria-label={isLooping ? 'Disable loop' : 'Enable loop'}
            aria-pressed={isLooping}
            title={isLooping ? 'Loop on' : 'Loop off'}
          >
            <Repeat className="w-4 h-4" aria-hidden="true" />
          </button>

          {/* Volume */}
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
              className="text-white/30 hover:text-white/60 transition-colors"
              aria-label={volume === 0 ? 'Unmute' : 'Mute'}
              aria-pressed={volume === 0}
            >
              {volume === 0
                ? <VolumeX className="w-4 h-4" aria-hidden="true" />
                : <Volume2 className="w-4 h-4" aria-hidden="true" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-20 accent-accent h-1"
              aria-label="Volume"
              aria-valuetext={`${Math.round(volume * 100)} percent`}
            />
          </div>

          {/* Close */}
          <button
            onClick={close}
            className="text-white/30 hover:text-white/60 p-2 transition-colors flex-shrink-0"
            aria-label="Close audio player"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
