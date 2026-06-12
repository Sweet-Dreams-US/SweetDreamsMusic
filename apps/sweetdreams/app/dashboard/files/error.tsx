'use client';

import { useEffect } from 'react';

// Route-level error boundary for /dashboard/files. Anything that throws while
// rendering this page now degrades to a friendly retry card instead of the raw
// "server-side exception" screen customers were seeing.
export default function FilesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[files] route error boundary caught:', error);
  }, [error]);

  return (
    <section className="bg-white text-black py-16">
      <div className="max-w-md mx-auto px-6 text-center">
        <p className="font-mono text-sm font-bold mb-2">Couldn&apos;t load your files</p>
        <p className="font-mono text-xs text-black/60 mb-5">
          Something went wrong on our end. Your files are safe — please try again.
        </p>
        <button
          onClick={reset}
          className="bg-accent text-black font-mono text-xs font-bold uppercase tracking-wider px-5 py-2.5 hover:bg-accent/90 transition-colors"
        >
          Retry
        </button>
        {error.digest && (
          <p className="font-mono text-[10px] text-black/30 mt-4">Ref: {error.digest}</p>
        )}
      </div>
    </section>
  );
}
