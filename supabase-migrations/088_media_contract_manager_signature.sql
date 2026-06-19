-- 088_media_contract_manager_signature.sql
-- Dual-signature for media project contracts: the media manager signs (on send),
-- the artist signs (on accept). The artist side already exists
-- (contract_agreed_at / contract_agreed_by); this adds the manager side.
-- Additive + safe.

ALTER TABLE media_bookings
  ADD COLUMN IF NOT EXISTS manager_agreed_at timestamptz,
  ADD COLUMN IF NOT EXISTS manager_agreed_by uuid REFERENCES auth.users(id);
