// lib/meta-pixel.ts
// Client-side Meta Pixel (fbq) helpers. The base pixel + PageView load in
// app/layout.tsx; these fire STANDARD EVENTS from button clicks, form submits,
// and key page views so Meta ad campaigns can optimize for + report conversions
// (Purchase, Lead, InitiateCheckout, ViewContent, …).
//
// Every call is GUARDED: it no-ops if fbq hasn't loaded yet or we're rendering
// on the server, so it is always safe to call from any client component without
// crashing or blocking the UI.
//
// IMPORTANT — money: this app stores amounts in CENTS, but Meta's `value` is in
// DOLLARS (e.g. 50.00). Always pass `value: cents / 100` with `currency: 'USD'`.

export type MetaEventParams = {
  value?: number;
  currency?: string;
  content_name?: string;
  content_category?: string;
  content_ids?: string[];
  content_type?: string;
  contents?: Array<{ id: string; quantity: number }>;
  num_items?: number;
  search_string?: string;
  predicted_ltv?: number;
  status?: string | boolean;
  [key: string]: unknown;
};

declare global {
  interface Window {
    fbq?: (
      method: 'track' | 'trackCustom',
      event: string,
      params?: MetaEventParams,
    ) => void;
  }
}

/** Fire a Meta STANDARD event (Purchase, Lead, InitiateCheckout, ViewContent, …). */
export function trackMeta(event: string, params?: MetaEventParams): void {
  try {
    if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
      window.fbq('track', event, params);
    }
  } catch {
    /* analytics must never break the UI */
  }
}

/** Fire a Meta CUSTOM event (a non-standard event name). */
export function trackMetaCustom(event: string, params?: MetaEventParams): void {
  try {
    if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
      window.fbq('trackCustom', event, params);
    }
  } catch {
    /* analytics must never break the UI */
  }
}

/** Convert a cents integer to a Meta-friendly dollars number (2 dp). */
export function centsToDollars(cents: number | null | undefined): number {
  if (!cents || !Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}
