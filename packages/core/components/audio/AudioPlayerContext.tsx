'use client';

import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

export interface AudioTrack {
  id: string;
  title: string;
  producer: string;
  producerSlug?: string;
  previewUrl: string;
  coverImageUrl?: string;
  genre?: string;
  bpm?: number;
  musicalKey?: string;
}

interface AudioPlayerState {
  currentTrack: AudioTrack | null;
  isPlaying: boolean;
  isLooping: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  play: (track: AudioTrack) => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (time: number) => void;
  setVolume: (v: number) => void;
  toggleLoop: () => void;
  close: () => void;
}

const AudioPlayerContext = createContext<AudioPlayerState | null>(null);

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  return ctx;
}

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTrack, setCurrentTrack] = useState<AudioTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.8);

  // Initialize audio element once
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const audio = new Audio();
    audio.volume = 0.8;
    audioRef.current = audio;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      if (audio.loop) return;
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Wrap audio.play() so we can swallow the harmless AbortError that
  // fires when the user rapidly switches tracks (the browser reports the
  // PREVIOUS play() promise as interrupted by the new src/load). Anything
  // else still surfaces. https://goo.gl/LdLk22
  const safePlay = (audio: HTMLAudioElement) => {
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.catch((err: unknown) => {
        if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
          // AbortError: superseded by another src change. NotAllowedError:
          // browser autoplay policy (e.g., before any user gesture). Both
          // are user-recoverable — they'll click again, we don't want to log.
          return;
        }
        console.error('[audio] play error:', err);
      });
    }
  };

  const play = useCallback((track: AudioTrack) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (currentTrack?.id === track.id) {
      // Same track — just resume.
      safePlay(audio);
    } else {
      // New track. The order matters: pause first to release any pending
      // play() promise from the prior src, THEN swap src + call load() to
      // make the abort intent explicit, THEN play. This is the canonical
      // workaround for the "play() interrupted by a new load request" race
      // when the user clicks one beat then quickly clicks another.
      audio.pause();
      audio.src = track.previewUrl;
      audio.loop = isLooping;
      audio.load();
      safePlay(audio);
      setCurrentTrack(track);
      setCurrentTime(0);

      // Track play count (fire-and-forget)
      fetch('/api/beats/track-play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beatId: track.id }),
      }).catch(() => {});
    }
  }, [currentTrack?.id, isLooping]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (audio.paused) {
      safePlay(audio);
    } else {
      audio.pause();
    }
  }, [currentTrack]);

  const seekTo = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setCurrentTime(time);
  }, []);

  const setVolume = useCallback((v: number) => {
    const audio = audioRef.current;
    if (audio) audio.volume = v;
    setVolumeState(v);
  }, []);

  const toggleLoop = useCallback(() => {
    const audio = audioRef.current;
    const newLoop = !isLooping;
    if (audio) audio.loop = newLoop;
    setIsLooping(newLoop);
  }, [isLooping]);

  const close = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    setCurrentTrack(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  return (
    <AudioPlayerContext.Provider value={{
      currentTrack,
      isPlaying,
      isLooping,
      currentTime,
      duration,
      volume,
      play,
      pause,
      toggle,
      seekTo,
      setVolume,
      toggleLoop,
      close,
    }}>
      {children}
    </AudioPlayerContext.Provider>
  );
}
