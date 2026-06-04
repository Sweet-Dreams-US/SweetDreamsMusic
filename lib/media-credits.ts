// lib/media-credits.ts
//
// Pure helpers for the media credit ledger (media_credits table, migration
// 064). NO Supabase / secrets — safe to import from client or server. The
// server sibling logic (granting on purchase, consuming on schedule) lives in
// the webhook + API routes.
//
// Model: buying a media package/item deposits a BALANCE of deliverable credits
// on the account (3 short videos, 1 music video, 1 photo session, ...). The
// artist later schedules each credit as a media_session_bookings request.

import type { MediaOffering } from './media';
import type { ConfiguredComponents } from './media-config';

export const CREDIT_KINDS = [
  'short_video',
  'music_video',
  'photo_session',
  'cover_art',
  'marketing_session',
  'planning_call',
  'studio_hours',
  'other',
] as const;

export type CreditKind = (typeof CREDIT_KINDS)[number];

export const CREDIT_KIND_LABELS: Record<CreditKind, string> = {
  short_video: 'Short Video',
  music_video: 'Music Video',
  photo_session: 'Photo Session',
  cover_art: 'Cover Art',
  marketing_session: 'Marketing Session',
  planning_call: 'Planning Call',
  studio_hours: 'Studio Hours',
  other: 'Other',
};

// Which credit kinds are SCHEDULABLE as a dated shoot/session (Phase 5 surfaces
// a date+time request for these). cover_art is a deliverable credit but not a
// "shoot" — handled async by the team, so it's excluded from the schedule picker.
export const SCHEDULABLE_CREDIT_KINDS: CreditKind[] = [
  'short_video',
  'music_video',
  'photo_session',
  'marketing_session',
  'planning_call',
];

export interface CreditGrant {
  credit_kind: CreditKind;
  quantity: number;
  label: string;
  tier?: string | null;
}

// Standalone offering slug → the single credit it grants.
const STANDALONE_SLUG_KIND: Record<string, CreditKind> = {
  'short-basic': 'short_video',
  'short-mid': 'short_video',
  'short-premium': 'short_video',
  'mv-mid': 'music_video',
  'mv-premium': 'music_video',
  'photo-session': 'photo_session',
  'cover-art': 'cover_art',
  'marketing-plan-hourly': 'marketing_session',
  'marketing-plan-block': 'marketing_session',
};

/**
 * Map a package component slot to a credit kind. Only fixed-count `unit` slots
 * produce a concrete credit. recording_hours (studio_credits owns hours),
 * mix_master (bundled, not separately scheduled), and by-arrangement slot kinds
 * (per_song / on_shoot / flexible / included) return null — those are scoped
 * with the media team via the existing package/line-item flow, not auto-granted.
 */
function creditKindForUnitSlot(key: string): CreditKind | null {
  const k = key.toLowerCase();
  if (k === 'mix_master' || k === 'recording_hours') return null;
  if (k.includes('short')) return 'short_video';
  if (k.includes('music_video')) return 'music_video';
  if (k.includes('photo')) return 'photo_session';
  if (k.includes('cover')) return 'cover_art';
  if (k.includes('marketing')) return 'marketing_session';
  return null;
}

/**
 * Compute the deliverable credits a purchased cart item grants. Needs the
 * offering's base `components` (the cart snapshot only carries the buyer's
 * configured_components), so the webhook fetches the offering row first.
 *
 * - Standalone offering → 1 credit by slug (tier inferred from slug suffix).
 * - Package offering → one grant per fixed-count `unit` slot, honoring the
 *   buyer's skip choices and capturing their chosen tier.
 * - studio_hours are intentionally NOT returned here (granted to studio_credits
 *   by the webhook from studio_hours_included — avoids double-grant).
 */
export function creditGrantsFromOffering(
  offering: Pick<MediaOffering, 'kind' | 'slug' | 'title' | 'components'>,
  configured: ConfiguredComponents | null | undefined,
): CreditGrant[] {
  // Standalone: one credit keyed by slug.
  if (offering.kind === 'standalone') {
    const kind = STANDALONE_SLUG_KIND[offering.slug];
    if (!kind) return [];
    const tier = offering.slug.endsWith('-premium')
      ? 'premium'
      : offering.slug.endsWith('-mid')
        ? 'mid'
        : offering.slug.endsWith('-basic')
          ? 'basic'
          : null;
    return [{ credit_kind: kind, quantity: 1, label: offering.title, tier }];
  }

  // Package: walk the component slots.
  const slots = offering.components?.slots ?? [];
  const selections = configured?.selections ?? {};
  const grants: CreditGrant[] = [];

  for (const slot of slots) {
    if (slot.kind !== 'unit') continue; // skip hours/per_song/on_shoot/flexible/included
    const sel = selections[slot.key];
    if (sel?.skipped) continue; // buyer opted out of this slot
    const credit_kind = creditKindForUnitSlot(slot.key);
    if (!credit_kind) continue;
    const quantity = typeof slot.count === 'number' && slot.count > 0 ? slot.count : 1;
    grants.push({
      credit_kind,
      quantity,
      label: slot.label || CREDIT_KIND_LABELS[credit_kind],
      tier: sel?.tier ?? null,
    });
  }

  return grants;
}

/** Combined remaining-balance shape for the Hub balance view. */
export interface MediaCreditBalance {
  credit_kind: CreditKind;
  label: string;
  remaining: number;
  granted: number;
}
