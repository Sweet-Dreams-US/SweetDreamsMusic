import type { ReactNode } from 'react';

// components/legal/LegalPage.tsx — shared shell for the legal/compliance pages
// (Privacy Policy, Terms of Service, User Data Deletion). These pages are
// required by Meta App Review (valid Privacy Policy / ToS / Data Deletion URLs)
// and must ALWAYS be reachable — no feature-flag gating.
//
// text-black is explicit on the white body (never inherit --foreground: the OS
// dark-mode preference flips it near-white and washes the text out — the same
// bug fixed on the booking-invite page).

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-heading-sm mb-3">{heading}</h2>
      <div className="font-mono text-sm text-black/80 leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export default function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <>
      <section className="bg-black text-white pt-28 sm:pt-36 pb-12 sm:pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-heading-xl">{title}</h1>
          <p className="font-mono text-xs text-white/60 mt-3">Last updated: {updated}</p>
        </div>
      </section>
      <section className="bg-white text-black py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">{children}</div>
      </section>
    </>
  );
}
