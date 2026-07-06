// lib/meta-audiences.ts — Meta Custom Audiences for the Marketing tab.
//
// READ (works today): list the ad account's audiences (name/type/size).
// NOTE: audiences are ACCOUNT-level and Meta provides no page/business
// attribution for them (many are pixel- or IG-based), so on this shared ad
// account the list includes every business's audiences — unlike campaigns,
// they cannot be reliably filtered to Sweet Dreams only. The UI labels this.
//
// WRITE (gated by Meta): creating a customer-list audience and uploading
// hashed customers requires ads_management ADVANCED ACCESS (App Review +
// business verification) and the ad account's Custom Audience ToS acceptance.
// Until then Meta returns a permissions error → typed AudienceWriteError so
// the UI shows the exact approvals needed instead of a generic failure.
//
// Customer data privacy: only SHA-256 hashes of normalized emails/phones are
// ever sent to Meta (the standard Customer List Custom Audience mechanism).
//
// SERVER ONLY — same env/auth pattern as lib/meta-marketing.ts.

import { createHash, createHmac } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SWEET_DREAMS_META, type MetaMarketingConfig } from '@/lib/meta-marketing';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

const V = 'v25.0';

/** Thrown when audience WRITES are blocked (Advanced Access / CA ToS pending). */
export class AudienceWriteError extends Error {
  constructor(cause: string) {
    super(
      'Meta blocked the audience write. Creating audiences via API needs (1) Advanced Access for ' +
      'ads_management (App Review + business verification in the App Dashboard) and (2) the ad ' +
      `account's Custom Audience Terms accepted in Ads Manager. Meta said: ${cause}`,
    );
    this.name = 'AudienceWriteError';
  }
}

function creds() {
  const appSecret = process.env.META_APP_SECRET;
  const token = process.env.META_ACCESS_TOKEN;
  if (!appSecret || !token) throw new Error('Meta env missing (META_APP_SECRET / META_ACCESS_TOKEN)');
  return { token, proof: createHmac('sha256', appSecret).update(token).digest('hex') };
}

async function graph(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string> = {},
): Promise<any> {
  const { token, proof } = creds();
  const auth = { access_token: token, appsecret_proof: proof };
  const res = await fetch(
    method === 'GET'
      ? `https://graph.facebook.com/${V}/${path}?` + new URLSearchParams({ ...auth, ...params })
      : `https://graph.facebook.com/${V}/${path}`,
    method === 'GET' ? {} : { method, body: new URLSearchParams({ ...auth, ...params }) },
  );
  const body = await res.json();
  if (!res.ok) {
    const msg: string = body?.error?.message ?? String(res.status);
    if (method === 'POST' && /permission|access|terms/i.test(msg)) throw new AudienceWriteError(msg);
    throw new Error(`Meta ${path}: ${msg}`);
  }
  return body;
}

export interface AudienceRow {
  id: string;
  name: string;
  subtype: string;
  size: number | null;         // approximate_count_lower_bound; null when Meta hides it
  deliveryStatus: string | null;
  updated: string | null;
}

/** List the ad account's audiences (all businesses — see file header). */
export async function listAudiences(cfg: MetaMarketingConfig = SWEET_DREAMS_META): Promise<AudienceRow[]> {
  const body = await graph('GET', `${cfg.adAccountId}/customaudiences`, {
    fields: 'id,name,subtype,approximate_count_lower_bound,delivery_status,time_updated',
    limit: '100',
  });
  return ((body.data ?? []) as any[]).map((a) => ({
    id: a.id,
    name: a.name,
    subtype: a.subtype ?? '',
    size: typeof a.approximate_count_lower_bound === 'number' && a.approximate_count_lower_bound >= 0
      ? a.approximate_count_lower_bound
      : null,
    deliveryStatus: a.delivery_status?.description ?? null,
    updated: a.time_updated ? new Date(a.time_updated * 1000).toISOString() : null,
  }));
}

// ── Customer sourcing + hashing ───────────────────────────────────────────

export type CustomerSource = 'all_customers' | 'booking_customers' | 'beat_buyers';

/** Meta normalization: emails lowercase/trimmed; phones digits-only with US
 *  country code assumed for 10-digit numbers. Hash = SHA-256 hex. */
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export function normalizeEmail(e: string): string | null {
  const v = e.trim().toLowerCase();
  return /.+@.+\..+/.test(v) ? v : null;
}
export function normalizePhone(p: string): string | null {
  let d = p.replace(/\D/g, '');
  if (d.length === 10) d = `1${d}`;
  return d.length >= 11 ? d : null;
}

/** Distinct customer emails/phones from the platform for a given source. */
export async function getPlatformCustomers(
  db: Client,
  source: CustomerSource,
): Promise<{ emails: string[]; phones: string[] }> {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const take = (email?: string | null, phone?: string | null) => {
    if (email) { const e = normalizeEmail(email); if (e) emails.add(e); }
    if (phone) { const p = normalizePhone(phone); if (p) phones.add(p); }
  };

  if (source === 'all_customers' || source === 'booking_customers') {
    const { data } = await db
      .from('bookings')
      .select('customer_email, customer_phone')
      .not('status', 'eq', 'cancelled')
      .limit(5000);
    for (const b of (data ?? []) as any[]) take(b.customer_email, b.customer_phone);
  }
  if (source === 'all_customers' || source === 'beat_buyers') {
    const { data } = await db.from('beat_purchases').select('buyer_email').limit(5000);
    for (const p of (data ?? []) as any[]) take(p.buyer_email);
  }
  return { emails: [...emails], phones: [...phones] };
}

// ── Audience creation + population (gated by Advanced Access) ─────────────

export interface CreateAudienceResult {
  audienceId: string;
  emailsUploaded: number;
  phonesUploaded: number;
}

/**
 * Create a customer-list Custom Audience and upload the platform's customers
 * (hashed). Throws AudienceWriteError while Meta write access is pending.
 */
export async function createCustomerAudience(
  db: Client,
  name: string,
  source: CustomerSource,
  cfg: MetaMarketingConfig = SWEET_DREAMS_META,
): Promise<CreateAudienceResult> {
  const { emails, phones } = await getPlatformCustomers(db, source);
  if (emails.length + phones.length === 0) {
    throw new Error('No customers found for that source.');
  }

  const created = await graph('POST', `${cfg.adAccountId}/customaudiences`, {
    name,
    subtype: 'CUSTOM',
    description: `Sweet Dreams platform customers (${source}) — synced from the studio platform`,
    customer_file_source: 'USER_PROVIDED_ONLY',
  });
  const audienceId: string = created.id;

  // Upload hashed identifiers in batches (Meta cap: 10k rows per call).
  const BATCH = 5000;
  const upload = async (schema: 'EMAIL_SHA256' | 'PHONE_SHA256', values: string[]) => {
    for (let i = 0; i < values.length; i += BATCH) {
      const slice = values.slice(i, i + BATCH).map((v) => [sha256(v)]);
      await graph('POST', `${audienceId}/users`, {
        payload: JSON.stringify({ schema: [schema], data: slice }),
      });
    }
  };
  await upload('EMAIL_SHA256', emails);
  await upload('PHONE_SHA256', phones);

  return { audienceId, emailsUploaded: emails.length, phonesUploaded: phones.length };
}
