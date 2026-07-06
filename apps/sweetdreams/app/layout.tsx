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
import { BrandProvider } from '@/components/brand/BrandProvider';
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
      // Meta (Facebook) Business domain verification for sweetdreamsmusic.com.
      // Sweet-Dreams-specific (like the pixel id below) — future studios set
      // their own or remove; harmless on non-claimed hosts.
      'facebook-domain-verification': '0ppvagsw7fvvlfcr6jmg603u5py8y4',
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
        {/* Analytics id comes from brand_settings.ga_id (seeded for this studio);
            no id in the row = no tag, so a scaffolded studio never ships another
            studio's analytics. */}
        {brand.gaId && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${brand.gaId}`}
              strategy="afterInteractive"
            />
            <Script id="gtag-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${brand.gaId}');
              `}
            </Script>
          </>
        )}
        {/* Meta Pixel — GATED to the canonical production host only.
            The same codebase runs on Vercel preview URLs (*.vercel.app), on
            localhost, and on other domains attached to this project (e.g.
            sweetdreams.us). Without this guard the pixel fired on ALL of them,
            polluting the Sweet Dreams dataset with preview/dev/other-business
            traffic. Only init + PageView when the browser host is the real
            production domain (derived from SITE_URL so there's one source).
            Pixel id + FB domain verification are Sweet-Dreams-specific (this
            is the flagship's own app file) — future studios set their own. */}
        <Script id="meta-pixel" strategy="afterInteractive">
          {`if (${JSON.stringify([new URL(SITE_URL).host, 'www.' + new URL(SITE_URL).host])}.indexOf(location.hostname) !== -1) {
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '3631251467167744');
          fbq('track', 'PageView');
          }`}
        </Script>
        <JsonLd brand={brand} engineers={engineers} />
      </head>
      <body className={ibmPlexMono.className}>
        {/* Meta Pixel — noscript fallback */}
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: 'none' }}
            src="https://www.facebook.com/tr?id=3631251467167744&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
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
        <BrandProvider brand={brand}>
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
        </BrandProvider>
        <Analytics />
      </body>
    </html>
  );
}
