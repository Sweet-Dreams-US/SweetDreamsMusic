'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Save, Loader2 } from 'lucide-react';
import { useAudioPlayer, type AudioTrack } from '@/components/audio/AudioPlayerContext';
import {
  countLineSyllables,
  findRhymeGroups,
  RHYME_COLORS,
  SECTION_TYPES,
  type LyricSection,
  type SectionType,
} from '@/lib/lyrics-utils';

interface WritingPadProps {
  beat: {
    id: string;
    title: string;
    producer: string;
    producerSlug?: string;
    previewUrl: string | null;
    bpm: number | null;
  };
  isLoggedIn: boolean;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function createSection(type: SectionType, index: number): LyricSection {
  const typeLabel = SECTION_TYPES.find((t) => t.value === type)?.label || type;
  const count = index + 1;
  return {
    id: generateId(),
    type,
    label: type === 'chorus' || type === 'hook' || type === 'bridge'
      ? typeLabel
      : `${typeLabel} ${count}`,
    lines: ['', '', '', ''],
  };
}

export default function WritingPad({ beat, isLoggedIn }: WritingPadProps) {
  const { play, currentTrack, isPlaying, isLooping, toggleLoop } = useAudioPlayer();
  const [sections, setSections] = useState<LyricSection[]>([
    createSection('verse', 0),
  ]);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [addSectionType, setAddSectionType] = useState<SectionType>('verse');
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load lyrics from API or localStorage
  useEffect(() => {
    const localKey = `lyrics_${beat.id}`;

    if (isLoggedIn) {
      fetch(`/api/lyrics?beatId=${beat.id}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.lyrics?.sections && d.lyrics.sections.length > 0) {
            setSections(d.lyrics.sections);
            setLastSaved(d.lyrics.updated_at);
          } else {
            // Try localStorage fallback
            const local = localStorage.getItem(localKey);
            if (local) {
              try { setSections(JSON.parse(local)); } catch {}
            }
          }
        })
        .catch(() => {
          const local = localStorage.getItem(localKey);
          if (local) {
            try { setSections(JSON.parse(local)); } catch {}
          }
        });
    } else {
      const local = localStorage.getItem(localKey);
      if (local) {
        try { setSections(JSON.parse(local)); } catch {}
      }
    }
  }, [beat.id, isLoggedIn]);

  // Auto-save (debounced 2s)
  const autoSave = useCallback((newSections: LyricSection[]) => {
    // Always save to localStorage
    localStorage.setItem(`lyrics_${beat.id}`, JSON.stringify(newSections));

    // Save to API if logged in (debounced)
    if (isLoggedIn) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        setSaving(true);
        try {
          await fetch('/api/lyrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ beatId: beat.id, sections: newSections }),
          });
          setLastSaved(new Date().toISOString());
        } catch {}
        setSaving(false);
      }, 2000);
    }
  }, [beat.id, isLoggedIn]);

  // Auto-play the beat when entering the writing pad
  useEffect(() => {
    if (beat.previewUrl && currentTrack?.id !== beat.id) {
      const track: AudioTrack = {
        id: beat.id,
        title: beat.title,
        producer: beat.producer,
        producerSlug: beat.producerSlug,
        previewUrl: beat.previewUrl,
        bpm: beat.bpm || undefined,
      };
      play(track);
      // Enable loop for writing
      if (!isLooping) toggleLoop();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function updateSections(newSections: LyricSection[]) {
    setSections(newSections);
    autoSave(newSections);
  }

  function addSection() {
    const count = sections.filter((s) => s.type === addSectionType).length;
    updateSections([...sections, createSection(addSectionType, count)]);
  }

  function removeSection(id: string) {
    if (sections.length <= 1) return;
    updateSections(sections.filter((s) => s.id !== id));
  }

  function moveSection(id: string, direction: -1 | 1) {
    const idx = sections.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= sections.length) return;
    const newSections = [...sections];
    [newSections[idx], newSections[newIdx]] = [newSections[newIdx], newSections[idx]];
    updateSections(newSections);
  }

  function updateLine(sectionId: string, lineIdx: number, value: string) {
    updateSections(
      sections.map((s) =>
        s.id === sectionId
          ? { ...s, lines: s.lines.map((l, i) => (i === lineIdx ? value : l)) }
          : s
      )
    );
  }

  function addLine(sectionId: string) {
    updateSections(
      sections.map((s) =>
        s.id === sectionId ? { ...s, lines: [...s.lines, ''] } : s
      )
    );
  }

  function removeLine(sectionId: string, lineIdx: number) {
    updateSections(
      sections.map((s) =>
        s.id === sectionId && s.lines.length > 1
          ? { ...s, lines: s.lines.filter((_, i) => i !== lineIdx) }
          : s
      )
    );
  }

  // Calculate bar info from BPM
  const bpm = beat.bpm || 140;
  const beatsPerBar = 4;
  const secondsPerBar = (60 / bpm) * beatsPerBar;

  return (
    <div className="space-y-6">
      {/* Header info */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] text-black/30 uppercase tracking-wider">
            {bpm} BPM · {secondsPerBar.toFixed(1)}s per bar · {beatsPerBar} beats per bar
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saving && (
            <span className="font-mono text-[10px] text-black/30 inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving...
            </span>
          )}
          {!saving && lastSaved && (
            <span className="font-mono text-[10px] text-green-600 inline-flex items-center gap-1">
              <Save className="w-3 h-3" /> Saved
            </span>
          )}
          {!isLoggedIn && (
            <span className="font-mono text-[10px] text-amber-600">
              Sign in to save across devices
            </span>
          )}
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-6">
        {sections.map((section, sectionIdx) => {
          // Calculate rhyme groups for this section
          const rhymeGroups = findRhymeGroups(section.lines);

          return (
            <div key={section.id} className="border-2 border-black/10">
              {/* Section header */}
              <div className="flex items-center justify-between px-4 py-3 bg-black/[0.03] border-b border-black/10">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider">
                    {section.label}
                  </span>
                  <span className="font-mono text-[10px] text-black/30">
                    {section.lines.filter((l) => l.trim()).length} lines
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => moveSection(section.id, -1)}
                    disabled={sectionIdx === 0}
                    className="p-1 text-black/30 hover:text-black disabled:opacity-20"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => moveSection(section.id, 1)}
                    disabled={sectionIdx === sections.length - 1}
                    className="p-1 text-black/30 hover:text-black disabled:opacity-20"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => removeSection(section.id)}
                    disabled={sections.length <= 1}
                    className="p-1 text-red-300 hover:text-red-500 disabled:opacity-20 ml-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Lines */}
              <div className="p-4 space-y-1">
                {section.lines.map((line, lineIdx) => {
                  const syllables = countLineSyllables(line);
                  const rhymeGroup = rhymeGroups.get(lineIdx);
                  const rhymeColor = rhymeGroup !== undefined
                    ? RHYME_COLORS[rhymeGroup % RHYME_COLORS.length]
                    : undefined;

                  return (
                    <div key={lineIdx} className="flex items-center gap-2 group">
                      {/* Line number */}
                      <span className="font-mono text-[10px] text-black/20 w-5 text-right flex-shrink-0">
                        {lineIdx + 1}
                      </span>

                      {/* Rhyme indicator */}
                      <div
                        className="w-1 h-8 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: rhymeColor || 'transparent' }}
                      />

                      {/* Line input */}
                      <input
                        type="text"
                        value={line}
                        onChange={(e) => updateLine(section.id, lineIdx, e.target.value)}
                        className="flex-1 border-0 border-b border-transparent hover:border-black/10 focus:border-accent px-2 py-1.5 font-mono text-sm focus:outline-none bg-transparent transition-colors"
                        placeholder={lineIdx === 0 ? 'Start writing...' : ''}
                      />

                      {/* Syllable count */}
                      <span className={`font-mono text-[10px] w-6 text-center flex-shrink-0 ${
                        syllables > 0 ? 'text-black/40' : 'text-black/10'
                      }`}>
                        {syllables > 0 ? syllables : '-'}
                      </span>

                      {/* Remove line button */}
                      <button
                        onClick={() => removeLine(section.id, lineIdx)}
                        className="p-1 text-black/10 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}

                {/* Add line button */}
                <button
                  onClick={() => addLine(section.id)}
                  className="font-mono text-[10px] text-black/30 hover:text-accent uppercase tracking-wider inline-flex items-center gap-1 mt-2 ml-8"
                >
                  <Plus className="w-3 h-3" /> Add line
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add section */}
      <div className="flex items-center gap-2">
        <select
          value={addSectionType}
          onChange={(e) => setAddSectionType(e.target.value as SectionType)}
          className="border-2 border-black/20 px-3 py-2 font-mono text-xs uppercase bg-transparent focus:border-accent focus:outline-none"
        >
          {SECTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <button
          onClick={addSection}
          className="bg-black text-white font-mono text-xs font-bold uppercase tracking-wider px-4 py-2 hover:bg-black/80 inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add Section
        </button>
      </div>

      {/* Legend */}
      <div className="border-t border-black/10 pt-4">
        <p className="font-mono text-[10px] text-black/30 uppercase tracking-wider mb-2">Guide</p>
        <div className="flex flex-wrap gap-4">
          <span className="font-mono text-[10px] text-black/40">
            Numbers on right = syllable count
          </span>
          <span className="font-mono text-[10px] text-black/40 inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#F4C430]" /> Colored bars = rhyming lines
          </span>
        </div>
      </div>
    </div>
  );
}
