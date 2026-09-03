import { SITE_URL, BRAND, GEO, SOCIAL_LINKS } from '@/lib/constants';

/**
 * Site-wide schema.org JSON-LD payload, injected once in the root layout
 * <head>. Each schema gets its own <script> so individual entries can
 * fail validation without breaking the others (Google's parser short-
 * circuits inside a single JSON object).
 *
 * Schemas emitted (post 2026-09 media pivot — no recording-studio claims):
 *   • LocalBusiness / ProfessionalService  (the media company)
 *   • WebSite                              (with SearchAction → beat store)
 *   • MusicStore                           (the beat marketplace)
 *   • FAQPage                              (what we do / where to record now)
 *
 * Per-page schemas (Article for blog posts, Product for beats,
 * MusicEvent for events, BreadcrumbList for sub-pages) live in their
 * respective page files using the helpers exported below.
 *
 * Public surfaces never show media prices (Cole's rule), so the offer
 * catalog below is deliberately price-less.
 */

const OG_IMAGE = `${SITE_URL}/og-image.png`;
const PHONE = BRAND.phone || undefined;

// Official social presence — `sameAs`. Empty strings are filtered out so a
// missing handle doesn't pollute the array with empty references.
const SAME_AS = Object.values(SOCIAL_LINKS).filter(Boolean);

function script(data: unknown) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

const SERVICE_OFFERS = [
  {
    name: 'Music Video Production',
    description: 'Concept, shoot, and edit — from a mid-tier single visual to a premium multi-location music video.',
  },
  {
    name: 'The Sweet Spot — Live Band Video Session',
    description: 'Live-band video series: two songs played live, multicam video, a professional mix, short-form clips, featured on the Sweet Dreams YouTube.',
  },
  {
    name: 'Short-Form Content',
    description: 'Reels, TikToks, and Shorts cut for the feed — basic, mid, and premium tiers.',
  },
  {
    name: 'Photo Sessions',
    description: 'Press shots, promo photos, and on-set stills for artists and bands.',
  },
  {
    name: 'Cover Art',
    description: 'Single and project artwork designed to read at thumbnail size.',
  },
  {
    name: 'Release Marketing',
    description: 'Rollout planning, content calendars, and campaign strategy — hourly or in 4-hour blocks.',
  },
];

function LocalBusinessSchema() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': ['ProfessionalService', 'LocalBusiness'],
    '@id': `${SITE_URL}/#organization`,
    name: BRAND.name,
    alternateName: BRAND.legalName,
    description:
      'Music media company in Fort Wayne, Indiana. Music videos, the Sweet Spot live-band video series, short-form content, photo sessions, cover art, and release marketing for artists, bands, and musicians. Also home to the Sweet Dreams Beat Store.',
    url: SITE_URL,
    image: OG_IMAGE,
    logo: `${SITE_URL}/icon.png`,
    telephone: PHONE,
    email: BRAND.email,
    address: {
      '@type': 'PostalAddress',
      addressLocality: BRAND.address.city,
      addressRegion: BRAND.address.state,
      addressCountry: BRAND.address.country,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: 41.0793,
      longitude: -85.1394,
    },
    currenciesAccepted: 'USD',
    paymentAccepted: 'Credit Card, Cash App Pay, Bank Transfer',
    areaServed: {
      '@type': 'City',
      name: GEO.placeName,
      containedIn: {
        '@type': 'State',
        name: 'Indiana',
      },
    },
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Music Media Services',
      itemListElement: SERVICE_OFFERS.map((o) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: o.name, description: o.description },
      })),
    },
    sameAs: SAME_AS,
    knowsAbout: [
      'Music Video Production',
      'Live Session Video',
      'Short-Form Video Content',
      'Music Photography',
      'Cover Art Design',
      'Music Marketing',
      'Release Strategy',
      'Content Creation for Musicians',
      'Beat Licensing',
    ],
    parentOrganization: {
      '@type': 'Organization',
      name: 'Sweet Dreams',
      url: 'https://sweetdreams.us',
    },
  };

  return script(schema);
}

function WebSiteSchema() {
  return script({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: BRAND.name,
    url: SITE_URL,
    description:
      'Music media for artists, bands, and musicians in Fort Wayne, IN. Music videos, live sessions, content, photo, marketing, and a beat store.',
    inLanguage: 'en-US',
    publisher: { '@id': `${SITE_URL}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/beats?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  });
}

function MusicStoreSchema() {
  return script({
    '@context': 'https://schema.org',
    '@type': 'MusicStore',
    '@id': `${SITE_URL}/#beatstore`,
    name: 'Sweet Dreams Beat Store',
    description:
      'Online beat marketplace by Sweet Dreams Music. Browse and license beats from Fort Wayne producers. MP3 leases, trackout leases, and exclusive rights available.',
    url: `${SITE_URL}/beats`,
    image: OG_IMAGE,
    parentOrganization: { '@id': `${SITE_URL}/#organization` },
    address: {
      '@type': 'PostalAddress',
      addressLocality: BRAND.address.city,
      addressRegion: BRAND.address.state,
      addressCountry: BRAND.address.country,
    },
    priceRange: '$29.99 - $400+',
    currenciesAccepted: 'USD',
    paymentAccepted: 'Credit Card, Cash App Pay, Bank Transfer',
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Beat Licenses',
      itemListElement: [
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'MP3 Lease',
            description:
              'MP3 download with non-exclusive license for streaming and personal projects. 1-year term.',
          },
          price: '29.99',
          priceCurrency: 'USD',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Trackout Lease',
            description:
              'Stems and trackouts with non-exclusive license for mixing, distribution, and streaming. 2-year term.',
          },
          price: '74.99',
          priceCurrency: 'USD',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Exclusive Rights',
            description:
              'Full ownership with all rights transferred. Beat removed from store after purchase.',
          },
          price: '400.00',
          priceCurrency: 'USD',
        },
      ],
    },
  });
}

function FAQSchema() {
  const faqs = [
    {
      question: 'What does Sweet Dreams Music do?',
      answer:
        'Sweet Dreams Music is a music media company in Fort Wayne, Indiana. We make music videos, the Sweet Spot live-band video series, short-form content, photo sessions, and cover art for artists, bands, and musicians, and we help plan the release. We also run the Sweet Dreams Beat Store.',
    },
    {
      question: 'Does Sweet Dreams Music still offer recording sessions?',
      answer:
        'No. Sweet Dreams Music no longer offers recording sessions or studio bookings. We refer artists who need studio time to a partner studio — see sweetdreamsmusic.com/recording. Past clients can still download their session files from their dashboard.',
    },
    {
      question: 'What is the Sweet Spot?',
      answer:
        'The Sweet Spot is our live-band video series. A band plays two songs live, we film it multicam, mix both songs professionally, cut short-form clips for social, and feature the session on the Sweet Dreams YouTube channel.',
    },
    {
      question: 'How do I get pricing for a music video or media package?',
      answer:
        'Create a free account and open the Media Hub in your dashboard to see pricing, configure a package, and book. You can also contact us at sweetdreamsmusic.com/contact and we will scope the project with you.',
    },
    {
      question: 'Do you work with bands as well as solo artists?',
      answer:
        'Yes. Bands get the Sweet Spot, music videos, shorts, and photo, plus a shared band hub on the platform. Solo artists get the same media services and the artist hub.',
    },
    {
      question: 'Where is Sweet Dreams Music located?',
      answer:
        'Sweet Dreams Music is based in Fort Wayne, Indiana. We shoot on location across the region and on our floor for live sessions and photo.',
    },
    {
      question: 'How do beat licenses work on Sweet Dreams Beat Store?',
      answer:
        'Three license tiers: MP3 Lease ($29.99, 1-year, MP3 only), Trackout Lease ($74.99, 2-year, stems + MP3), and Exclusive Rights (starting at $400, permanent ownership with the beat removed from the store on purchase). Producers receive 60% of every sale.',
    },
  ];

  return script({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  });
}

export default function JsonLd() {
  return (
    <>
      <LocalBusinessSchema />
      <WebSiteSchema />
      <MusicStoreSchema />
      <FAQSchema />
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Per-page schema helpers — import directly into the page that needs them.
// Each helper returns a single <script> element ready to drop into the
// page's tree (Server Components are fine for these; nothing reactive).
// ──────────────────────────────────────────────────────────────────────

export interface BreadcrumbCrumb {
  name: string;
  url: string;
}

/**
 * BreadcrumbList helper. Pass in the trail in order (root → leaf) and
 * we'll emit the schema with correct `position` indexes. Helps Google
 * render breadcrumb rich-snippets in search results and gives LLMs a
 * clean path-of-arrival for every page.
 *
 * Example:
 *   <BreadcrumbList crumbs={[
 *     { name: 'Home', url: '/' },
 *     { name: 'Beats', url: '/beats' },
 *     { name: beat.title, url: `/beats/${beat.id}` },
 *   ]} />
 */
export function BreadcrumbList({ crumbs }: { crumbs: BreadcrumbCrumb[] }) {
  if (crumbs.length === 0) return null;
  return script({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url.startsWith('http') ? c.url : `${SITE_URL}${c.url.startsWith('/') ? c.url : `/${c.url}`}`,
    })),
  });
}

/**
 * Generic helper to drop a JSON-LD payload anywhere in a server component.
 * Useful for per-page schemas (Article, Product, MusicEvent) without
 * having to re-implement the dangerouslySetInnerHTML boilerplate.
 */
export function JsonLdScript({ data }: { data: unknown }) {
  return script(data);
}
