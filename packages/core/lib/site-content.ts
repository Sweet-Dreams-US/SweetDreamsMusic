// lib/site-content.ts — the CMS registry + read helpers (pure, client-safe).
// CONTENT_REGISTRY is the single source of truth: it IS the fallback defaults,
// the seed source, the admin editor's field list, AND the types. A page reads a
// value with content(map, key); the loader merges these defaults under any DB
// override, and content() falls back to the registry default too — so a missing
// or half-populated CMS can never blank a page. NEVER register a string that
// interpolates a live price (those stay in code, synced to studio_rooms).

import { STUDIO_IMAGES } from '@/lib/images';

export type ContentKind = 'text' | 'richtext' | 'image' | 'list' | 'number';

export interface ContentField {
  key: string;            // 'home.hero.kicker'
  group: string;          // 'home' (== group_name; drives admin tab grouping)
  label: string;          // admin label
  kind: ContentKind;
  default: string | string[] | number; // current copy = fallback + seed value
}

export const CONTENT_REGISTRY: readonly ContentField[] = [
  // ── footer (renders on every page) ──
  { key: 'footer.brand.blurb', group: 'footer', label: 'Brand blurb', kind: 'richtext', default: 'Professional recording studio in Fort Wayne, IN. Sessions starting at $60/hour.' },
  { key: 'footer.hours.headline', group: 'footer', label: 'Hours headline', kind: 'text', default: 'Open 24 Hours — 7 Days a Week' },
  { key: 'footer.company.label', group: 'footer', label: 'Company link label', kind: 'text', default: 'A Sweet Dreams Company' },
  // ── home ──
  { key: 'home.hero.kicker', group: 'home', label: 'Hero kicker', kind: 'text', default: 'Fort Wayne Recording Studio' },
  { key: 'home.hero.image', group: 'home', label: 'Hero background image', kind: 'image', default: STUDIO_IMAGES.studioBSideLowAngleWide },
  // ── about ──
  { key: 'about.hero.kicker', group: 'about', label: 'Hero kicker', kind: 'text', default: 'About Us' },
  { key: 'about.hero.title', group: 'about', label: 'Hero title', kind: 'text', default: 'THE STUDIO' },
  { key: 'about.hero.intro', group: 'about', label: 'Hero intro', kind: 'richtext', default: "Sweet Dreams Music is Fort Wayne's premier recording studio. We provide a professional, creative environment where artists can bring their vision to life." },
  { key: 'about.body.heading', group: 'about', label: 'Body heading', kind: 'text', default: 'TWO STUDIOS. ONE MISSION.' },
  // ── contact ──
  { key: 'contact.hero.kicker', group: 'contact', label: 'Hero kicker', kind: 'text', default: 'Get in Touch' },
  { key: 'contact.hero.title', group: 'contact', label: 'Hero title', kind: 'text', default: 'CONTACT US' },
  { key: 'contact.hero.intro', group: 'contact', label: 'Hero intro', kind: 'richtext', default: "Have a question about booking, pricing, or our services? Send us a message and we'll get back to you." },
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
