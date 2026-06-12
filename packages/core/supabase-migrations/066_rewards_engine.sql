-- Migration 066: rewards engine — reward_rules + reward_grants.
--
-- The rewards layer turns real activity (studio hours, dollars spent, leases
-- sold, sessions run, jobs delivered) into real value (free work, discounts,
-- staff cash bonuses). It sits ON TOP of the existing XP/achievements engine
-- (which stays cosmetic — never grants money). Design: see
-- docs/superpowers/specs/2026-06-05-rewards-achievements-roadmap.md.
--
-- Two tables:
--   reward_rules   — the configurable ladder (thresholds → rewards), as DATA so
--                    admins tune every number without code changes. Seeded from
--                    the canonical TS ruleset in lib/rewards.ts (seedRewardRules)
--                    to keep one source of truth — this migration only creates
--                    the shape, it does not hardcode the numbers.
--   reward_grants  — what a specific owner (user or band) has earned, deduped by
--                    (rule, owner, period_key) so a window can't double-grant.
--
-- studio_id is carried but nullable: today everything is the single Sweet Dreams
-- studio (NULL = default). It exists so the white-label/multi-studio platform
-- (each studio its own numbers + approver) drops in later without a reshape.
--
-- NOTE: counters are measured within each rule's WINDOW (calendar_year / monthly
-- / quarterly / per_purchase / one_time), all calendar-aligned (Jan 1–Dec 31).
-- Bonuses are ONE total (highest tier) for one_total rules; ladders that grant
-- each rung use stack_mode='cumulative'.

-- ───────────────────────── reward_rules ─────────────────────────
CREATE TABLE IF NOT EXISTS public.reward_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Multi-studio scoping (forward-looking). NULL = current/default studio.
  studio_id UUID,

  -- Who the rule is for.
  track TEXT NOT NULL CHECK (track IN (
    'customer','band','engineer','producer','media_manager'
  )),

  -- Stable identifier (e.g. 'cust_studio_hours_10') — lets the seeder upsert.
  rule_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,

  -- The real-activity counter this rule watches.
  counter TEXT NOT NULL,

  -- Milestone value (hours, cents, or count, depending on counter).
  threshold NUMERIC NOT NULL DEFAULT 0,

  -- Earning window — the period the counter is measured over.
  -- (Named window_kind because `window` is a reserved word in Postgres.)
  window_kind TEXT NOT NULL CHECK (window_kind IN (
    'calendar_year','monthly','quarterly','per_purchase','per_event','one_time','lifetime'
  )),

  -- The reward itself.
  reward_type TEXT NOT NULL CHECK (reward_type IN (
    'free_hours','free_short_video','free_music_video','free_photo_session',
    'free_cutdowns','bundled_cutdowns','mv_discount_pct','spend_discount_pct',
    'referral_discount_pct','account_credit_cents','cash_bonus','cash_per_hour',
    'status','perk'
  )),
  reward_value NUMERIC NOT NULL DEFAULT 0,   -- hours / percent / cents / count / cents-per-hour
  reward_cap_cents INTEGER,                  -- e.g. free music video "up to $1k" = 100000

  -- How it's handed out + how tiers combine.
  issuance TEXT NOT NULL DEFAULT 'approval' CHECK (issuance IN ('auto','approval')),
  stack_mode TEXT NOT NULL DEFAULT 'one_total' CHECK (stack_mode IN ('one_total','cumulative')),

  -- Redemption expiry for granted free work (days). NULL = never (e.g. status/discount tiers).
  expires_days INTEGER,

  -- Optional per-rule start date — this rule only counts activity on/after it
  -- (overrides the global reward_settings.rewards_launch_date). Used to launch
  -- pieces on different dates, e.g. engineer monthly in June but the quarterly
  -- $1/hr kicker not until Jul 1. NULL = fall back to the global launch date.
  effective_from DATE,

  visible BOOLEAN NOT NULL DEFAULT TRUE,      -- all rewards visible by default (Cole)
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reward_rules_track_idx ON public.reward_rules(track) WHERE active;
CREATE INDEX IF NOT EXISTS reward_rules_counter_idx ON public.reward_rules(counter) WHERE active;
CREATE INDEX IF NOT EXISTS reward_rules_studio_idx ON public.reward_rules(studio_id);

-- ───────────────────────── reward_grants ─────────────────────────
CREATE TABLE IF NOT EXISTS public.reward_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID,

  rule_id UUID NOT NULL REFERENCES public.reward_rules(id) ON DELETE CASCADE,
  rule_key TEXT NOT NULL,                     -- snapshot (rule may later change)

  -- Owner: a user OR a band (XOR for customer/band tracks; staff = user).
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_band_id UUID REFERENCES public.bands(id) ON DELETE CASCADE,

  track TEXT NOT NULL,
  counter TEXT NOT NULL,

  -- 'baseline' = a tier the owner had ALREADY reached at launch (e.g. via the old
  -- "book 3hrs → free short" deal). Recorded so the dedup never re-grants it, but
  -- it is NOT issued and NOT pending — progress is kept without giving past rewards.
  status TEXT NOT NULL DEFAULT 'earned' CHECK (status IN (
    'earned','pending_approval','approved','issued','redeemed','expired','denied','revoked','baseline'
  )),

  -- The window instance this grant belongs to: '2026', '2026-Q2', '2026-07',
  -- 'lifetime', or a purchase/event id. Dedupes one grant per rule/owner/period.
  period_key TEXT NOT NULL,

  threshold NUMERIC,                          -- snapshot of the tier reached
  counter_value NUMERIC,                      -- snapshot of the counter at grant time

  reward_type TEXT NOT NULL,
  reward_value NUMERIC NOT NULL DEFAULT 0,
  value_cents INTEGER,                        -- monetary cost/value for accounting

  issuance TEXT NOT NULL DEFAULT 'approval',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ,
  issued_ref TEXT,                            -- id of the studio_credits/media_credits/payout issued
  redeemed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT reward_grants_owner_present CHECK (
    owner_user_id IS NOT NULL OR owner_band_id IS NOT NULL
  )
);

-- Idempotency: at most ONE grant per (rule, owner, period). COALESCE the nullable
-- owner columns to a sentinel so the unique index treats "no band" rows uniformly.
CREATE UNIQUE INDEX IF NOT EXISTS reward_grants_dedup_idx ON public.reward_grants (
  rule_id,
  COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(owner_band_id, '00000000-0000-0000-0000-000000000000'::uuid),
  period_key
);
CREATE INDEX IF NOT EXISTS reward_grants_user_idx ON public.reward_grants(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reward_grants_band_idx ON public.reward_grants(owner_band_id) WHERE owner_band_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reward_grants_status_idx ON public.reward_grants(status);
CREATE INDEX IF NOT EXISTS reward_grants_pending_idx ON public.reward_grants(status) WHERE status = 'pending_approval';

-- Reuse the shared updated_at trigger fn (migration 039).
DROP TRIGGER IF EXISTS reward_rules_updated_at ON public.reward_rules;
CREATE TRIGGER reward_rules_updated_at BEFORE UPDATE ON public.reward_rules
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
DROP TRIGGER IF EXISTS reward_grants_updated_at ON public.reward_grants;
CREATE TRIGGER reward_grants_updated_at BEFORE UPDATE ON public.reward_grants
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ───────────────────────── RLS ─────────────────────────
-- Rules: any authenticated user may READ the ladder (the UI shows progress to
-- every reward). Writes go through the service role (admin rules editor).
ALTER TABLE public.reward_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reward_rules_read ON public.reward_rules;
CREATE POLICY reward_rules_read ON public.reward_rules
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Grants: an owner reads their own (or their band's) grants; writes via service role.
ALTER TABLE public.reward_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reward_grants_owner_read ON public.reward_grants;
CREATE POLICY reward_grants_owner_read ON public.reward_grants
  FOR SELECT USING (
    owner_user_id = auth.uid()
    OR (owner_band_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM band_members
      WHERE band_members.band_id = reward_grants.owner_band_id
        AND band_members.user_id = auth.uid()
    ))
  );

-- ───────────────────────── reward_settings ─────────────────────────
-- Per-studio rewards config (one row per studio; NULL studio_id = default).
-- rewards_launch_date clamps STAFF counters so engineer/producer/media bonuses
-- begin at launch (NO back-pay); the customer/band BACKFILL ignores it (customers
-- look backward). `active` is the master on/off for the whole rewards system.
CREATE TABLE IF NOT EXISTS public.reward_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID,
  rewards_launch_date DATE,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS reward_settings_studio_idx
  ON public.reward_settings (COALESCE(studio_id, '00000000-0000-0000-0000-000000000000'::uuid));

DROP TRIGGER IF EXISTS reward_settings_updated_at ON public.reward_settings;
CREATE TRIGGER reward_settings_updated_at BEFORE UPDATE ON public.reward_settings
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE public.reward_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reward_settings_read ON public.reward_settings;
CREATE POLICY reward_settings_read ON public.reward_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE public.reward_settings IS
  'Per-studio rewards config: rewards_launch_date (staff counters begin here, no back-pay) + active master switch. Migration 066.';

COMMENT ON TABLE public.reward_rules IS
  'Configurable reward ladder (thresholds -> rewards) as data; seeded from lib/rewards.ts. Admin-editable so numbers change without code. studio_id nullable for future multi-studio. Migration 066.';
COMMENT ON TABLE public.reward_grants IS
  'What an owner (user/band) earned from a reward_rule, deduped by (rule,owner,period_key). Auto rules issue; approval rules wait in pending_approval for the studio admin. Migration 066.';
