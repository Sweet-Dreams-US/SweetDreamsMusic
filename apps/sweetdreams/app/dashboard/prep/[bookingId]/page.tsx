'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Music, Mic, Sliders, Headphones, Sparkles, Upload, Link as LinkIcon,
  Plus, X, Check, Loader2, ArrowLeft, ChevronDown, AlertCircle,
  FileAudio, ExternalLink
} from 'lucide-react';
import { ROOM_LABELS, type Room } from '@/lib/constants';
import { formatCents, formatDuration } from '@/lib/utils';
import { fmtSessionDate, fmtSessionTime } from '@/lib/studio-time';

type Booking = {
  id: string;
  start_time: string;
  duration: number;
  room: string;
  engineer_name: string | null;
  total_amount: number;
  status: string;
};

type ReferenceTrack = {
  title: string;
  artist: string;
  link: string;
  notes: string;
};

type PrepData = {
  session_type: string;
  session_goals: string;
  has_beat: boolean;
  beat_source: string;
  beat_file_url: string;
  beat_file_name: string;
  beat_link: string;
  beat_notes: string;
  reference_tracks: ReferenceTrack[];
  has_lyrics: boolean;
  lyrics_status: string;
  lyrics_text: string;
  vocal_style: string;
  special_requests: string;
  num_songs: number;
  previous_session: boolean;
  completed: boolean;
};

const SESSION_TYPES = [
  { key: 'recording', label: 'Recording', icon: Mic, desc: 'Record vocals, instruments, or spoken word' },
  { key: 'mixing', label: 'Mixing', icon: Sliders, desc: 'Mix and balance an existing track' },
  { key: 'mastering', label: 'Mastering', icon: Headphones, desc: 'Final master for distribution' },
  { key: 'production', label: 'Production', icon: Sparkles, desc: 'Build a beat or produce from scratch' },
  { key: 'recording_production', label: 'Record + Produce', icon: Music, desc: 'Build the beat and record in the same session' },
];

const BEAT_SOURCES = [
  { key: 'upload', label: 'Upload My Beat', desc: 'I have an audio file ready' },
  { key: 'link', label: 'Link to Beat', desc: 'YouTube, SoundCloud, or other URL' },
  { key: 'purchased', label: 'Purchased from Beat Store', desc: 'I bought a beat from Sweet Dreams' },
  { key: 'need_beat', label: 'Need Help Finding One', desc: 'I need the engineer to help me find a beat' },
  { key: 'producing', label: 'Building from Scratch', desc: 'We\'re producing the beat in-session' },
];

const LYRICS_STATUSES = [
  { key: 'written', label: 'Fully Written', desc: 'Lyrics are done, ready to record' },
  { key: 'partial', label: 'Partially Written', desc: 'Some parts done, will finish in session' },
  { key: 'freestyle', label: 'Freestyling', desc: 'Going in the booth with no written lyrics' },
  { key: 'none', label: 'N/A', desc: 'Not recording vocals (mixing/mastering only)' },
];

const DEFAULT_PREP: PrepData = {
  session_type: 'recording',
  session_goals: '',
  has_beat: false,
  beat_source: '',
  beat_file_url: '',
  beat_file_name: '',
  beat_link: '',
  beat_notes: '',
  reference_tracks: [],
  has_lyrics: false,
  lyrics_status: '',
  lyrics_text: '',
  vocal_style: '',
  special_requests: '',
  num_songs: 1,
  previous_session: false,
  completed: false,
};

export default function SessionPrepPage() {
  const params = useParams();
  const router = useRouter();
  const bookingId = params.bookingId as string;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [prep, setPrep] = useState<PrepData>(DEFAULT_PREP);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0); // 0 = type, 1 = beat, 2 = details, 3 = review
  const [showRefForm, setShowRefForm] = useState(false);
  const [newRef, setNewRef] = useState<ReferenceTrack>({ title: '', artist: '', link: '', notes: '' });

  // Load booking + existing prep
  useEffect(() => {
    async function load() {
      try {
        // Fetch booking details
        const bookingRes = await fetch(`/api/booking/prep?bookingId=${bookingId}`);
        const bookingData = await bookingRes.json();

        if (bookingData.error) {
          setError(bookingData.error);
          setLoading(false);
          return;
        }

        // We need booking info too — fetch from user's bookings
        const dashRes = await fetch(`/api/booking/details?id=${bookingId}`);
        const dashData = await dashRes.json();
        if (dashData.booking) {
          setBooking(dashData.booking);
        }

        if (bookingData.prep) {
          setPrep({
            ...DEFAULT_PREP,
            ...bookingData.prep,
            reference_tracks: bookingData.prep.reference_tracks || [],
          });
          // If prep is already completed, jump to review
          if (bookingData.prep.completed) setStep(3);
        }
      } catch {
        setError('Failed to load session details');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [bookingId]);

  async function save(completed = false) {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/booking/prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          ...prep,
          completed,
        }),
      });
      const data = await res.json();
      if (data.prep) {
        setPrep({ ...DEFAULT_PREP, ...data.prep, reference_tracks: data.prep.reference_tracks || [] });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleBeatUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('bookingId', bookingId);

      const res = await fetch('/api/booking/prep/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.error) {
        alert(data.error);
      } else {
        setPrep(p => ({
          ...p,
          has_beat: true,
          beat_source: 'upload',
          beat_file_url: data.fileUrl,
          beat_file_name: data.fileName,
        }));
      }
    } catch {
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function addReference() {
    if (!newRef.title && !newRef.link) return;
    setPrep(p => ({
      ...p,
      reference_tracks: [...p.reference_tracks, { ...newRef }],
    }));
    setNewRef({ title: '', artist: '', link: '', notes: '' });
    setShowRefForm(false);
  }

  function removeReference(idx: number) {
    setPrep(p => ({
      ...p,
      reference_tracks: p.reference_tracks.filter((_, i) => i !== idx),
    }));
  }

  // Which steps need the beat section?
  const needsBeat = ['recording', 'mixing', 'recording_production'].includes(prep.session_type);
  const needsLyrics = ['recording', 'recording_production'].includes(prep.session_type);
  const isProduction = ['production', 'recording_production'].includes(prep.session_type);

  // Step titles
  const steps = [
    'Session Type',
    needsBeat ? 'Your Beat' : 'Details',
    'Details & References',
    'Review & Submit',
  ];

  // Progress calc
  const completionItems = [
    !!prep.session_type,
    !!prep.session_goals,
    needsBeat ? !!prep.beat_source : true,
    needsLyrics ? !!prep.lyrics_status : true,
    prep.reference_tracks.length > 0,
  ];
  const completionPct = Math.round((completionItems.filter(Boolean).length / completionItems.length) * 100);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
          <h1 className="text-heading-sm mb-2">ERROR</h1>
          <p className="font-mono text-sm text-black/60 mb-4">{error}</p>
          <button onClick={() => router.push('/dashboard')} className="font-mono text-sm text-accent hover:underline">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="border-b-2 border-black/5">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <button onClick={() => router.push('/dashboard')} className="font-mono text-xs text-black/60 hover:text-black flex items-center gap-1 mb-4">
            <ArrowLeft className="w-3 h-3" /> Back to Dashboard
          </button>
          <h1 className="text-heading-md">PREPARE FOR YOUR SESSION</h1>
          {booking && (
            <p className="font-mono text-sm text-black/60 mt-2">
              {fmtSessionDate(booking.start_time, { weekday: 'long', month: 'long', day: 'numeric' })}
              {' · '}
              {fmtSessionTime(booking.start_time)}
              {' · '}
              {formatDuration(booking.duration)}
              {booking.engineer_name && ` · ${booking.engineer_name}`}
              {booking.room && ` · ${ROOM_LABELS[booking.room as Room]}`}
            </p>
          )}

          {/* Progress */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-xs text-black/60 uppercase tracking-wider">Preparation Progress</span>
              <span className="font-mono text-xs font-bold text-accent">{completionPct}%</span>
            </div>
            <div className="h-1.5 bg-black/5 rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${completionPct}%` }} />
            </div>
          </div>

          {/* Step nav */}
          <div className="flex gap-1 mt-4">
            {steps.map((s, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`flex-1 py-2 font-mono text-[10px] uppercase tracking-wider border-b-2 transition-colors ${
                  step === i ? 'border-accent text-accent font-bold' : 'border-transparent text-black/60 hover:text-black/80'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-8">

        {/* STEP 0: Session Type */}
        {step === 0 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-heading-sm mb-2">WHAT KIND OF SESSION?</h2>
              <p className="font-mono text-sm text-black/60">Select the type that best describes what you want to do.</p>
            </div>

            <div className="grid gap-3">
              {SESSION_TYPES.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.key}
                    onClick={() => setPrep(p => ({ ...p, session_type: type.key }))}
                    className={`w-full text-left p-4 border-2 transition-colors flex items-start gap-4 ${
                      prep.session_type === type.key
                        ? 'border-accent bg-accent/5'
                        : 'border-black/10 hover:border-black/30'
                    }`}
                  >
                    <Icon className={`w-6 h-6 mt-0.5 flex-shrink-0 ${prep.session_type === type.key ? 'text-accent' : 'text-black/60'}`} />
                    <div>
                      <p className="font-mono text-sm font-bold">{type.label}</p>
                      <p className="font-mono text-xs text-black/70 mt-0.5">{type.desc}</p>
                    </div>
                    {prep.session_type === type.key && (
                      <Check className="w-5 h-5 text-accent ml-auto flex-shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>

            <div>
              <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">
                What do you want to accomplish? *
              </label>
              <textarea
                value={prep.session_goals}
                onChange={(e) => setPrep(p => ({ ...p, session_goals: e.target.value }))}
                rows={3}
                className="w-full border-2 border-black/20 px-4 py-3 font-mono text-sm focus:border-accent focus:outline-none resize-vertical"
                placeholder={
                  isProduction
                    ? "e.g., I want to create a dark trap beat and record a hook and verse over it"
                    : prep.session_type === 'mixing'
                    ? "e.g., I have 3 songs that need mixing — I want them to sound radio-ready"
                    : "e.g., I want to record 2 songs, I have the beats ready and lyrics written"
                }
              />
            </div>

            <div>
              <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">
                How many songs do you plan to work on?
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setPrep(p => ({ ...p, num_songs: n }))}
                    className={`w-12 h-12 font-mono text-sm font-bold border-2 transition-colors ${
                      prep.num_songs === n ? 'bg-black text-white border-black' : 'border-black/20 hover:border-black'
                    }`}
                  >
                    {n}{n === 5 ? '+' : ''}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setPrep(p => ({ ...p, previous_session: !p.previous_session }))}
                className={`w-5 h-5 border-2 flex items-center justify-center transition-colors ${
                  prep.previous_session ? 'bg-accent border-accent' : 'border-black/30'
                }`}
              >
                {prep.previous_session && <Check className="w-3 h-3 text-black" />}
              </button>
              <span className="font-mono text-sm">I&apos;ve recorded at Sweet Dreams before</span>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => { save(); setStep(1); }}
                className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-8 py-3 hover:bg-accent/90 transition-colors"
              >
                Next: {needsBeat ? 'Your Beat' : 'Details'} →
              </button>
            </div>
          </div>
        )}

        {/* STEP 1: Beat / Instrumental */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-heading-sm mb-2">
                {needsBeat ? 'YOUR BEAT / INSTRUMENTAL' : 'SESSION DETAILS'}
              </h2>
              <p className="font-mono text-sm text-black/60">
                {needsBeat
                  ? 'How are you handling the beat? This helps your engineer prepare.'
                  : 'Tell us more about what you need.'}
              </p>
            </div>

            {needsBeat && (
              <>
                <div className="grid gap-3">
                  {BEAT_SOURCES.map((src) => (
                    <button
                      key={src.key}
                      onClick={() => setPrep(p => ({ ...p, beat_source: src.key, has_beat: ['upload', 'link', 'purchased'].includes(src.key) }))}
                      className={`w-full text-left p-4 border-2 transition-colors ${
                        prep.beat_source === src.key
                          ? 'border-accent bg-accent/5'
                          : 'border-black/10 hover:border-black/30'
                      }`}
                    >
                      <p className="font-mono text-sm font-bold">{src.label}</p>
                      <p className="font-mono text-xs text-black/70 mt-0.5">{src.desc}</p>
                    </button>
                  ))}
                </div>

                {/* Upload beat file */}
                {prep.beat_source === 'upload' && (
                  <div className="border-2 border-dashed border-black/20 p-6">
                    {prep.beat_file_name ? (
                      <div className="flex items-center gap-3">
                        <FileAudio className="w-5 h-5 text-accent" />
                        <span className="font-mono text-sm font-semibold flex-1 truncate">{prep.beat_file_name}</span>
                        <button onClick={() => setPrep(p => ({ ...p, beat_file_url: '', beat_file_name: '' }))} className="text-red-500 p-1">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <label className="cursor-pointer flex flex-col items-center gap-3">
                        {uploading ? (
                          <Loader2 className="w-8 h-8 animate-spin text-accent" />
                        ) : (
                          <Upload className="w-8 h-8 text-black/30" />
                        )}
                        <span className="font-mono text-xs text-black/70">
                          {uploading ? 'Uploading...' : 'Click to upload your beat (MP3, WAV, FLAC — max 50MB)'}
                        </span>
                        <input type="file" accept="audio/*" onChange={handleBeatUpload} className="hidden" disabled={uploading} />
                      </label>
                    )}
                  </div>
                )}

                {/* Beat link */}
                {prep.beat_source === 'link' && (
                  <div>
                    <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">Beat Link</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30" />
                        <input
                          type="url"
                          value={prep.beat_link}
                          onChange={(e) => setPrep(p => ({ ...p, beat_link: e.target.value, has_beat: !!e.target.value }))}
                          className="w-full border-2 border-black/20 pl-9 pr-4 py-3 font-mono text-sm focus:border-accent focus:outline-none"
                          placeholder="https://youtube.com/watch?v=... or SoundCloud link"
                        />
                      </div>
                      {prep.beat_link && (
                        <a href={prep.beat_link} target="_blank" rel="noopener noreferrer" className="border-2 border-black/20 p-3 hover:border-accent transition-colors">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Beat notes */}
                {(prep.beat_source === 'need_beat' || prep.beat_source === 'producing') && (
                  <div>
                    <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">
                      {prep.beat_source === 'need_beat' ? 'Describe what you\'re looking for' : 'Describe the vibe you want to create'}
                    </label>
                    <textarea
                      value={prep.beat_notes}
                      onChange={(e) => setPrep(p => ({ ...p, beat_notes: e.target.value }))}
                      rows={3}
                      className="w-full border-2 border-black/20 px-4 py-3 font-mono text-sm focus:border-accent focus:outline-none resize-vertical"
                      placeholder={
                        prep.beat_source === 'need_beat'
                          ? "e.g., I want something dark and melodic, like a Drake/Metro Boomin vibe, around 140 BPM"
                          : "e.g., I want a chill lo-fi beat with piano and soft drums, something I can sing over"
                      }
                    />
                  </div>
                )}
              </>
            )}

            {/* Lyrics section (for recording sessions) */}
            {needsLyrics && (
              <div className="border-t border-black/10 pt-6">
                <h3 className="font-mono text-sm font-bold uppercase tracking-wider mb-3">Lyrics & Content</h3>
                <div className="grid gap-2">
                  {LYRICS_STATUSES.map((ls) => (
                    <button
                      key={ls.key}
                      onClick={() => setPrep(p => ({ ...p, lyrics_status: ls.key, has_lyrics: ls.key !== 'none' }))}
                      className={`w-full text-left p-3 border-2 transition-colors ${
                        prep.lyrics_status === ls.key
                          ? 'border-accent bg-accent/5'
                          : 'border-black/10 hover:border-black/30'
                      }`}
                    >
                      <p className="font-mono text-sm font-bold">{ls.label}</p>
                      <p className="font-mono text-[11px] text-black/70">{ls.desc}</p>
                    </button>
                  ))}
                </div>

                {(prep.lyrics_status === 'written' || prep.lyrics_status === 'partial') && (
                  <div className="mt-4">
                    <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">
                      Paste your lyrics <span className="font-normal text-black/60">(optional — you can also bring them to the session)</span>
                    </label>
                    <textarea
                      value={prep.lyrics_text}
                      onChange={(e) => setPrep(p => ({ ...p, lyrics_text: e.target.value }))}
                      rows={8}
                      className="w-full border-2 border-black/20 px-4 py-3 font-mono text-sm focus:border-accent focus:outline-none resize-vertical"
                      placeholder="Paste your lyrics here..."
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between">
              <button onClick={() => setStep(0)} className="font-mono text-sm text-black/60 hover:text-black">
                ← Back
              </button>
              <button
                onClick={() => { save(); setStep(2); }}
                className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-8 py-3 hover:bg-accent/90 transition-colors"
              >
                Next: Details →
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Details & References */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-heading-sm mb-2">DETAILS & REFERENCES</h2>
              <p className="font-mono text-sm text-black/60">
                Help your engineer understand your sound. Reference tracks are huge — they help us nail the vibe faster.
              </p>
            </div>

            {/* Vocal style / genre */}
            <div>
              <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">
                Genre / Style / Vibe
              </label>
              <input
                type="text"
                value={prep.vocal_style}
                onChange={(e) => setPrep(p => ({ ...p, vocal_style: e.target.value }))}
                className="w-full border-2 border-black/20 px-4 py-3 font-mono text-sm focus:border-accent focus:outline-none"
                placeholder="e.g., Melodic rap, R&B, Pop punk, Dark trap, Lo-fi, Country, etc."
              />
            </div>

            {/* Reference tracks */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="font-mono text-xs font-semibold uppercase tracking-wider">
                  Reference Tracks
                  <span className="font-normal text-black/60 ml-1">(songs that sound like what you want)</span>
                </label>
                <button
                  onClick={() => setShowRefForm(true)}
                  className="font-mono text-xs text-accent font-bold flex items-center gap-1 hover:underline"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>

              {prep.reference_tracks.length > 0 && (
                <div className="space-y-2 mb-3">
                  {prep.reference_tracks.map((ref, idx) => (
                    <div key={idx} className="border-2 border-black/10 p-3 flex items-start gap-3">
                      <Music className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm font-semibold truncate">
                          {ref.title}{ref.artist ? ` — ${ref.artist}` : ''}
                        </p>
                        {ref.notes && <p className="font-mono text-[11px] text-black/70 mt-0.5">{ref.notes}</p>}
                        {ref.link && (
                          <a href={ref.link} target="_blank" rel="noopener noreferrer" className="font-mono text-[10px] text-accent hover:underline flex items-center gap-1 mt-1">
                            <ExternalLink className="w-3 h-3" /> {ref.link.substring(0, 40)}...
                          </a>
                        )}
                      </div>
                      <button onClick={() => removeReference(idx)} className="text-black/20 hover:text-red-500 p-1 flex-shrink-0">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {prep.reference_tracks.length === 0 && !showRefForm && (
                <div className="border-2 border-dashed border-black/10 p-6 text-center">
                  <Music className="w-6 h-6 text-black/20 mx-auto mb-2" />
                  <p className="font-mono text-xs text-black/60">
                    Adding reference tracks helps your engineer understand your sound instantly.
                  </p>
                  <button
                    onClick={() => setShowRefForm(true)}
                    className="font-mono text-xs text-accent font-bold mt-2 hover:underline"
                  >
                    + Add a reference track
                  </button>
                </div>
              )}

              {showRefForm && (
                <div className="border-2 border-accent/30 bg-accent/5 p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={newRef.title}
                      onChange={(e) => setNewRef(r => ({ ...r, title: e.target.value }))}
                      className="border-2 border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                      placeholder="Song title"
                    />
                    <input
                      type="text"
                      value={newRef.artist}
                      onChange={(e) => setNewRef(r => ({ ...r, artist: e.target.value }))}
                      className="border-2 border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                      placeholder="Artist"
                    />
                  </div>
                  <input
                    type="url"
                    value={newRef.link}
                    onChange={(e) => setNewRef(r => ({ ...r, link: e.target.value }))}
                    className="w-full border-2 border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                    placeholder="Link (YouTube, Spotify, etc.)"
                  />
                  <input
                    type="text"
                    value={newRef.notes}
                    onChange={(e) => setNewRef(r => ({ ...r, notes: e.target.value }))}
                    className="w-full border-2 border-black/20 px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
                    placeholder="What about this song? (e.g., 'I want my vocals to sound like this')"
                  />
                  <div className="flex gap-2">
                    <button onClick={addReference} className="bg-accent text-black font-mono text-xs font-bold px-4 py-2">
                      Add
                    </button>
                    <button onClick={() => { setShowRefForm(false); setNewRef({ title: '', artist: '', link: '', notes: '' }); }} className="font-mono text-xs text-black/60 px-4 py-2">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Special requests */}
            <div>
              <label className="block font-mono text-xs font-semibold uppercase tracking-wider mb-2">
                Special Requests or Notes
              </label>
              <textarea
                value={prep.special_requests}
                onChange={(e) => setPrep(p => ({ ...p, special_requests: e.target.value }))}
                rows={3}
                className="w-full border-2 border-black/20 px-4 py-3 font-mono text-sm focus:border-accent focus:outline-none resize-vertical"
                placeholder="e.g., I want heavy autotune, need a pop filter, bringing a friend to feature on a verse, want to record a video of the session, etc."
              />
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="font-mono text-sm text-black/60 hover:text-black">
                ← Back
              </button>
              <button
                onClick={() => { save(); setStep(3); }}
                className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-8 py-3 hover:bg-accent/90 transition-colors"
              >
                Review →
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Review & Submit */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-heading-sm mb-2">REVIEW YOUR PREP</h2>
              <p className="font-mono text-sm text-black/60">
                {prep.completed
                  ? 'Your prep has been submitted! Your engineer will review this before your session.'
                  : 'Look everything over and submit when you\'re ready. Your engineer will see this info.'}
              </p>
            </div>

            {/* Summary cards */}
            <div className="space-y-3">
              {/* Session type */}
              <div className="border-2 border-black/10 p-4">
                <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Session Type</p>
                <p className="font-mono text-sm font-bold">
                  {SESSION_TYPES.find(t => t.key === prep.session_type)?.label || prep.session_type}
                </p>
                {prep.num_songs > 1 && (
                  <p className="font-mono text-xs text-black/70 mt-1">{prep.num_songs}+ songs planned</p>
                )}
              </div>

              {/* Goals */}
              {prep.session_goals && (
                <div className="border-2 border-black/10 p-4">
                  <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Session Goals</p>
                  <p className="font-mono text-sm">{prep.session_goals}</p>
                </div>
              )}

              {/* Beat info */}
              {needsBeat && prep.beat_source && (
                <div className="border-2 border-black/10 p-4">
                  <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Beat / Instrumental</p>
                  <p className="font-mono text-sm font-bold">
                    {BEAT_SOURCES.find(s => s.key === prep.beat_source)?.label || prep.beat_source}
                  </p>
                  {prep.beat_file_name && (
                    <p className="font-mono text-xs text-accent mt-1 flex items-center gap-1">
                      <FileAudio className="w-3 h-3" /> {prep.beat_file_name}
                    </p>
                  )}
                  {prep.beat_link && (
                    <a href={prep.beat_link} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-accent hover:underline flex items-center gap-1 mt-1">
                      <ExternalLink className="w-3 h-3" /> {prep.beat_link.substring(0, 50)}{prep.beat_link.length > 50 ? '...' : ''}
                    </a>
                  )}
                  {prep.beat_notes && <p className="font-mono text-xs text-black/60 mt-1">{prep.beat_notes}</p>}
                </div>
              )}

              {/* Lyrics */}
              {needsLyrics && prep.lyrics_status && (
                <div className="border-2 border-black/10 p-4">
                  <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Lyrics</p>
                  <p className="font-mono text-sm font-bold">
                    {LYRICS_STATUSES.find(l => l.key === prep.lyrics_status)?.label || prep.lyrics_status}
                  </p>
                  {prep.lyrics_text && (
                    <pre className="font-mono text-xs text-black/60 mt-2 whitespace-pre-wrap max-h-40 overflow-y-auto">{prep.lyrics_text}</pre>
                  )}
                </div>
              )}

              {/* Style */}
              {prep.vocal_style && (
                <div className="border-2 border-black/10 p-4">
                  <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Genre / Style</p>
                  <p className="font-mono text-sm">{prep.vocal_style}</p>
                </div>
              )}

              {/* References */}
              {prep.reference_tracks.length > 0 && (
                <div className="border-2 border-black/10 p-4">
                  <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider mb-2">Reference Tracks</p>
                  <div className="space-y-2">
                    {prep.reference_tracks.map((ref, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Music className="w-3 h-3 text-accent flex-shrink-0" />
                        <span className="font-mono text-sm">
                          {ref.title}{ref.artist ? ` — ${ref.artist}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Special requests */}
              {prep.special_requests && (
                <div className="border-2 border-black/10 p-4">
                  <p className="font-mono text-[10px] text-black/60 uppercase tracking-wider mb-1">Special Requests</p>
                  <p className="font-mono text-sm">{prep.special_requests}</p>
                </div>
              )}
            </div>

            {/* Submit / Edit */}
            <div className="flex justify-between items-center">
              <button onClick={() => setStep(2)} className="font-mono text-sm text-black/60 hover:text-black">
                ← Edit
              </button>

              {prep.completed ? (
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-green-600 font-bold flex items-center gap-1">
                    <Check className="w-4 h-4" /> Submitted
                  </span>
                  <button
                    onClick={() => { setPrep(p => ({ ...p, completed: false })); save(false); }}
                    className="font-mono text-xs text-black/60 hover:text-black"
                  >
                    Edit & Resubmit
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setPrep(p => ({ ...p, completed: true })); save(true); }}
                  disabled={saving}
                  className="bg-accent text-black font-mono text-sm font-bold uppercase tracking-wider px-8 py-3 hover:bg-accent/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {saving ? 'Submitting...' : 'Submit Prep'}
                </button>
              )}
            </div>

            {saved && (
              <div className="bg-green-50 border border-green-200 p-3 text-center">
                <p className="font-mono text-xs text-green-700 font-bold">Saved successfully!</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
