import { SITE_URL, PRICING, ENGINEERS } from '@/lib/constants';
import { formatCents } from '@/lib/utils';
import { cityState, stateName, type Brand } from '@/lib/brand';

/**
 * Site-wide schema.org JSON-LD payload, injected once in the root layout
 * <head>. Each schema gets its own <script> so individual entries can
 * fail validation without breaking the others (Google's parser short-
 * circuits inside a single JSON object).
 *
 * Whitelabel W0: brand identity + the engineer roster now arrive as props
 * (layout fetches getBrand() + getEngineers()); every brand-bearing string
 * is a template verified character-exact against the legacy constants for
 * Sweet Dreams' values. PRICING stays constant-driven — pricing templating
 * is a later phase.
 *
 * Schemas emitted:
 *   • LocalBusiness / RecordingStudio  (the studio itself)
 *   • WebSite                          (with SearchAction)
 *   • MusicStore                       (the beat marketplace)
 *   • Person × N                       (one per engineer, linked to the studio)
 *   • FAQPage                          (common pricing / hours questions)
 *
 * Per-page schemas (Article for blog posts, Product for beats,
 * MusicEvent for events, BreadcrumbList for sub-pages) live in their
 * respective page files using the helpers exported below.
 */

const OG_IMAGE = `${SITE_URL}/og-image.png`;

/** Subset of the engineer roster the schemas need (EngineerRec satisfies it). */
export interface JsonLdEngineer {
  /** Canonical roster identity (immutable) — feeds the /engineers# anchor slug. */
  name: string;
  /** Public-facing name — feeds the Person.name field. */
  displayName: string;
  specialties: string[];
}

// TRANSITION (W0): the live `engineers` table has sort_order=0 on every row,
// so DB order is arbitrary. Anchor the JSON-LD roster to the legacy constant's
// order so output stays byte-identical; names not in the constant (future
// hires) keep their DB order after the known ones (sort() is stable). Remove
// once sort_order is curated in the admin Engineers tab.
const LEGACY_ENGINEER_ORDER = new Map<string, number>(ENGINEERS.map((e, i) => [e.name, i]));
function inLegacyOrder(list: JsonLdEngineer[]): JsonLdEngineer[] {
  const rank = (e: JsonLdEngineer) => LEGACY_ENGINEER_ORDER.get(e.name) ?? LEGACY_ENGINEER_ORDER.size;
  return [...list].sort((a, b) => rank(a) - rank(b));
}

// Official social presence → `sameAs`. Postgres jsonb does NOT preserve key
// order (sorts by length then bytewise: tiktok, youtube, instagram), so emit
// in a canonical platform order — matches the legacy hardcoded array exactly.
// Empty strings are filtered out so a missing handle doesn't pollute the
// `sameAs` array with empty references.
const PLATFORM_ORDER = ['instagram', 'youtube', 'tiktok'];
function sameAsLinks(b: Brand): string[] {
  const rank = (k: string) => {
    const i = PLATFORM_ORDER.indexOf(k);
    return i === -1 ? PLATFORM_ORDER.length : i;
  };
  return Object.entries(b.socials)
    .filter(([, url]) => Boolean(url))
    .sort(([a], [b2]) => rank(a) - rank(b2) || a.localeCompare(b2))
    .map(([, url]) => url);
}

function script(data: unknown) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

function LocalBusinessSchema({ brand, engineers }: { brand: Brand; engineers: JsonLdEngineer[] }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': ['RecordingStudio', 'LocalBusiness', 'MusicGroup'],
    '@id': `${SITE_URL}/#organization`,
    name: brand.name,
    alternateName: brand.legalName,
    description: `Professional 24/7 recording studio and beat marketplace in ${brand.address.city}, ${stateName(brand)}. Two studios, four engineers, music video production, band recording, and artist development. Sessions starting at $50/hour.`,
    url: SITE_URL,
    image: OG_IMAGE,
    logo: `${SITE_URL}/icon.png`,
    telephone: brand.phone || undefined,
    email: brand.email,
    address: {
      '@type': 'PostalAddress',
      addressLocality: brand.address.city,
      addressRegion: brand.address.state,
      addressCountry: brand.address.country,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: brand.geo.lat,
      longitude: brand.geo.lng,
    },
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      opens: '00:00',
      closes: '23:59',
    },
    priceRange: `${formatCents(PRICING.studioB)}-${formatCents(PRICING.studioASingleHour)}/hour`,
    currenciesAccepted: 'USD',
    paymentAccepted: 'Credit Card, Cash App Pay, Bank Transfer',
    areaServed: {
      '@type': 'City',
      name: brand.address.city,
      containedIn: {
        '@type': 'State',
        name: stateName(brand),
      },
    },
    numberOfEmployees: {
      '@type': 'QuantitativeValue',
      value: engineers.length,
    },
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Recording Services',
      itemListElement: [
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Studio A Recording Session',
            description:
              'Premium recording room with professional acoustics and equipment. Ideal for vocals, instruments, and full production.',
          },
          price: (PRICING.studioA / 100).toFixed(2),
          priceCurrency: 'USD',
          unitText: 'per hour',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Studio B Recording Session',
            description:
              'Versatile recording studio for all session types. Professional equipment and acoustics.',
          },
          price: (PRICING.studioB / 100).toFixed(2),
          priceCurrency: 'USD',
          unitText: 'per hour',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Mixing & Mastering',
            description:
              'Industry-standard mixing and mastering to make your tracks sound polished and radio-ready.',
          },
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Music Production',
            description: 'Full music production from beat-making to arrangement and sound design.',
          },
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Band Recording',
            description:
              'Multi-instrument band recording in Studio A. 4-hour ($440), 8-hour ($700), and 3-day ($1,800) flat-rate packages with a free 1-hr setup window.',
          },
          price: '440.00',
          priceCurrency: 'USD',
          unitText: 'starting at',
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Music Video Production',
            description:
              'Music videos, live-band shoots, short-form content, and Sweet Spot single-take features.',
          },
        },
      ],
    },
    sameAs: sameAsLinks(brand),
    knowsAbout: [
      'Music Recording',
      'Audio Mixing',
      'Audio Mastering',
      'Music Production',
      'Beat Making',
      'Vocal Recording',
      'Band Recording',
      'Sound Design',
      'Music Video Production',
      'Artist Development',
    ],
    employee: engineers.map((e) => ({
      '@type': 'Person',
      '@id': `${SITE_URL}/engineers#${e.name.toLowerCase().replace(/\s+/g, '-')}`,
      name: e.displayName,
      jobTitle: 'Recording Engineer',
      knowsAbout: e.specialties,
      worksFor: { '@id': `${SITE_URL}/#organization` },
    })),
  };

  return script(schema);
}

function WebSiteSchema({ brand }: { brand: Brand }) {
  return script({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: brand.name,
    url: SITE_URL,
    description: `Professional recording studio in ${cityState(brand)}. Book sessions, browse beats, and connect with experienced engineers.`,
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

function MusicStoreSchema({ brand }: { brand: Brand }) {
  return script({
    '@context': 'https://schema.org',
    '@type': 'MusicStore',
    '@id': `${SITE_URL}/#beatstore`,
    name: brand.storeName,
    description: `Online beat marketplace by ${brand.name}. Browse and license beats from ${brand.address.city} producers. MP3 leases, trackout leases, and exclusive rights available.`,
    url: `${SITE_URL}/beats`,
    image: OG_IMAGE,
    parentOrganization: { '@id': `${SITE_URL}/#organization` },
    address: {
      '@type': 'PostalAddress',
      addressLocality: brand.address.city,
      addressRegion: brand.address.state,
      addressCountry: brand.address.country,
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

function FAQSchema({ brand, engineers }: { brand: Brand; engineers: JsonLdEngineer[] }) {
  // Bare host for prose copy ("sweetdreamsmusic.com/book" — no protocol).
  const siteHost = SITE_URL.replace(/^https?:\/\//, '');
  const faqs = [
    {
      question: `How much does a recording session cost at ${brand.name}?`,
      answer: `Studio A starts at $${PRICING.studioA / 100} per hour and Studio B starts at $${PRICING.studioB / 100} per hour (2+ hour sessions). Single hour sessions are $${PRICING.studioASingleHour / 100} for Studio A and $${PRICING.studioBSingleHour / 100} for Studio B. We also offer "The Sweet 4" 4-hour flat-rate deals ($260 Studio A / $180 Studio B) and band recording packages starting at $440 for 4 hours.`,
    },
    {
      question: 'What are your studio hours?',
      answer: `${brand.name} is open 24 hours a day, 7 days a week. Standard rates apply 9 AM-10 PM. Late-night sessions (10 PM-2 AM) have a $10/hr surcharge, and after-hours sessions (2 AM-9 AM) have a $30/hr surcharge. Studio A is available evenings only on weekdays (6:30 PM+) and all day on weekends; Studio B is available at any hour.`,
    },
    {
      question: 'How do I book a recording session?',
      answer: `Visit our booking page at ${siteHost}/book, select your date, time, studio, and session length. You pay a 50% deposit at booking via Stripe (credit card, Cash App Pay, or bank transfer), and the remainder is charged to your saved payment method after your session.`,
    },
    {
      question: 'Do you offer mixing and mastering services?',
      answer:
        'Yes. All four of our engineers offer recording, mixing, mastering, and full music production services. You can request a specific engineer when booking your session.',
    },
    {
      question: `Where is ${brand.name} located?`,
      answer: `${brand.name} is a professional recording studio located in ${brand.address.city}, ${stateName(brand)}.`,
    },
    {
      question: 'Can I choose my engineer?',
      answer: `Yes, you can request a specific engineer when booking. We have ${engineers.length} engineers on staff, each with their own specialties. Your requested engineer holds a priority window to accept the session before it opens to other engineers in the same studio.`,
    },
    {
      question: 'Do you record bands or just individual artists?',
      answer:
        'Both. Band recording happens in Studio A on flat-rate packages: $440 for 4 hours, $700 for 8 hours, or $1,800 for a 3-day × 8-hour block. Each package includes a free 1-hour setup window before the metered session starts.',
    },
    {
      question: `How do beat licenses work on ${brand.storeName}?`,
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

export default function JsonLd({ brand, engineers }: { brand: Brand; engineers: JsonLdEngineer[] }) {
  const roster = inLegacyOrder(engineers);
  return (
    <>
      <LocalBusinessSchema brand={brand} engineers={roster} />
      <WebSiteSchema brand={brand} />
      <MusicStoreSchema brand={brand} />
      <FAQSchema brand={brand} engineers={roster} />
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
