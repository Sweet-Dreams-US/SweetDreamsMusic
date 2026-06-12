'use client';

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
