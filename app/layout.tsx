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
import { SEO, SITE_URL, GEO, BRAND } from '@/lib/constants';
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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SEO.defaultTitle,
    template: SEO.titleTemplate,
  },
  description: SEO.defaultDescription,
  keywords: SEO.keywords.join(', '),
  authors: [{ name: BRAND.legalName, url: SITE_URL }],
  creator: BRAND.name,
  publisher: BRAND.name,
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
  classification: 'Music Media Production',
  other: {
    'geo.region': GEO.region,
    'geo.placename': GEO.placeName,
    'format-detection': 'telephone=no',
    // Meta (Facebook) Business domain verification for sweetdreamsmusic.com.
    'facebook-domain-verification': '0ppvagsw7fvvlfcr6jmg603u5py8y4',
  },
  openGraph: {
    type: 'website',
    title: SEO.defaultTitle,
    description: 'Music media for artists, bands, and musicians in Fort Wayne, Indiana. Music videos, the Sweet Spot live-band series, short-form content, photo, cover art, and release marketing — plus a beat store.',
    url: SITE_URL,
    siteName: BRAND.name,
    locale: 'en_US',
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: 'Sweet Dreams Music — Music Media for Artists & Bands',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SEO.defaultTitle,
    description: 'Music videos, live sessions, short-form content, photo, and release marketing for musicians. Fort Wayne, IN.',
    images: [`${SITE_URL}/og-image.png`],
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
        {/* Meta Pixel — GATED to the canonical production host only.
            The same codebase runs on Vercel preview URLs (*.vercel.app), on
            localhost, and on other domains attached to this project (e.g.
            sweetdreams.us). Without this guard the pixel fired on ALL of them,
            polluting the Sweet Dreams dataset with preview/dev/other-business
            traffic. Only init + PageView when the browser host is the real
            production domain (derived from SITE_URL so there's one source). */}
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
        <JsonLd />
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
