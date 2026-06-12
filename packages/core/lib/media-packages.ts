// lib/media-packages.ts
//
// Round 8c: shared types + helpers for media booking packages.
// Used by API routes, the admin PackageBuilder UI, and the buyer
// PackageReview UI. Pure module — no DB or HTTP.

export type LineItemKind =
  | 'planning_call'
  | 'cover_art'
  | 'shorts'
  | 'music_video'
  | 'photo_session'
  | 'filming_external'
  | 'mixing_session'
  | 'design_meeting'
  | 'recording_session'
  | 'other';

export const LINE_ITEM_KIND_LABELS: Record<LineItemKind, string> = {
  planning_call: 'Planning call',
  cover_art: 'Cover art',
  shorts: 'Shorts',
  music_video: 'Music video',
  photo_session: 'Photo session',
  filming_external: 'External filming',
  mixing_session: 'Mixing session',
  design_meeting: 'Design meeting',
  recording_session: 'Recording session',
  other: 'Other',
};

export const LINE_ITEM_KINDS: LineItemKind[] = Object.keys(LINE_ITEM_KIND_LABELS) as LineItemKind[];

export interface LineItem {
  id: string;
  package_id: string;
  kind: LineItemKind;
  source_slot_key: string | null;
  label: string;
  qty: number;
  unit_cents: number;
  total_cents: number;
  notes: string | null;
  approval_status: 'pending' | 'approved' | 'rejected';
  approved_at: string | null;
  sort_order: number;
  // Round 8e: completion + delivery
  completed?: boolean;
  completed_at?: string | null;
  completed_by?: string | null;
  drive_url?: string | null;
  notified_at?: string | null;
}

export interface Package {
  id: string;
  booking_id: string;
  status: 'draft' | 'sent' | 'approved';
  total_cents: number;
  notes: string | null;
  proposed_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
}

export interface PackageWithLineItems extends Package {
  line_items: LineItem[];
}

/**
 * Per Cole's rule (May 4 spec):
 *   • Music video and above always need a planning call / in-person meeting
 *   • More than 2 shorts triggers the same requirement
 *   • Single/double shorts: messaging-only is fine
 *
 * Returns true if the package needs a planning_call line item auto-injected.
 */
export function packageNeedsPlanningCall(items: Pick<LineItem, 'kind' | 'qty'>[]): boolean {
  for (const item of items) {
    if (item.kind === 'music_video') return true;
    if (item.kind === 'shorts' && item.qty > 2) return true;
  }
  return false;
}

/**
 * Insert a planning_call line item at sort_order 0 if the rule fires AND
 * one isn't already present. Returns the items list (potentially with the
 * planning call prepended) and whether anything was added.
 */
export function ensurePlanningCallInjection<T extends Pick<LineItem, 'kind' | 'qty'>>(
  items: T[],
  buildItem: () => T,
): { items: T[]; injected: boolean } {
  if (!packageNeedsPlanningCall(items)) return { items, injected: false };
  if (items.some((i) => i.kind === 'planning_call')) return { items, injected: false };
  return { items: [buildItem(), ...items], injected: true };
}

/** Rederive a package's total_cents from its line items. */
export function computePackageTotalCents(items: Pick<LineItem, 'total_cents'>[]): number {
  return items.reduce((sum, i) => sum + (Number(i.total_cents) || 0), 0);
}

/** Recompute a single line item's total_cents from qty × unit_cents. */
export function lineItemTotalCents(qty: number, unit_cents: number): number {
  return Math.max(0, Math.round(qty * unit_cents));
}

/** True if every line item in the package is approved. */
export function isPackageFullyApproved(items: Pick<LineItem, 'approval_status'>[]): boolean {
  return items.length > 0 && items.every((i) => i.approval_status === 'approved');
}
