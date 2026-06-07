-- 073_beat_reward_types.sql
-- The beat-spend reward ladder introduces two license-scoped discount reward
-- types. The pre-existing reward_rules_reward_type_check CHECK didn't permit them,
-- so seeding the new rules (seedRewardRules) would fail. Widen it (superset — every
-- existing row still satisfies it). No counter CHECK exists, so 'beat_spend' is
-- already allowed; reward_grants has no reward_type CHECK, so issued grants are fine.
ALTER TABLE reward_rules DROP CONSTRAINT reward_rules_reward_type_check;
ALTER TABLE reward_rules ADD CONSTRAINT reward_rules_reward_type_check
  CHECK (reward_type = ANY (ARRAY[
    'free_hours','free_short_video','free_music_video','free_photo_session',
    'free_cutdowns','bundled_cutdowns','mv_discount_pct','spend_discount_pct',
    'referral_discount_pct','account_credit_cents','cash_bonus','cash_per_hour',
    'beat_lease_discount_pct','beat_exclusive_discount_pct',
    'status','perk'
  ]));
