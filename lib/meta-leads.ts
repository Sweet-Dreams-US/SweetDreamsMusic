// lib/meta-leads.ts — pull Meta Lead Ads submissions into meta_leads.
//
// Flow: list the Sweet Dreams PAGE's leadgen forms → fetch each form's leads →
// upsert by leadgen_id (idempotent — re-syncing never duplicates). Meta only
// retains leads ~90 days, so the sync makes the studio own its leads forever.
//
// REQUIREMENT: reading leadgen forms/leads needs the Sweet Dreams Music PAGE
// assigned to the system user in Business Settings (leads_retrieval scope is
// already on the token). Until it's assigned, sync throws PageAccessError and
// the Marketing tab shows exactly what to click instead of failing silently.
//
// SERVER ONLY — same auth pattern as lib/meta-marketing.ts (system-user token
// + appsecret_proof from env).

import { createHmac } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SWEET_DREAMS_META, type MetaMarketingConfig } from '@/lib/meta-marketing';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

const V = 'v25.0';

/** Thrown when the token can't see the page (asset not assigned yet). */
export class PageAccessError extends Error {
  constructor(pageId: string, cause: string) {
    super(
      `The Facebook Page (${pageId}) is not accessible to the system user — assign it in ` +
      `Business Settings → System users → Assign assets → Pages. Meta said: ${cause}`,
    );
    this.name = 'PageAccessError';
  }
}

async function graphGetAll<T>(path: string, params: Record<string, string>, maxPages = 10): Promise<T[]> {
  const appSecret = process.env.META_APP_SECRET;
  const token = process.env.META_ACCESS_TOKEN;
  if (!appSecret || !token) throw new Error('Meta env missing (META_APP_SECRET / META_ACCESS_TOKEN)');
  const proof = createHmac('sha256', appSecret).update(token).digest('hex');

  const out: T[] = [];
  let url = `https://graph.facebook.com/${V}/${path}?` + new URLSearchParams({
    access_token: token,
    appsecret_proof: proof,
    ...params,
  });
  for (let page = 0; page < maxPages && url; page++) {
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) {
      const msg: string = body?.error?.message ?? String(res.status);
      // Missing-permission / unknown-object errors on page paths mean the page
      // asset isn't assigned to the system user. Live Meta wordings seen:
      // "(#10) User has insufficient privileges on the page", "...permission...",
      // "Object does not exist / cannot be loaded due to missing permissions".
      if (/privileg|permission|access|does not exist|cannot be loaded/i.test(msg)) {
        throw new PageAccessError(path.split('/')[0], msg);
      }
      throw new Error(`Meta ${path}: ${msg}`);
    }
    out.push(...((body.data ?? []) as T[]));
    url = body.paging?.next ?? '';
  }
  return out;
}

type FieldDatum = { name: string; values: string[] };
type LeadRow = {
  id: string;
  created_time: string;
  field_data?: FieldDatum[];
  campaign_id?: string;
  campaign_name?: string;
  ad_id?: string;
  ad_name?: string;
};

/** Pull a value from Meta's field_data by common question names. */
function extract(fields: FieldDatum[] | undefined, names: string[]): string | null {
  for (const f of fields ?? []) {
    if (names.includes(f.name.toLowerCase())) {
      const v = (f.values ?? []).find((x) => x && x.trim());
      if (v) return v.trim();
    }
  }
  return null;
}

export interface LeadSyncResult {
  forms: number;
  fetched: number;
  inserted: number;
}

/**
 * Sync all lead-ad submissions for the studio's page into meta_leads.
 * Idempotent (upsert on leadgen_id). Returns counts for logging/UI.
 */
export async function syncMetaLeads(
  db: Client,
  cfg: MetaMarketingConfig = SWEET_DREAMS_META,
): Promise<LeadSyncResult> {
  const forms = await graphGetAll<{ id: string; name: string; status?: string }>(
    `${cfg.pageId}/leadgen_forms`,
    { fields: 'id,name,status', limit: '100' },
  );

  let fetched = 0;
  let inserted = 0;
  for (const form of forms) {
    const leads = await graphGetAll<LeadRow>(`${form.id}/leads`, {
      fields: 'id,created_time,field_data,campaign_id,campaign_name,ad_id,ad_name',
      limit: '100',
    });
    fetched += leads.length;
    if (leads.length === 0) continue;

    const rows = leads.map((l) => {
      const first = extract(l.field_data, ['first_name']);
      const last = extract(l.field_data, ['last_name']);
      return {
        leadgen_id: l.id,
        form_id: form.id,
        form_name: form.name,
        campaign_id: l.campaign_id ?? null,
        campaign_name: l.campaign_name ?? null,
        ad_id: l.ad_id ?? null,
        ad_name: l.ad_name ?? null,
        page_id: cfg.pageId,
        field_data: l.field_data ?? [],
        full_name:
          extract(l.field_data, ['full_name', 'name']) ??
          (first || last ? [first, last].filter(Boolean).join(' ') : null),
        email: extract(l.field_data, ['email', 'email_address', 'work_email']),
        phone: extract(l.field_data, ['phone_number', 'phone', 'work_phone_number']),
        created_time: l.created_time,
        synced_at: new Date().toISOString(),
      };
    });

    // Count genuinely-new rows (for the sync report), then upsert.
    const { data: existing } = await db
      .from('meta_leads')
      .select('leadgen_id')
      .in('leadgen_id', rows.map((r) => r.leadgen_id));
    const known = new Set(((existing ?? []) as Array<{ leadgen_id: string }>).map((r) => r.leadgen_id));
    inserted += rows.filter((r) => !known.has(r.leadgen_id)).length;

    const { error } = await db.from('meta_leads').upsert(rows, { onConflict: 'leadgen_id' });
    if (error) throw new Error(`meta_leads upsert failed: ${error.message}`);
  }

  return { forms: forms.length, fetched, inserted };
}
