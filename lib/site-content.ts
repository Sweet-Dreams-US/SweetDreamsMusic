// lib/site-content.ts — the CMS registry + read helpers (pure, client-safe).
// CONTENT_REGISTRY is the single source of truth: it IS the fallback defaults,
// the seed source, the admin editor's field list, AND the types. A page reads a
// value with content(map, key); the loader merges these defaults under any DB
// override, and content() falls back to the registry default too — so a missing
// or half-populated CMS can never blank a page. NEVER register a string that
// interpolates a live price.
//
// 2026-09 MEDIA PIVOT: the recording-era keys (home.hero.kicker/image,
// footer.brand.blurb, footer.hours.headline, about.hero.title/intro,
// about.body.heading, contact.hero.intro) were RETIRED and replaced with new
// key names rather than re-defaulted. Reason: the loader lets a DB row win over
// the registry default, and every one of those rows still holds the seeded
// recording copy — re-using the key would have kept the old text live. Rows for
// unregistered keys are ignored by the loader (harmless orphans; safe to delete).

import { SWEET_SPOT_IMAGES } from '@/lib/images';

export type ContentKind = 'text' | 'richtext' | 'image' | 'list' | 'number';

export interface ContentField {
  key: string;            // 'home.hero.eyebrow'
  group: string;          // 'home' (== group_name; drives admin tab grouping)
  label: string;          // admin label
  kind: ContentKind;
  default: string | string[] | number; // current copy = fallback + seed value
}

export const CONTENT_REGISTRY: readonly ContentField[] = [
  // ── footer (renders on every page) ──
  { key: 'footer.brand.intro', group: 'footer', label: 'Brand intro', kind: 'richtext', default: 'Music media for artists, bands, and musicians. Music videos, live sessions, short-form content, photo, and release marketing — Fort Wayne, IN.' },
  { key: 'footer.contact.headline', group: 'footer', label: 'Contact headline', kind: 'text', default: 'Based in Fort Wayne. On set wherever the song takes us.' },
  { key: 'footer.company.label', group: 'footer', label: 'Company link label', kind: 'text', default: 'A Sweet Dreams Company' },
  // ── home ──
  { key: 'home.hero.eyebrow', group: 'home', label: 'Hero eyebrow', kind: 'text', default: 'Fort Wayne Music Media' },
  { key: 'home.hero.background', group: 'home', label: 'Hero background image', kind: 'image', default: SWEET_SPOT_IMAGES.wide },
  // ── about ──
  { key: 'about.hero.kicker', group: 'about', label: 'Hero kicker', kind: 'text', default: 'About Us' },
  { key: 'about.hero.heading', group: 'about', label: 'Hero heading', kind: 'text', default: 'MADE FOR MUSICIANS' },
  { key: 'about.hero.lede', group: 'about', label: 'Hero lede', kind: 'richtext', default: 'Sweet Dreams Music is a music media company in Fort Wayne, Indiana. We make music videos, live sessions, short-form content, and photo for artists, bands, and musicians — and help them release it.' },
  { key: 'about.story.heading', group: 'about', label: 'Story heading', kind: 'text', default: 'THE SONG COMES FIRST.' },
  // ── contact ──
  { key: 'contact.hero.kicker', group: 'contact', label: 'Hero kicker', kind: 'text', default: 'Get in Touch' },
  { key: 'contact.hero.title', group: 'contact', label: 'Hero title', kind: 'text', default: 'CONTACT US' },
  { key: 'contact.hero.lede', group: 'contact', label: 'Hero lede', kind: 'richtext', default: "Have a project in mind, or a question about music videos, shorts, photo, or the Sweet Spot? Send us a message and we'll get back to you." },
] as const;

export const REGISTRY_BY_KEY: Record<string, ContentField> = Object.fromEntries(CONTENT_REGISTRY.map((f) => [f.key, f]));
export const CONTENT_GROUPS: string[] = [...new Set(CONTENT_REGISTRY.map((f) => f.group))];

export type ContentValue = string | string[] | number;
export type ContentMap = Record<string, ContentValue>;

/** Read a text value: DB/merged value → explicit fallback → registry default → ''. */
export function content(map: ContentMap, key: string, fallback?: string): string {
  const v = map[key];
  if (typeof v === 'string' && v.length > 0) return v;
  if (fallback != null) return fallback;
  const d = REGISTRY_BY_KEY[key]?.default;
  return typeof d === 'string' ? d : '';
}

export function contentList(map: ContentMap, key: string, fallback?: string[]): string[] {
  const v = map[key];
  if (Array.isArray(v)) return v;
  if (fallback) return fallback;
  const d = REGISTRY_BY_KEY[key]?.default;
  return Array.isArray(d) ? d : [];
}

export function contentNum(map: ContentMap, key: string, fallback?: number): number {
  const v = map[key];
  if (typeof v === 'number') return v;
  if (fallback != null) return fallback;
  const d = REGISTRY_BY_KEY[key]?.default;
  return typeof d === 'number' ? d : 0;
}
