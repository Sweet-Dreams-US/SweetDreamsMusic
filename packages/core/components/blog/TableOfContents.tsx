'use client';

import { useEffect, useState } from 'react';
import { extractHeadings } from './BlogContent';

interface TableOfContentsProps {
  content: string;
}

export default function TableOfContents({ content }: TableOfContentsProps) {
  const headings = extractHeadings(content);
  const [activeId, setActiveId] = useState<string>('');

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

  return (
    <nav aria-label="Table of contents">
      <p className="font-mono text-[10px] font-semibold tracking-[0.3em] uppercase text-black/40 mb-4">
        On This Page
      </p>
      <ul className="space-y-2 border-l border-black/10">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={`
                block font-mono text-xs leading-snug no-underline transition-colors
                ${h.level === 3 ? 'pl-6' : 'pl-4'}
                ${activeId === h.id
                  ? 'text-[#F4C430] font-semibold border-l-2 border-[#F4C430] -ml-[1px]'
                  : 'text-black/50 hover:text-black/80'
                }
              `}
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById(h.id);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
