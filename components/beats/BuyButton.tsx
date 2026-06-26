'use client';

import { trackMeta, centsToDollars } from '@/lib/meta-pixel';
import { BEAT_LICENSES } from '@/lib/constants';

export default function BuyButton({ beatId, licenseType, isExclusive }: { beatId: string; licenseType: string; isExclusive?: boolean }) {
  return (
    <button
      type="button"
      className={`w-full font-mono text-xs font-bold uppercase tracking-wider py-2.5 transition-colors ${
        isExclusive
          ? 'bg-accent text-black hover:bg-accent/90'
          : 'bg-white text-black hover:bg-white/90'
      }`}
      onClick={async () => {
        const license = BEAT_LICENSES[licenseType as keyof typeof BEAT_LICENSES];
        trackMeta('InitiateCheckout', {
          currency: 'USD',
          content_name: license?.name,
          content_category: 'beats',
          content_ids: [beatId],
          // List price for this license (per-beat custom pricing can differ; the
          // Purchase event on success reads the exact charged amount).
          ...(license?.defaultPrice ? { value: centsToDollars(license.defaultPrice) } : {}),
        });
        const res = await fetch('/api/beats/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ beatId, licenseType }),
        });
        if (res.status === 401) {
          window.location.href = `/login?redirect=/beats/${beatId}`;
          return;
        }
        const data = await res.json();
        if (data.url) window.location.href = data.url;
      }}
    >
      Buy {isExclusive ? 'Exclusive' : 'License'}
    </button>
  );
}
