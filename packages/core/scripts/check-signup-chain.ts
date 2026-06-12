#!/usr/bin/env tsx
/**
 * scripts/check-signup-chain.ts
 *
 * Fast-feedback CI gate that calls public.audit_signup_chain_triggers()
 * and exits non-zero if any non-SECURITY-DEFINER INSERT trigger has
 * landed on a watched table (profiles, message_threads, message_thread_participants).
 *
 * This is the BELT to the SUSPENDERS of the DB event trigger added in
 * migration 062. The event trigger refuses the bad CREATE TRIGGER /
 * ALTER FUNCTION at DDL time — so a broken migration can never reach
 * prod via the supabase CLI. This script catches the same violations
 * faster (before someone even tries to migrate) by running on push.
 *
 * Required env:
 *   NEXT_PUBLIC_SUPABASE_URL       — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY      — service-role JWT (NOT anon)
 *
 * Exit codes:
 *   0  — no violations
 *   1  — one or more violations (printed with fix hints)
 *   2  — env / connection error (treat as warning in CI, not pass)
 */

import { createClient } from '@supabase/supabase-js';

type Violation = {
  table_name: string;
  trigger_name: string;
  function_name: string;
  fix_hint: string;
};

async function main(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('[check-signup-chain] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    console.error('[check-signup-chain] Set both before running. In Vercel/CI these are usually wired automatically.');
    return 2;
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.rpc('audit_signup_chain_triggers');

  if (error) {
    console.error('[check-signup-chain] RPC failed:', error.message);
    // If the function itself doesn't exist yet (migrations haven't run),
    // we exit 2 (warn) rather than 1 (fail) — the deploy will run migrations
    // and a follow-up run of this script will catch real violations.
    if (/function .* does not exist/i.test(error.message)) {
      console.error('[check-signup-chain] audit_signup_chain_triggers() not found — apply migrations 061 + 062.');
      return 2;
    }
    return 2;
  }

  const violations = (data ?? []) as Violation[];

  if (violations.length === 0) {
    console.log('[check-signup-chain] ✓ All signup-chain INSERT triggers are SECURITY DEFINER. Signup is safe.');
    return 0;
  }

  console.error('[check-signup-chain] ✗ Signup-chain audit found violations:\n');
  for (const v of violations) {
    console.error(`  • ${v.trigger_name} on ${v.table_name}`);
    console.error(`      function: public.${v.function_name}`);
    console.error(`      fix:      ${v.fix_hint}\n`);
  }
  console.error('Fix: edit the trigger function to use SECURITY DEFINER + SET search_path = public, pg_temp.');
  console.error('See migration 061 (trg_profiles_create_sweet_dreams_thread) for the template.');
  return 1;
}

main().then((code) => process.exit(code));
