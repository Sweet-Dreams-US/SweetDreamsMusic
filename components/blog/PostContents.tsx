'use client';

// Contents for a blog post, built from the post's ## headings.
//
// Wide screens (xl and up): a small fixed panel in the bottom right corner with
// a reading progress bar and the current section marked.
// Everything narrower: a bar fixed to the bottom showing the current section and
// an arrow. The arrow opens the full list, tapping a section jumps to it and
// closes the list. If the audio player bar is showing it keeps the very bottom
// and this bar stacks above it, so neither ever covers the other.
//
// Both hide once the reader reaches the end of the article, so they never sit
// on top of the sources, the call to action or the footer.

import { useEffect, useState } from 'react';
import { ChevronUp } from 'lucide-react';

export interface ContentsSection {
  id: string;
  text: string;
}

const AUDIO_BAR = '[role="region"][aria-label="Audio player"]';
const CHAT_BUTTON = '[aria-label="Open Sweet Dreams chat"]';

export default function PostContents({ sections, bodyId }: { sections: ContentsSection[]; bodyId: string }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(false);
  const [audioHeight, setAudioHeight] = useState(0);
  const [chatShowing, setChatShowing] = useState(false);

  // Reading progress and the current section.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const body = document.getElementById(bodyId);
      if (!body) return;
      const rect = body.getBoundingClientRect();
      const viewport = window.innerHeight;
      const fold = 96; // clears the fixed site header
      const total = Math.max(1, rect.height - (viewport - fold));
      setProgress(Math.min(1, Math.max(0, (fold - rect.top) / total)));
      setDone(rect.bottom <= viewport - 8);

      let current: string | null = null;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= 140) current = s.id;
        else break;
      }
      setActiveId(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections, bodyId]);

  // Make room for the audio player bar and the chat button when they are on screen.
  useEffect(() => {
    const read = () => {
      const audio = document.querySelector<HTMLElement>(AUDIO_BAR);
      setAudioHeight(audio ? audio.offsetHeight : 0);
      setChatShowing(Boolean(document.querySelector(CHAT_BUTTON)));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', read);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', read);
    };
  }, []);

  // Escape closes the open list.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (sections.length === 0) return null;

  const percent = Math.round(progress * 100);
  const current = sections.find((s) => s.id === activeId);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', `#${id}`);
    }
    setOpen(false);
  };

  return (
    <>
      {/* Wide screens: small fixed panel, bottom right corner */}
      <div
        aria-hidden={done}
        className={`hidden xl:block fixed right-5 z-30 w-[232px] bg-black text-white border-l-4 border-[#F4C430] shadow-xl transition-opacity duration-200 ${
          done ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        style={{ bottom: audioHeight + (chatShowing ? 96 : 24) }}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="font-mono text-[10px] font-semibold tracking-[0.3em] uppercase text-white/60">Contents</span>
          <span className="font-mono text-[11px] font-bold text-[#F4C430] tabular-nums">{percent}%</span>
        </div>
        <div
          className="mx-4 h-1 bg-white/15"
          role="progressbar"
          aria-label="Reading progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="h-full bg-[#F4C430]" style={{ width: `${percent}%` }} />
        </div>
        <nav aria-label="Contents" className="max-h-[46vh] overflow-y-auto px-2 py-2">
          <ol className="space-y-0.5">
            {sections.map((s) => {
              const active = s.id === activeId;
              return (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    aria-current={active ? 'location' : undefined}
                    className={`block border-l-2 px-3 py-1.5 font-mono text-xs leading-snug no-underline transition-colors ${
                      active
                        ? 'border-[#F4C430] text-[#F4C430] font-semibold'
                        : 'border-transparent text-white/65 hover:text-white'
                    }`}
                  >
                    {s.text}
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      {/* Narrower screens: bar fixed to the bottom, stacked above any audio bar */}
      <div
        aria-hidden={done}
        className={`xl:hidden transition-opacity duration-200 ${done ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      >
        {open && (
          <button
            type="button"
            aria-label="Close contents"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default bg-black/40"
            style={{ padding: 0, minHeight: 0, minWidth: 0 }}
          />
        )}
        <div
          className="fixed inset-x-0 z-30 bg-black text-white border-t border-white/10"
          style={{ bottom: audioHeight, paddingBottom: audioHeight ? 0 : 'env(safe-area-inset-bottom)' }}
        >
          {open && (
            <nav
              id="post-contents-list"
              aria-label="Contents"
              className="max-h-[55vh] overflow-y-auto border-b border-white/10 py-1"
            >
              {sections.map((s) => {
                const active = s.id === activeId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => jump(s.id)}
                    aria-current={active ? 'location' : undefined}
                    className={`block w-full border-l-4 text-left font-mono text-[13px] leading-snug ${
                      active ? 'border-[#F4C430] text-[#F4C430] font-semibold' : 'border-transparent text-white/75'
                    }`}
                    style={{
                      padding: '10px 16px',
                      minHeight: 44,
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      fontSize: 13,
                      display: 'block',
                    }}
                  >
                    {s.text}
                  </button>
                );
              })}
            </nav>
          )}
          <div className="h-[3px] bg-white/15">
            <div className="h-full bg-[#F4C430]" style={{ width: `${percent}%` }} />
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="post-contents-list"
            className="flex w-full items-center gap-3 text-left font-mono text-xs"
            style={{
              padding: `0 ${chatShowing ? 88 : 16}px 0 16px`,
              minHeight: 52,
              fontSize: 12,
              justifyContent: 'space-between',
            }}
          >
            <span className="min-w-0 truncate font-semibold text-[#F4C430]">{current ? current.text : 'Contents'}</span>
            <ChevronUp
              className={`h-5 w-5 shrink-0 text-white transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>
        </div>
      </div>
    </>
  );
}
