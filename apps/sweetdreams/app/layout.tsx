import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/next';
import HeaderSlot from '@/components/layout/HeaderSlot';
import FooterSlot from '@/components/layout/FooterSlot';
import JsonLd from '@/components/seo/JsonLd';
import { AudioPlayerProvider } from '@/components/audio/AudioPlayerContext';
import AudioPlayerBar from '@/components/audio/AudioPlayerBar';
import MessageWidgetSlot from '@/components/messaging/MessageWidgetSlot';
import { SITE_URL } from '@/lib/constants';
import { getBrand } from '@/lib/brand-server';
import { getEngineers } from '@/lib/engineers-server';
import { geoRegion, cityState, stateName } from '@/lib/brand';
import './globals.css';

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

// Whitelabel W0: metadata is reconstructed from the Brand object (DB-driven,
// fail-open to constants). Every template below was verified character-exact
// against the legacy SEO/BRAND/GEO constants for Sweet Dreams' values.
export async function generateMetadata(): Promise<Metadata> {
  const b = await getBrand();
  const city = b.address.city; // 'Fort Wayne'
  const state = stateName(b); // 'Indiana' (full name — prose copy, not the 'IN' code)
  const defaultTitle = `${b.name} — ${city} Recording Studio & Beat Store`;

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: defaultTitle,
      template: `%s | ${b.name} — ${city} Recording Studio`,
    },
    description: `Professional recording studio in ${city}, ${state}. Two studios, four engineers, open 24/7. Beat store with MP3 leases, trackout leases, and exclusive rights. Music production, mixing, mastering, and artist development. Sessions starting at $50/hour.`,
    keywords: [
      `${city} recording studio`,
      'recording studio near me',
      `recording studio ${city} ${state}`,
      `music production ${city}`,
      'studio booking online',
      `mixing and mastering ${city}`,
      'professional recording studio',
      `studio rental ${city}`,
      `vocal recording ${city}`,
      `band recording ${state}`,
      'buy beats online',
      'beat store',
      'beat marketplace',
      `buy beats ${city}`,
      'lease beats online',
      'exclusive beats for sale',
      'music studio 24 hours',
      'affordable recording studio',
      'recording session booking',
      `artist development ${city}`,
      `music video production ${city}`,
      'sell beats online',
      'hip hop beats',
      'trap beats',
      'r&b beats',
      b.name,
      `${b.name} ${city}`,
    ].join(', '),
    authors: [{ name: b.legalName, url: SITE_URL }],
    creator: b.name,
    publisher: b.name,
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    alternates: {
      canonical: '/',
    },
    category: 'music',
    classification: 'Recording Studio',
    other: {
      'geo.region': geoRegion(b),
      'geo.placename': city,
      'format-detection': 'telephone=no',
    },
    openGraph: {
      type: 'website',
      title: defaultTitle,
      description: `Professional recording studio and beat store in ${city}, ${state}. Two studios, four engineers, open 24/7. Recording, mixing, mastering, music production, and beat marketplace. Sessions starting at $50/hour.`,
      url: SITE_URL,
      siteName: b.name,
      locale: 'en_US',
      images: [
        {
          url: `${SITE_URL}/og-image.png`,
          width: 1200,
          height: 630,
          alt: defaultTitle,
          type: 'image/png',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: defaultTitle,
      description: `Professional recording studio and beat store in ${cityState(b)}. Two studios, four engineers, open 24/7. Sessions starting at $50/hour.`,
      images: [`${SITE_URL}/og-image.png`],
    },
    verification: {
      google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Both loaders are react cache()'d — generateMetadata + Header/Footer slots
  // share the same per-request query, so this adds no extra round-trips.
  const [brand, engineers] = await Promise.all([getBrand(), getEngineers()]);
  return (
    <html lang="en">
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-85S88F3K6K"
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-85S88F3K6K');
          `}
        </Script>
        <JsonLd brand={brand} engineers={engineers} />
      </head>
      <body className={ibmPlexMono.className}>
        {/* Skip-to-content link — visually hidden until focused via keyboard.
            Lands on the <main> element below so screen reader / keyboard
            users can bypass the header navigation on every page.
            WCAG 2.4.1 (Bypass Blocks). */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:bg-accent focus:text-black focus:px-4 focus:py-3 focus:font-mono focus:text-sm focus:font-bold focus:tracking-wider focus:uppercase focus:outline-none focus:ring-2 focus:ring-black"
        >
          Skip to main content
        </a>
        <AudioPlayerProvider>
          <HeaderSlot />
          <main id="main-content" tabIndex={-1} className="min-h-screen pt-16 sm:pt-20 pb-20">
            {children}
          </main>
          <FooterSlot />
          <AudioPlayerBar />
          {/* Authenticated-only messaging widget — bottom-right floating
              chat button. Server component checks session + only renders
              for logged-in users; anonymous visitors see nothing. */}
          <MessageWidgetSlot />
        </AudioPlayerProvider>
        <Analytics />
      </body>
    </html>
  );
}
