// lib/site-settings.ts — pure (no server deps): the white-label feature/nav
// flag types, safe defaults, the locked-on clamp, and nav filtering. Imported by
// the loader, the API route, the Header/Footer slots, and the admin panel.
//
// LOCKED features can never be turned off: studio sessions (/book, /pricing) and
// the beat store (/beats, /sell-beats). They have no DB column and always pass
// the nav filter — so neither a missing row, a corrupt row, nor a tampered
// request can hide them.

export const LOCKED_FEATURES = ['studio_sessions', 'beats'] as const;

export interface SiteSettings {
  bandsEnabled: boolean;
  eventsEnabled: boolean;
  mediaEnabled: boolean;
  nav: { about: boolean; contact: boolean; engineers: boolean; blog: boolean };
}

// SAFE DEFAULTS: everything on (a missing row → all on). Events on (encouraged).
export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  bandsEnabled: true,
  eventsEnabled: true,
  mediaEnabled: true,
  nav: { about: true, contact: true, engineers: true, blog: true },
};

/** Map a DB row → typed settings. Any missing/null field defaults to ON; only an
 *  explicit `false` turns something off (fail-open). */
export function siteSettingsFromRow(row: Record<string, unknown> | null | undefined): SiteSettings {
  if (!row) return DEFAULT_SITE_SETTINGS;
  const on = (v: unknown) => v !== false;
  return {
    bandsEnabled: on(row.bands_enabled),
    eventsEnabled: on(row.events_enabled),
    mediaEnabled: on(row.media_enabled),
    nav: {
      about: on(row.nav_about_enabled),
      contact: on(row.nav_contact_enabled),
      engineers: on(row.nav_engineers_enabled),
      blog: on(row.nav_blog_enabled),
    },
  };
}

// Locked hrefs are NEVER filtered out, regardless of settings.
const ALWAYS_ON_HREFS = new Set(['/book', '/pricing', '/beats', '/sell-beats']);

/** Is a given public route currently enabled? Locked routes are always true.
 *  Used by both the nav filter and the page-level guards. */
export function isHrefEnabled(href: string, s: SiteSettings): boolean {
  if (ALWAYS_ON_HREFS.has(href)) return true;
  switch (href) {
    case '/bands': return s.bandsEnabled;
    case '/events': return s.eventsEnabled;
    case '/media': return s.mediaEnabled;
    case '/engineers': return s.nav.engineers;
    case '/about': return s.nav.about;
    case '/contact': return s.nav.contact;
    case '/blog': return s.nav.blog;
    default: return true; // unknown links stay visible (e.g. future nav)
  }
}

/** Filter NAV_LINKS / FOOTER_EXTRA_LINKS by settings (locked hrefs always pass). */
export function visibleNavLinks<T extends { href: string }>(links: readonly T[], s: SiteSettings): T[] {
  return links.filter((l) => isHrefEnabled(l.href, s));
}
