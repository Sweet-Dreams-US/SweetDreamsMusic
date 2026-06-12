'use client';

import { useEffect, useState } from 'react';
import { ChevronUp, List } from 'lucide-react';
import { extractHeadings } from './BlogContent';

interface MobileTOCProps {
  content: string;
}

export default function MobileTOC({ content }: MobileTOCProps) {
  const headings = extractHeadings(content);
  const [activeId, setActiveId] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 }
    );

    for (const heading of headings) {
      const el = document.getElementById(heading.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length < 2) return null;

  const activeHeading = headings.find(h => h.id === activeId);

  return (
    <>
      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-black text-white border-t border-white/10 safe-area-bottom">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-4 py-3 flex items-center justify-between"
        >
          <div className="flex items-center gap-2 min-w-0">
            <List className="w-4 h-4 text-[#F4C430] shrink-0" />
            <span className="font-mono text-xs text-white/50 shrink-0">On this page:</span>
            <span className="font-mono text-xs text-[#F4C430] font-semibold truncate">
              {activeHeading?.text || headings[0]?.text || ''}
            </span>
          </div>
          <ChevronUp className={`w-4 h-4 text-white/50 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Expanded TOC */}
        {isOpen && (
          <div className="max-h-[50vh] overflow-y-auto px-4 pb-4 border-t border-white/10">
            <ul className="space-y-1 py-2">
              {headings.map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => {
                      const el = document.getElementById(h.id);
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      setIsOpen(false);
                    }}
                    className={`w-full text-left font-mono text-xs py-1.5 transition-colors ${
                      h.level === 3 ? 'pl-6' : 'pl-2'
                    } ${
                      activeId === h.id
                        ? 'text-[#F4C430] font-semibold'
                        : 'text-white/60'
                    }`}
                  >
                    {h.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Spacer so content isn't hidden behind the fixed bar */}
      <div className="h-14" />
    </>
  );
}
