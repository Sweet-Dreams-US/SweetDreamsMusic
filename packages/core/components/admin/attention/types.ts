// Shared types for the Admin Command Center ("Needs Your Attention").
// Imported by both the API route (server) and the components (client) —
// keep this file types-only so it is safe on both sides.

/** Admin dashboard tab keys a row can deep-link to.
 *  Subset of the `Tab` union in components/admin/AdminDashboard.tsx. */
export type AdminTab = 'bookings' | 'accounting' | 'packages' | 'producers' | 'beats';

/** One actionable item — rendered as a single clickable row. */
export interface AttentionItem {
  /** Stable unique id (the underlying DB row id). */
  id: string;
  /** Main label — the person or thing (e.g. a client name). */
  primary: string;
  /** Supporting detail — date, amount, reason (pre-formatted, display-ready). */
  secondary: string;
  /** When true the row is styled as highest-priority. */
  flagged?: boolean;
}

/** A labeled list of items of one kind, inside a group. */
export interface AttentionCategoryData {
  /** Stable key, e.g. 'pending_bookings'. */
  key: string;
  /** Human label, e.g. 'Bookings awaiting approval'. */
  label: string;
  /** True total count (may exceed items.length when capped). */
  total: number;
  /** Admin tab this category's rows deep-link to. */
  tab: AdminTab;
  /** Items, capped server-side. */
  items: AttentionItem[];
}

/** One of the four buckets. */
export interface AttentionGroupData {
  key: string;
  label: string;
  /** Sum of category totals. */
  count: number;
  /** Non-empty categories only. */
  categories: AttentionCategoryData[];
}

/** Full payload returned by GET /api/admin/attention. */
export interface AttentionResponse {
  /** Sum of all group counts. */
  totalCount: number;
  groups: AttentionGroupData[];
}
