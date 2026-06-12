-- 054_packages.sql
--
-- Round A of the packages & memberships system.
--
-- Foundation only. Six new tables, three new optional columns on existing
-- transactional tables, no behavior changes anywhere. Nothing references
-- these tables yet, so this migration is fully reversible by dropping the
-- new tables and columns. No data migration. No RLS policies that grant
-- read access — only the service role touches these tables until a future
-- round explicitly adds end-user policies.
--
-- Design decisions (locked in by Cole):
--   • Pricing baseline: Studio B rate. All package valuations use B even
--     when the redeemed session ends up in Studio A — the customer pays
--     the difference at booking time.
--   • Surcharges (Studio A diff, Sweet 4 upgrade, same-day, late/deep
--     night, future weekend): NEVER covered by the entitlement; always
--     paid at booking. Modeled as a calculation at redemption time, not
--     stored on the package.
--   • Memberships: 3-month fixed term, no auto-renew, no cancel, no
--     refund. Stripe Subscription with `iterations: 3`.
--   • Failed mid-term payment: entitlement stays usable; payment_status
--     flag tracks dunning state separately from entitlement status.
--   • Add-ons: 60-day window from issuance, independent of parent term,
--     unless admin chose Membership Extension shape.
--   • Band entitlements: separate audience class, own templates.

-- ────────────────────────────────────────────────────────────────────
-- Templates: the menu admins build packages from
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.package_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT UNIQUE,                    -- url-friendly id; nullable until admin sets it

  -- Audience: solo (single user) vs band (any band member can redeem).
  -- Catalog filters by this so band-only templates never show on solo views.
  audience TEXT NOT NULL CHECK (audience IN ('solo', 'band')),

  -- Shape: one-off (paid once, valid for `duration_days`) vs membership
  -- (monthly billing, fixed 3-month term, locked-in contract).
  is_membership BOOLEAN NOT NULL DEFAULT false,

  -- For one-off: the validity window in days (e.g. 60, 90).
  -- For membership: total term length, derived from membership_months.
  duration_days INTEGER,

  -- Membership-only: number of monthly billing iterations. Always 3 in
  -- the v1 spec (Cole's rule), but kept configurable in case 6-month
  -- terms are introduced later.
  membership_months INTEGER,

  -- Pricing — interpretation depends on is_membership.
  -- One-off: total price the customer pays once.
  -- Membership: price per month (so total contract = price_cents * months).
  price_cents INTEGER NOT NULL,

  -- Admin can disable a template without deleting it. Existing entitlements
  -- referencing it stay valid; new quotes can't be issued from it.
  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,

  -- Sanity check: membership templates need a month count.
  CONSTRAINT membership_has_months CHECK (
    (is_membership = false) OR (membership_months IS NOT NULL AND membership_months > 0)
  ),
  -- Sanity check: one-off templates need a duration.
  CONSTRAINT oneoff_has_duration CHECK (
    (is_membership = true) OR (duration_days IS NOT NULL AND duration_days > 0)
  )
);

CREATE INDEX IF NOT EXISTS package_templates_active_idx
  ON public.package_templates (is_active, audience);

-- ────────────────────────────────────────────────────────────────────
-- Template lines: what's IN the basket
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.package_template_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.package_templates(id) ON DELETE CASCADE,

  -- What kind of credit this line grants:
  --   studio_hours: hours bookable from the Artist Hub at Studio B rate
  --   media_offering: a specific media offering (music video, photo, etc.)
  --   beat_credit: a single beat license claim
  --   custom: free-form description for things outside the standard catalog
  kind TEXT NOT NULL CHECK (kind IN ('studio_hours', 'media_offering', 'beat_credit', 'custom')),

  -- For studio_hours: total hours included.
  -- For media_offering: count (usually 1).
  -- For beat_credit: number of beats claimable.
  -- For custom: count of whatever the admin described.
  quantity INTEGER NOT NULL CHECK (quantity > 0),

  -- For media_offering kind only — links to the specific offering.
  media_offering_id UUID REFERENCES public.media_offerings(id) ON DELETE SET NULL,

  -- Full-price retail valuation in cents (per-unit × quantity).
  -- For studio_hours: 12 hours × $50 (Studio B rate) = 60000
  -- For media_offering: pulled from media_offerings.price_cents
  -- For beat_credit: typical license tier price × quantity
  full_price_cents INTEGER NOT NULL CHECK (full_price_cents >= 0),

  -- The proportional dollar value this line contributes to the package
  -- price. Sum of all template_lines.package_value_cents = package
  -- selling price. Used for partial-redemption math (e.g. "what's left
  -- in the basket?") and for discount loss accounting.
  package_value_cents INTEGER NOT NULL CHECK (package_value_cents >= 0),

  -- Free-form description for `custom` kind, or to clarify a standard kind.
  notes TEXT,

  -- Display order in catalog and on quotes.
  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_template_lines_template_idx
  ON public.package_template_lines (template_id, sort_order);

-- ────────────────────────────────────────────────────────────────────
-- Quotes: a template proposed to a specific customer
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.package_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.package_templates(id) ON DELETE RESTRICT,

  -- Recipient: solo audience uses user_id, band audience uses band_id.
  -- Exactly one must be set; CHECK enforces.
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  band_id UUID REFERENCES public.bands(id) ON DELETE CASCADE,

  -- Token used in /quotes/:token URL so customers can view + accept
  -- without needing to be logged in (similar to band invites + event
  -- RSVPs). 256 bits of entropy — generated client-side at insert.
  token TEXT NOT NULL UNIQUE,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),

  -- The pricing snapshot at quote time. Frozen here so subsequent
  -- template edits don't retroactively change what was offered.
  total_price_cents INTEGER NOT NULL CHECK (total_price_cents >= 0),
  total_full_price_cents INTEGER NOT NULL CHECK (total_full_price_cents >= 0),
  total_discount_cents INTEGER NOT NULL CHECK (total_discount_cents >= 0),

  -- For per-customer adjustments (admin tweaked qty/price for this
  -- quote vs the template). Shape:
  --   { lines: [{ template_line_id, quantity?, package_value_cents? }] }
  custom_adjustments JSONB,

  -- Internal admin-only notes (not shown to the customer).
  admin_notes TEXT,
  -- Public message shown to the customer in the quote view + email.
  customer_message TEXT,

  -- Lifecycle timestamps. expires_at typically created_at + 14 days; the
  -- expiry cron flips status='expired' when this passes.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Stripe IDs populated when payment is initiated.
  stripe_checkout_session_id TEXT,           -- one-off
  stripe_subscription_id TEXT,               -- membership
  stripe_payment_link_url TEXT,              -- the URL we email

  CONSTRAINT exactly_one_recipient CHECK (
    (user_id IS NOT NULL AND band_id IS NULL)
    OR (user_id IS NULL AND band_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS package_quotes_user_idx
  ON public.package_quotes (user_id, status);
CREATE INDEX IF NOT EXISTS package_quotes_band_idx
  ON public.package_quotes (band_id, status);
CREATE INDEX IF NOT EXISTS package_quotes_status_idx
  ON public.package_quotes (status, expires_at);

-- ────────────────────────────────────────────────────────────────────
-- Entitlements: an accepted quote becomes a "wallet"
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.package_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.package_quotes(id) ON DELETE RESTRICT,
  template_id UUID NOT NULL REFERENCES public.package_templates(id) ON DELETE RESTRICT,

  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  band_id UUID REFERENCES public.bands(id) ON DELETE CASCADE,

  -- Entitlement status — usability:
  --   active: redeemable
  --   exhausted: all balances at zero, but term not yet over
  --   expired: term ended (with or without unredeemed pieces)
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'exhausted', 'expired')),

  -- Payment status — separate axis from `status`. Tracks whether the
  -- customer is current on their bills. For one-off packages this stays
  -- 'current' forever (single charge). For memberships, it can transition
  -- to 'past_due' if a monthly Stripe charge fails, then 'collections'
  -- (admin escalation), then 'written_off' (give up).
  payment_status TEXT NOT NULL DEFAULT 'current'
    CHECK (payment_status IN ('current', 'past_due', 'collections', 'written_off')),

  -- Validity window. ends_at is the cutoff; the daily expiry cron flips
  -- status='expired' for any active row past ends_at.
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,

  -- For memberships: tracks Stripe subscription state.
  stripe_subscription_id TEXT,
  stripe_subscription_iterations INTEGER,    -- 3 for v1 memberships
  current_period_end TIMESTAMPTZ,            -- updated from invoice.paid webhooks
  last_payment_failed_at TIMESTAMPTZ,        -- set when invoice.payment_failed fires

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT exactly_one_owner CHECK (
    (user_id IS NOT NULL AND band_id IS NULL)
    OR (user_id IS NULL AND band_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS package_entitlements_user_idx
  ON public.package_entitlements (user_id, status);
CREATE INDEX IF NOT EXISTS package_entitlements_band_idx
  ON public.package_entitlements (band_id, status);
CREATE INDEX IF NOT EXISTS package_entitlements_expiry_idx
  ON public.package_entitlements (ends_at) WHERE status = 'active';

-- ────────────────────────────────────────────────────────────────────
-- Per-line balances: the redeemable wallet inside each entitlement
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.package_entitlement_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id UUID NOT NULL REFERENCES public.package_entitlements(id) ON DELETE CASCADE,

  -- The template line this balance was minted from. Null after a template
  -- line is deleted (entitlement was already created so we keep the row).
  template_line_id UUID REFERENCES public.package_template_lines(id) ON DELETE SET NULL,

  -- Snapshot of the line at acceptance time so subsequent edits don't
  -- change what was granted to this customer.
  kind TEXT NOT NULL CHECK (kind IN ('studio_hours', 'media_offering', 'beat_credit', 'custom')),
  media_offering_id UUID REFERENCES public.media_offerings(id) ON DELETE SET NULL,
  full_price_cents INTEGER NOT NULL CHECK (full_price_cents >= 0),
  package_value_cents INTEGER NOT NULL CHECK (package_value_cents >= 0),
  notes TEXT,

  -- The wallet itself.
  quantity_granted INTEGER NOT NULL CHECK (quantity_granted >= 0),
  quantity_redeemed INTEGER NOT NULL DEFAULT 0
    CHECK (quantity_redeemed >= 0 AND quantity_redeemed <= quantity_granted),

  -- Append-only redemption log. Each entry: { booking_id, quantity, redeemed_at }.
  -- Lets us reconstruct redemption history without joining 3 tables.
  redemptions JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_balances_entitlement_idx
  ON public.package_entitlement_balances (entitlement_id);
CREATE INDEX IF NOT EXISTS package_balances_kind_idx
  ON public.package_entitlement_balances (entitlement_id, kind);

-- ────────────────────────────────────────────────────────────────────
-- Add-on requests: customer-initiated "I want more" inside the portal
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.package_addon_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id UUID NOT NULL REFERENCES public.package_entitlements(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What the customer is asking for.
  request_type TEXT NOT NULL CHECK (
    request_type IN ('studio_hours', 'media_offering', 'beat_credit', 'custom')
  ),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  -- Optional reference (for media kind: which offering they want).
  media_offering_id UUID REFERENCES public.media_offerings(id) ON DELETE SET NULL,
  -- Customer's free-text explanation.
  notes TEXT,

  -- Lifecycle:
  --   pending: sitting in admin's inbox
  --   quoted: admin generated a quote in response (links via response_quote_id)
  --   accepted: customer accepted the response quote (entitlement updated)
  --   declined: admin declined to fulfill, OR customer declined the quote
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'quoted', 'accepted', 'declined')),

  response_quote_id UUID REFERENCES public.package_quotes(id) ON DELETE SET NULL,
  admin_response_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS addon_requests_entitlement_idx
  ON public.package_addon_requests (entitlement_id, status);
CREATE INDEX IF NOT EXISTS addon_requests_status_idx
  ON public.package_addon_requests (status, created_at);

-- ────────────────────────────────────────────────────────────────────
-- Optional FK columns on existing transactional tables
-- ────────────────────────────────────────────────────────────────────
-- Each is NULLABLE with no default. Existing INSERTs continue to write
-- NULL silently; only the future redemption code paths will set these.
-- Setting them to NOT NULL or DEFAULT ANYTHING would risk breaking live
-- writes — explicitly avoiding that.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS package_entitlement_id UUID
    REFERENCES public.package_entitlements(id) ON DELETE SET NULL;

ALTER TABLE public.media_bookings
  ADD COLUMN IF NOT EXISTS package_entitlement_id UUID
    REFERENCES public.package_entitlements(id) ON DELETE SET NULL;

ALTER TABLE public.beat_purchases
  ADD COLUMN IF NOT EXISTS package_entitlement_id UUID
    REFERENCES public.package_entitlements(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bookings_entitlement_idx
  ON public.bookings (package_entitlement_id) WHERE package_entitlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_bookings_entitlement_idx
  ON public.media_bookings (package_entitlement_id) WHERE package_entitlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS beat_purchases_entitlement_idx
  ON public.beat_purchases (package_entitlement_id) WHERE package_entitlement_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- RLS: enable on every new table, no policies yet, REVOKE for safety
-- ────────────────────────────────────────────────────────────────────
-- Until a future round writes explicit policies for end-user reads,
-- only the service role touches these tables. anon and authenticated
-- roles get nothing. This is the same pattern we used for
-- password_reset_tokens — fail closed by default.
ALTER TABLE public.package_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_template_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_entitlement_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_addon_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.package_templates FROM anon, authenticated;
REVOKE ALL ON public.package_template_lines FROM anon, authenticated;
REVOKE ALL ON public.package_quotes FROM anon, authenticated;
REVOKE ALL ON public.package_entitlements FROM anon, authenticated;
REVOKE ALL ON public.package_entitlement_balances FROM anon, authenticated;
REVOKE ALL ON public.package_addon_requests FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- updated_at triggers — match existing pattern from earlier migrations
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at_packages()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER package_templates_updated_at
  BEFORE UPDATE ON public.package_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_packages();

CREATE TRIGGER package_entitlements_updated_at
  BEFORE UPDATE ON public.package_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_packages();

CREATE TRIGGER package_balances_updated_at
  BEFORE UPDATE ON public.package_entitlement_balances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_packages();
