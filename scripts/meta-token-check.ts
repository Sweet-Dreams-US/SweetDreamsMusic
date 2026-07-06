/**
 * scripts/meta-token-check.ts — verify the Meta Marketing API credentials.
 *   npx tsx --env-file=.env.local scripts/meta-token-check.ts
 *
 * Proves the stored META_ACCESS_TOKEN actually works before we build anything
 * on it: debugs the token (type / scopes / expiry), then lists the ad accounts
 * it can read. Prints ONLY non-secret metadata — never the token or secret.
 * All calls send appsecret_proof (the app requires it for server calls).
 */
import { createHmac } from 'crypto';

const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;
const TOKEN = process.env.META_ACCESS_TOKEN;
if (!APP_ID || !APP_SECRET || !TOKEN) {
  console.error('Missing META_APP_ID / META_APP_SECRET / META_ACCESS_TOKEN. Run with --env-file=.env.local');
  process.exit(1);
}

const V = 'v25.0';
const proof = createHmac('sha256', APP_SECRET).update(TOKEN).digest('hex');

async function graph(path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({ access_token: TOKEN!, appsecret_proof: proof, ...params });
  const res = await fetch(`https://graph.facebook.com/${V}/${path}?${qs}`);
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(body.error ?? body)}`);
  return body;
}

async function main() {
  // 1. Debug the token via the app token (app_id|app_secret) — shows type,
  //    validity, expiry, and granted scopes without exposing the token itself.
  const dbgQs = new URLSearchParams({ input_token: TOKEN!, access_token: `${APP_ID}|${APP_SECRET}` });
  const dbgRes = await fetch(`https://graph.facebook.com/${V}/debug_token?${dbgQs}`);
  const dbg = (await dbgRes.json()).data;
  if (!dbg) throw new Error('debug_token returned no data');
  const fmtTs = (t: number | undefined) =>
    !t ? 'never (long-lived/system)' : new Date(t * 1000).toISOString();
  console.log('── Token ─────────────────────────────');
  console.log(`  valid:       ${dbg.is_valid}`);
  console.log(`  type:        ${dbg.type}`);
  console.log(`  app:         ${dbg.application} (${dbg.app_id})`);
  console.log(`  expires:     ${fmtTs(dbg.expires_at)}`);
  console.log(`  data access: ${fmtTs(dbg.data_access_expires_at)}`);
  console.log(`  scopes:      ${(dbg.scopes ?? []).join(', ') || '(none reported)'}`);
  if (!dbg.is_valid) { console.error('Token is INVALID — regenerate it.'); process.exit(1); }

  // 2. Who the token acts as.
  const me = await graph('me', { fields: 'id,name' });
  console.log(`\n── Acts as ───────────────────────────\n  ${me.name} (${me.id})`);

  // 3. Ad accounts visible to the token.
  const accts = await graph('me/adaccounts', {
    fields: 'id,name,account_status,currency,amount_spent,business_name',
    limit: '25',
  });
  console.log('\n── Ad accounts ───────────────────────');
  const rows = accts.data ?? [];
  if (rows.length === 0) console.log('  (none visible — check the token user has ad-account access)');
  for (const a of rows) {
    // account_status 1 = ACTIVE
    console.log(`  ${a.id}  "${a.name}"  status=${a.account_status}  currency=${a.currency}  spent=${a.amount_spent}${a.business_name ? `  biz=${a.business_name}` : ''}`);
  }
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
