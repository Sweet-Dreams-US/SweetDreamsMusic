// Achievement definitions are in lib/achievements.ts — re-exported here for convenience
export { ACHIEVEMENTS } from './achievements';

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sweetdreamsmusic.com';

export const BRAND = {
  name: 'Sweet Dreams Music',
  legalName: 'Sweet Dreams LLC',
  tagline: 'Fort Wayne Recording Studio',
  phone: '',
  email: 'info@sweetdreamsmusic.com',
  address: {
    street: '',
    city: 'Fort Wayne',
    state: 'IN',
    zip: '',
    country: 'US',
  },
};

export const SEO = {
  defaultTitle: 'Sweet Dreams Music — Fort Wayne Recording Studio & Beat Store',
  titleTemplate: '%s | Sweet Dreams Music — Fort Wayne Recording Studio',
  defaultDescription: 'Professional recording studio in Fort Wayne, Indiana. Two studios, four engineers, open 24/7. Beat store with MP3 leases, trackout leases, and exclusive rights. Music production, mixing, mastering, and artist development. Sessions starting at $50/hour.',
  keywords: [
    'Fort Wayne recording studio',
    'recording studio near me',
    'recording studio Fort Wayne Indiana',
    'music production Fort Wayne',
    'studio booking online',
    'mixing and mastering Fort Wayne',
    'professional recording studio',
    'studio rental Fort Wayne',
    'vocal recording Fort Wayne',
    'band recording Indiana',
    'buy beats online',
    'beat store',
    'beat marketplace',
    'buy beats Fort Wayne',
    'lease beats online',
    'exclusive beats for sale',
    'music studio 24 hours',
    'affordable recording studio',
    'recording session booking',
    'artist development Fort Wayne',
    'music video production Fort Wayne',
    'sell beats online',
    'hip hop beats',
    'trap beats',
    'r&b beats',
    'Sweet Dreams Music',
    'Sweet Dreams Music Fort Wayne',
  ],
};

export const GEO = {
  region: 'US-IN',
  placeName: 'Fort Wayne',
};

export const PRICING = {
  studioA: 7000, // $70/hr in cents
  studioB: 5000, // $50/hr in cents (2+ hours)
  studioASingleHour: 8000, // $80 for 1-hour session
  studioBSingleHour: 6000, // $60 for 1-hour session
  lateNightSurcharge: 1000, // +$10/hr (10PM–2AM)
  deepNightSurcharge: 3000, // +$30/hr (2AM–9AM)
  sameDaySurcharge: 1000, // +$10/hr
  depositPercent: 50, // 50% deposit
  minHours: 1,
  maxHours: 8,
  currency: 'usd' as const,
};

// The Sweet 4 — flat-rate 4-hour discount package
// (The brand "Sweet Spot" now refers to our band showcase program at /bands.
//  The old Sweet Spot discount rate was renamed The Sweet 4 on 2026-04-22.)
export const SWEET_4 = {
  studio_a: { hours: 4, price: 26000, label: 'The Sweet 4 — Studio A', perHour: 6500 }, // $260
  studio_b: { hours: 4, price: 18000, label: 'The Sweet 4 — Studio B', perHour: 4500 }, // $180
} as const;

// Band Recording — Studio A only.
//
// Updated 2026-04-28 per Cole:
//   • 4hr  → $440 flat (was $400). Includes free 1hr of setup before.
//   • 8hr  → $700 flat (was $680/$85hr). Includes free 1hr of setup before.
//   • 3×8  → $1,800 unchanged. Setup hour applies to day 1 only — days 2-3
//            are already on hold for that band, so the studio doesn't need
//            extra padding.
//
// Setup-hour padding is recorded on the row via bookings.setup_minutes_before
// (migration 041). Conflict checks subtract that many minutes from start_time
// when computing the blocked window. The customer-facing PRICE here covers
// only the session itself; the setup hour is free.
export const BAND_PRICING = [
  { hours: 4, price: 44000, label: '4 Hours', perHour: 11000, note: 'Free 1-hr setup before' },
  { hours: 8, price: 70000, label: '8 Hours', perHour: 8750, note: 'Flat. Free 1-hr setup before' },
  { hours: 24, price: 180000, label: '3 Days (8hr each)', perHour: 7500, note: '$75/hr · setup hr on day 1 only' },
] as const;

// How much free setup time to pad before a band session on the calendar.
// Bands need to load gear, mic the drums, etc. before the metered hours
// start. Set on bookings.setup_minutes_before for self-serve band 4/8hr
// sessions. The 3×8 block sets it on day 1 only.
export const BAND_SETUP_MINUTES = 60;

// Sweet Spot pricing (cents). Standalone is the premium price; bundling
// with an existing 1×8hr or 3×8hr band session unlocks the discounted
// add-on rates per Cole 2026-04-28. The 3-day full Sweet Spot is the
// best value because the studio is already on hold for those dates.
export const SWEET_SPOT_PRICING = {
  standalone: 250000,        // $2,500 — original price, used by /media catalog
  addOnTo8hrSession: 200000, // $2,000 — bundle with one 8hr band session
  addOnTo3DayFull: 100000,   // $1,000 — bundle with the 3×8 band block
} as const;

export const STUDIO_HOURS = {
  // Open 24 hours
  regular: { start: 9, end: 22 }, // 9 AM - 10 PM (no surcharge)
  lateNight: { start: 22, end: 2 }, // 10 PM - 2 AM (+$10/hr)
  deepNight: { start: 2, end: 9 }, // 2 AM - 9 AM (+$30/hr)
};

export const ROOMS = ['studio_a', 'studio_b'] as const;
export type Room = (typeof ROOMS)[number];

export const ROOM_LABELS: Record<Room, string> = {
  studio_a: 'Studio A',
  studio_b: 'Studio B',
};

export const ROOM_RATES: Record<Room, number> = {
  studio_a: PRICING.studioA,
  studio_b: PRICING.studioB,
};

export const ROOM_RATES_SINGLE: Record<Room, number> = {
  studio_a: PRICING.studioASingleHour,
  studio_b: PRICING.studioBSingleHour,
};

export const ENGINEERS = [
  { name: 'PRVRB', displayName: 'PRVRB', email: 'prvrbsounds@gmail.com', specialties: ['Recording', 'Mixing & Mastering', 'Production'], studios: ['studio_a'] as Room[] },
  { name: 'Iszac Griner', displayName: 'Iszac', email: 'iisszzaacc@gmail.com', specialties: ['Recording', 'Mixing & Mastering', 'Production'], studios: ['studio_a', 'studio_b'] as Room[] },
  { name: 'Zion', displayName: 'Zion', email: 'zionomari@artsaturated.com', specialties: ['Recording', 'Mixing & Mastering', 'Production'], studios: ['studio_b'] as Room[] },
  { name: 'Jay Val Leo', displayName: 'Jay Val Leo', email: 'jayvalleo@sweetdreamsmusic.com', specialties: ['Recording', 'Mixing & Mastering', 'Production'], studios: ['studio_b'] as Room[] },
] as const;

export type EngineerConfig = (typeof ENGINEERS)[number];

/**
 * Resolve an engineer roster entry from the user's auth email.
 *
 * Why email and not display_name: profile.display_name is user-editable
 * and drifts (e.g. an engineer changes their preferred name after
 * marriage, rebrand, or just personal preference). Email is the stable,
 * us-owned identifier. Booking accept/claim flows MUST resolve
 * identity from email so the system never refuses a legitimate engineer
 * because their preferred name doesn't match the roster string.
 *
 * Case-insensitive on both sides — Supabase auth emails are lower-case
 * but historical data in the roster is mixed-case.
 */
export function findEngineerByEmail(email: string | null | undefined): EngineerConfig | undefined {
  if (!email) return undefined;
  const lower = email.toLowerCase();
  return ENGINEERS.find((e) => e.email.toLowerCase() === lower);
}

/**
 * Test whether the engineer behind `email` is the same human the booking
 * was requested for, given a `requested_engineer` string (which the
 * customer picked from a canonical dropdown). Returns true when:
 *   - The engineer is in the roster AND their canonical name OR
 *     displayName matches the requested string, OR
 *   - The engineer is NOT in the roster but their fallback identifier
 *     (display_name or email) matches verbatim.
 *
 * Use this anywhere you compare a logged-in engineer to a booking's
 * `requested_engineer` field so name drift can't reject legitimate
 * accepts again.
 */
export function isSameEngineer(
  email: string | null | undefined,
  fallbackName: string | null | undefined,
  requestedEngineer: string | null | undefined,
): boolean {
  if (!requestedEngineer) return false;
  const cfg = findEngineerByEmail(email);
  if (cfg) {
    return cfg.name === requestedEngineer || cfg.displayName === requestedEngineer;
  }
  // Engineer is not in the static roster — fall back to verbatim string match.
  return !!fallbackName && fallbackName === requestedEngineer;
}

// Super admins — full access to everything
export const SUPER_ADMINS = [
  'cole@sweetdreams.us',
  'jayvalleo@sweetdreams.us',
  'jayvalleo@sweetdreamsmusic.com',
] as const;

export const TIMEZONE = 'America/Indiana/Indianapolis';

// Guest fees — artist + 2 guests (3 people) are free, $10/hr per extra person beyond that
export const GUEST_FEE_PER_HOUR = 1000; // $10/hr in cents
export const FREE_GUESTS = 3;           // artist + 2 guests free (3 people total)
export const MAX_GUESTS = 12;           // max people allowed in a session

// Studio A is only available 6:30 PM+ on weekdays (Mon-Fri), all day on weekends
export const STUDIO_A_WEEKDAY_START = 18.5; // 6:30 PM

// Beat store license types
export const BEAT_LICENSES = {
  mp3_lease: {
    name: 'MP3 Lease',
    description: '1-year license. MP3 download. Stream, distribute, and monetize.',
    deliveryFormat: 'MP3 (320kbps)',
    defaultPrice: 2999, // $29.99
  },
  trackout_lease: {
    name: 'Trackout Lease',
    description: '2-year license. Stems + MP3. Full mixing rights, distribution, and monetization.',
    deliveryFormat: 'Stems + MP3',
    defaultPrice: 7499, // $74.99
  },
  exclusive: {
    name: 'Exclusive Rights',
    description: 'Permanent ownership. Beat removed from store. All rights transferred.',
    deliveryFormat: 'WAV + Stems + Trackout + MP3',
    defaultPrice: 40000, // $400.00
  },
} as const;

export type BeatLicenseType = keyof typeof BEAT_LICENSES;

// Lease duration in days per license type (null = permanent/no expiry)
export const LEASE_DURATION_DAYS: Record<string, number | null> = {
  mp3_lease: 365,       // 1 year
  trackout_lease: 730,  // 2 years
  exclusive: null,      // permanent
};

// Renewal discount — 75% of original price (pay 75%, save 25%)
export const RENEWAL_DISCOUNT = 0.75;

// Beat store commission rates
export const PRODUCER_COMMISSION = 0.60; // 60% to producer
export const PLATFORM_COMMISSION = 0.40; // 40% to platform
export const ENGINEER_SESSION_SPLIT = 0.60; // 60% to engineer for sessions
export const BUSINESS_SESSION_SPLIT = 0.40; // 40% to business for sessions
export const MEDIA_SELLER_COMMISSION = 0.15; // 15% to seller for media sales
export const MEDIA_BUSINESS_CUT = 0.35; // 35% to business for media sales
export const MEDIA_WORKER_TOTAL = 0.50; // 50% total to workers (split if both filmed_by and edited_by)
export const EXCLUSIVE_PRICE_FLOOR = 40000; // $400 minimum exclusive price in cents

// Beat store genres with cover art colors
export const BEAT_GENRES: { value: string; label: string; bg: string; text: string }[] = [
  { value: 'Hip-Hop', label: 'Hip-Hop', bg: '#1a1a2e', text: '#e6c94a' },
  { value: 'Trap', label: 'Trap', bg: '#0d0d0d', text: '#ff4444' },
  { value: 'R&B', label: 'R&B', bg: '#2d1b4e', text: '#e8a0ff' },
  { value: 'Pop', label: 'Pop', bg: '#ff6b9d', text: '#ffffff' },
  { value: 'Drill', label: 'Drill', bg: '#0a0a0a', text: '#00e5ff' },
  { value: 'Lo-Fi', label: 'Lo-Fi', bg: '#2c3e50', text: '#f39c12' },
  { value: 'Afrobeats', label: 'Afrobeats', bg: '#1b5e20', text: '#ffd600' },
  { value: 'Soul', label: 'Soul', bg: '#4a1a2e', text: '#ffb74d' },
  { value: 'Jazz', label: 'Jazz', bg: '#1a237e', text: '#c5cae9' },
  { value: 'Rock', label: 'Rock', bg: '#3e0000', text: '#ffffff' },
  { value: 'Country', label: 'Country', bg: '#5d4037', text: '#ffcc80' },
  { value: 'Electronic', label: 'Electronic', bg: '#0d0d0d', text: '#00ff88' },
  { value: 'Latin', label: 'Latin', bg: '#e65100', text: '#fff9c4' },
  { value: 'Reggaeton', label: 'Reggaeton', bg: '#004d40', text: '#80cbc4' },
  { value: 'Boom Bap', label: 'Boom Bap', bg: '#212121', text: '#bdbdbd' },
];

// Primary navigation — rendered in the Header on every page.
// The logo links to '/' so Home is not repeated here.
// Blog was moved to the footer; see FOOTER_EXTRA_LINKS below.
export const NAV_LINKS = [
  { href: '/book', label: 'Book' },
  { href: '/beats', label: 'Beats' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/engineers', label: 'Engineers' },
  { href: '/media', label: 'Media' },
  { href: '/bands', label: 'Bands' },
  { href: '/events', label: 'Events' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
] as const;

// Links that show in the footer only (never in the Header).
// Useful for secondary destinations we want crawlable and reachable
// without cluttering the primary nav.
export const FOOTER_EXTRA_LINKS = [
  { href: '/blog', label: 'Blog' },
] as const;

export type UserRole = 'user' | 'engineer' | 'admin' | 'media_manager';

// Beat agreement
export const BEAT_AGREEMENT_VERSION = '1.1';

export const BEAT_AGREEMENT_TEXT = `BEAT LICENSING & DISTRIBUTION AGREEMENT
Version ${BEAT_AGREEMENT_VERSION} — Sweet Dreams Music LLC

This Agreement ("Agreement") is entered into between the Producer ("You") and Sweet Dreams Music LLC ("Platform"), governing the listing, licensing, and distribution of musical compositions ("Beats") on the Platform.

1. REVENUE SPLIT
All revenue generated from the licensing or sale of your Beats through the Platform shall be split as follows:
- Producer: 60% of gross sale price
- Platform: 40% of gross sale price
Payouts are processed on a regular schedule. The Platform handles all payment processing and applicable fees.

2. LICENSE GRANT
By listing a Beat on the Platform, you grant Sweet Dreams Music LLC a non-exclusive right to:
- Display, promote, and distribute the Beat through the Platform's beat store
- Facilitate licensing transactions (MP3 Lease, Trackout Lease, Exclusive Rights) on your behalf
- Use the Beat title, audio preview, and your producer name in marketing materials related to the Platform
- Upload and publish the Beat's tagged/watermarked preview to the Platform's YouTube channel and social media accounts for promotional purposes
- List and sell the Beat through affiliated studio locations and partner platforms operated under the Platform's network, with the same revenue split applied
This license is non-exclusive. You retain ownership of your Beats and may sell or license them through other channels. Beats sold through affiliated studio locations are subject to the same 60/40 revenue split and all earnings are credited to your producer account regardless of which studio location facilitates the sale.

3. PRODUCER WARRANTIES
You represent and warrant that:
- You are the sole creator and rights holder of each Beat you submit, or have obtained all necessary permissions
- All samples used in the Beat are either original, properly licensed, royalty-free, or fully cleared for commercial use
- The Beat does not infringe upon any third-party copyrights, trademarks, or other intellectual property rights
- You have the legal authority to enter into this Agreement

4. PLATFORM RESPONSIBILITIES
The Platform agrees to:
- List and promote approved Beats on the beat store and affiliated studio platforms
- Promote Beats via the Platform's YouTube channel and social media presence
- Handle all payment processing, licensing documentation, and file delivery to buyers
- Provide a producer dashboard with sales tracking, earnings reports, and payout history
- Remit the Producer's share of revenue according to the agreed split, including sales made through affiliated studio locations

5. SAMPLE CLEARANCE
You are solely responsible for ensuring all samples used in your Beats are properly cleared for commercial licensing. The Platform is not liable for any copyright claims arising from uncleared samples. If a Beat is found to contain uncleared samples, the Platform reserves the right to immediately remove it from the store.

6. CONTENT REMOVAL
The Platform reserves the right to remove any Beat from the store at any time for policy violations, legal concerns, quality standards, or any other reason at its sole discretion.

7. TERMINATION
Either party may terminate this Agreement with 30 days written notice. Upon termination:
- Active license agreements with buyers remain in effect
- The Producer's Beats will be removed from the store
- Any pending earnings will be paid out according to the regular payout schedule
- The Producer may not relicense or resell any Beat that was sold as an Exclusive through the Platform

8. LIMITATION OF LIABILITY
The Platform shall not be liable for any indirect, incidental, or consequential damages arising from this Agreement. The Platform's total liability shall not exceed the total amount paid to the Producer under this Agreement.

9. GOVERNING LAW
This Agreement shall be governed by the laws of the State of Indiana, United States.

By signing below, you acknowledge that you have read, understood, and agree to all terms of this Agreement.`;
