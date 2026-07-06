// lib/meta-marketing.ts — server-side Meta Marketing API reader for the admin
// Marketing tab.
//
// CRITICAL CONSTRAINT: the ad account (act_1948835248854581) is SHARED — other
// businesses (e.g. M.C. Racing Fort Wayne) run campaigns in it. Account-level
// numbers therefore lie. Everything here is computed from AD-LEVEL insights
// joined to the set of ads whose creative promotes the Sweet Dreams Music
// Facebook page / Instagram account, so other businesses' campaigns can never
// leak into the dashboard.
//
// Auth: system-user token (never expires) + appsecret_proof on every call.
// Credentials live in env (META_APP_ID / META_APP_SECRET / META_ACCESS_TOKEN):
// .env.local locally, Vercel project env in production. SERVER ONLY — never
// import this from a client component.
//
// Per-studio future (Dream Suite): SWEET_DREAMS_META below becomes a row in a
// studio_marketing_connections table; the functions already take the config as
// an argument so only the loader changes.

import { createHmac } from 'crypto';

export interface MetaMarketingConfig {
  adAccountId: string; // "act_..."
  pageId: string;      // Facebook page whose ads count as "ours"
  igId: string;        // Instagram actor id whose ads count as "ours"
}

/** Sweet Dreams Music (tenant #1). Page/IG ids verified 2026-07-06 by probing
 *  every ad's creative: 4 SDM campaigns promote this page/IG; the MC Racing
 *  campaign (page 356815420848335) is correctly excluded by the filter. */
export const SWEET_DREAMS_META: MetaMarketingConfig = {
  adAccountId: 'act_1948835248854581',
  pageId: '1062672440254662',
  igId: '17841477770496396',
};

const V = 'v25.0';

export type MarketingRangeDays = 7 | 28 | 90;
const DATE_PRESET: Record<MarketingRangeDays, string> = {
  7: 'last_7d',
  28: 'last_28d',
  90: 'last_90d',
};

export interface CampaignRow {
  id: string;
  name: string;
  status: string;       // effective_status of the campaign
  spend: number;        // dollars
  impressions: number;
  clicks: number;
  cpc: number | null;   // dollars
  cpm: number | null;   // dollars
  linkClicks: number;
  leads: number;
  purchases: number;
}

export interface MarketingSnapshot {
  rangeDays: MarketingRangeDays;
  since: string; // YYYY-MM-DD (from Meta's insights rows)
  until: string;
  totals: {
    spend: number;
    impressions: number;
    clicks: number;
    cpc: number | null;
    cpm: number | null;
    linkClicks: number;
    leads: number;
    purchases: number;
  };
  campaigns: CampaignRow[];
  /** Ads in the account that do NOT promote our page/IG (other businesses). */
  excludedAdCount: number;
  includedAdCount: number;
}

function requireEnv() {
  const appSecret = process.env.META_APP_SECRET;
  const token = process.env.META_ACCESS_TOKEN;
  if (!appSecret || !token) {
    throw new Error('Meta Marketing API env missing (META_APP_SECRET / META_ACCESS_TOKEN)');
  }
  return { appSecret, token };
}

/** GET a Graph API path with token + appsecret_proof, following paging. */
async function graphGetAll<T>(path: string, params: Record<string, string>, maxPages = 10): Promise<T[]> {
  const { appSecret, token } = requireEnv();
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
      throw new Error(`Meta ${path}: ${body?.error?.message ?? res.status}`);
    }
    out.push(...((body.data ?? []) as T[]));
    url = body.paging?.next ?? '';
  }
  return out;
}

type AdRow = {
  id: string;
  creative?: {
    object_story_spec?: { page_id?: string; instagram_actor_id?: string };
    actor_id?: string;
    instagram_user_id?: string;
    effective_object_story_id?: string;
  };
};

/** All ad ids in the account that promote OUR page/IG, plus the excluded count. */
export async function listOwnAdIds(cfg: MetaMarketingConfig): Promise<{ own: Set<string>; excluded: number }> {
  const ads = await graphGetAll<AdRow>(`${cfg.adAccountId}/ads`, {
    fields: 'id,creative{object_story_spec,actor_id,instagram_user_id,effective_object_story_id}',
    limit: '200',
  });
  const own = new Set<string>();
  let excluded = 0;
  for (const ad of ads) {
    const spec = ad.creative?.object_story_spec;
    const pageId = spec?.page_id ?? ad.creative?.actor_id ?? ad.creative?.effective_object_story_id?.split('_')[0];
    const igId = spec?.instagram_actor_id ?? ad.creative?.instagram_user_id;
    if (String(pageId) === cfg.pageId || String(igId) === cfg.igId) own.add(ad.id);
    else excluded++;
  }
  return { own, excluded };
}

type InsightRow = {
  ad_id: string;
  campaign_id: string;
  campaign_name: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
  date_start: string;
  date_stop: string;
};

function actionSum(actions: InsightRow['actions'], types: string[]): number {
  if (!actions) return 0;
  return actions
    .filter((a) => types.includes(a.action_type))
    .reduce((s, a) => s + (parseInt(a.value, 10) || 0), 0);
}

// 10-minute in-memory cache — the dashboard refetches freely (tab switches,
// range toggles) but we stay far inside Meta's rate limits. Keyed per
// account+range so a future multi-studio deployment can't cross-serve.
const cache = new Map<string, { at: number; data: MarketingSnapshot }>();
const CACHE_MS = 10 * 60 * 1000;

/**
 * The Sweet-Dreams-only marketing snapshot for a date range: totals + a
 * per-campaign table, aggregated from ad-level insights restricted to ads that
 * promote our page/IG. Campaigns whose ads all belong to other businesses do
 * not appear at all.
 */
export async function getMarketingSnapshot(
  rangeDays: MarketingRangeDays,
  cfg: MetaMarketingConfig = SWEET_DREAMS_META,
): Promise<MarketingSnapshot> {
  const cacheKey = `${cfg.adAccountId}:${rangeDays}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const [{ own, excluded }, insights, campaignsMeta] = await Promise.all([
    listOwnAdIds(cfg),
    graphGetAll<InsightRow>(`${cfg.adAccountId}/insights`, {
      level: 'ad',
      date_preset: DATE_PRESET[rangeDays],
      fields: 'ad_id,campaign_id,campaign_name,spend,impressions,clicks,actions,date_start,date_stop',
      limit: '500',
    }),
    graphGetAll<{ id: string; effective_status?: string }>(`${cfg.adAccountId}/campaigns`, {
      fields: 'id,effective_status',
      limit: '200',
    }),
  ]);

  const statusById = new Map(campaignsMeta.map((c) => [c.id, c.effective_status ?? '']));
  const byCampaign = new Map<string, CampaignRow>();
  const totals = { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, purchases: 0 };
  let since = '';
  let until = '';
  let includedAdCount = 0;

  for (const row of insights) {
    if (!own.has(row.ad_id)) continue; // ← the shared-account filter
    includedAdCount++;
    since = row.date_start;
    until = row.date_stop;
    const spend = parseFloat(row.spend ?? '0') || 0;
    const impressions = parseInt(row.impressions ?? '0', 10) || 0;
    const clicks = parseInt(row.clicks ?? '0', 10) || 0;
    const linkClicks = actionSum(row.actions, ['link_click']);
    const leads = actionSum(row.actions, ['lead', 'leadgen_grouped']);
    const purchases = actionSum(row.actions, ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']);

    let c = byCampaign.get(row.campaign_id);
    if (!c) {
      c = {
        id: row.campaign_id,
        name: row.campaign_name,
        status: statusById.get(row.campaign_id) ?? '',
        spend: 0, impressions: 0, clicks: 0, cpc: null, cpm: null,
        linkClicks: 0, leads: 0, purchases: 0,
      };
      byCampaign.set(row.campaign_id, c);
    }
    c.spend += spend; c.impressions += impressions; c.clicks += clicks;
    c.linkClicks += linkClicks; c.leads += leads; c.purchases += purchases;
    totals.spend += spend; totals.impressions += impressions; totals.clicks += clicks;
    totals.linkClicks += linkClicks; totals.leads += leads; totals.purchases += purchases;
  }

  const finalize = (spend: number, clicks: number, impressions: number) => ({
    cpc: clicks > 0 ? spend / clicks : null,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
  });
  const campaigns = [...byCampaign.values()]
    .map((c) => ({ ...c, ...finalize(c.spend, c.clicks, c.impressions) }))
    .sort((a, b) => b.spend - a.spend);

  const snapshot: MarketingSnapshot = {
    rangeDays,
    since,
    until,
    totals: { ...totals, ...finalize(totals.spend, totals.clicks, totals.impressions) },
    campaigns,
    excludedAdCount: excluded,
    includedAdCount,
  };
  cache.set(cacheKey, { at: Date.now(), data: snapshot });
  return snapshot;
}
