'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';

/**
 * Buy button for a media offering. Mirrors the pattern in
 * `components/beats/BuyButton.tsx`:
 *   - POSTs slug to /api/media/checkout
 *   - On 401, bounces to /login (this shouldn't happen since the page is
 *     gated, but defensive)
 *   - On success, redirects to Stripe Checkout
 *
 * Local loading state prevents double-submit (which would create two
 * checkout sessions even though the webhook would dedup the eventual
 * payment).
 */
export default function MediaBuyButton({ slug, title }: { slug: string; title: string }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isLoading}
        className="bg-accent text-black font-mono text-base font-bold tracking-wider uppercase px-8 py-4 hover:bg-accent/90 transition-colors inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={async () => {
          setError(null);
          setIsLoading(true);
          try {
            const res = await fetch('/api/media/checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ slug }),
            });

            if (res.status === 401) {
              window.location.href = `/login?redirect=/dashboard/media/${slug}`;
              return;
            }

            const data = await res.json();
            if (!res.ok) {
              setError(data.error || 'Failed to start checkout. Try again or contact us.');
              setIsLoading(false);
              return;
            }
            if (data.url) {
              window.location.href = data.url;
            } else {
              setError('Checkout URL missing — please try again.');
              setIsLoading(false);
            }
          } catch (err) {
            console.error('[media] checkout error:', err);
            setError('Network error — try again.');
            setIsLoading(false);
          }
        }}
      >
        {isLoading ? 'Starting checkout…' : `Buy ${title}`}
        {!isLoading && <ArrowRight className="w-4 h-4" />}
      </button>
      {error && (
        <p className="font-mono text-xs text-red-400 mt-3" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
