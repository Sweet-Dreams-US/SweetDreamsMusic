'use client';

import { useEffect, useRef } from 'react';

const words = ['RECORD.', 'CREATE.', 'RELEASE.'];

export default function HeroTitle() {
  const containerRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const spans = containerRef.current?.querySelectorAll<HTMLSpanElement>('.hero-word');
    if (!spans) return;

    spans.forEach((span, i) => {
      span.style.opacity = '0';
      span.style.transform = 'translateY(40px) scale(0.85)';
      span.style.transition = 'opacity 0.6s ease-out, transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)';

      setTimeout(() => {
        span.style.opacity = '1';
        span.style.transform = 'translateY(0) scale(1)';
      }, 200 + i * 200);
    });
  }, []);

  return (
    <h1 ref={containerRef} className="text-display-lg mb-6 flex flex-col sm:flex-row items-center justify-center gap-x-[0.3em]">
      {words.map((word) => (
        <span key={word} className="hero-word inline-block opacity-0">
          {word}
        </span>
      ))}
    </h1>
  );
}
