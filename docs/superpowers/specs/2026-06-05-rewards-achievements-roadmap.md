# Rewards, Milestones & Achievements Roadmap

**Date:** 2026-06-05
**Status:** Design / roadmap (no code yet — numbers locking in, then build)
**Owner:** Cole

---

## 0. TL;DR

We already have a **wired XP + achievements engine** (levels 1–100, 49 auto-unlocking
achievements). What this roadmap adds is the **reward layer** that turns real activity into
real value, plus **media** and **media-manager** coverage.

**Core principles (locked):**
- Tangible rewards come from **real-activity counters** (hours, dollars, sales), **not XP**.
- Every reward is measured **inside a time window** (customer = per year; engineer = monthly
  + quarterly; producer/media = per year). Windows reset and rewards recur.
- **All rewards are visible** as progress on the user's account.
- **Staff bonuses are flat cash**, sized as a slice of **the studio's cut** of that work, to
  incentivize doing the work faster.

### Two clocks per reward
- **Earning window** — the period the counter is measured over (resets/rolls; repeatable).
- **Redemption expiry** — once a free reward is *granted*, you have **90 days** to use it.

### What changed in this pass (Cole, 2026-06-05)
- **Mix & masters are just hourly studio sessions** — not a separate deliverable counter.
- **No media milestone counters** (videos/photos get mixed & matched, so per-deliverable
  milestones don't work). Instead: **cutdowns come bundled with a music video, scaled by its
  price**; everything else media just feeds the **dollars-spent** loyalty track.
- **Releases dropped as a reward.** Separately: **public profiles should show released vs
  unreleased projects** (identity feature, §5 — not a reward).
- **Staff cash model = flat dollars** (resolved — no % needed).
- **Engineer monthly bonuses don't stack** — one total (the highest tier hit) per month —
  **plus** a separate quarterly $1/hour kicker on top.
- **No cumulative bonuses anywhere** — every bonus is the **total** they'd be paid (the value
  of the highest milestone reached in the window), never a sum of tiers.
- **All windows are the calendar year** — Jan 1 → Dec 31, the same for everyone; monthly and
  quarterly are calendar-aligned too.
- **Payout timing varies per reward** — some immediate, some monthly, **most at year-end**
  (per-reward setting).
- **Bonuses come out of the studio's revenue share and are paid ON TOP of base comp**, keyed
  by `user_id` in payroll (§11).
- **Referrals = referral codes.** **Reviews (Google/Apple) = honor + manual verification** —
  no clean API proves a specific user reviewed (§13).
- **Discount cost allocation:** studio-session discounts/comps → the **studio absorbs**
  (engineer paid full); media **% discounts → proportional** (team + studio both earn less on
  the smaller gross); media **comps → rewards/marketing budget** pays the team full (§11).
- **Per-studio:** approvals + counters are **scoped to a studio**; the admin of *that* studio
  approves rewards onto a user's balance. Current Sweet Dreams studio **backfills** history;
  new studios that join later **start from scratch**.
- **Bands get their own ladder** (§2E) — they spend more, so higher thresholds + bigger rewards.
- **Every number is admin-editable config, not hardcoded** — thresholds, rewards, bonuses, AND
  studio pricing live in data so a studio admin tunes them on their own, no code changes. The
  rule engine reads it all from `reward_rules`; an **Admin → Rewards Rules editor** is part of
  the build.
- **Scope: solo Sweet Dreams Music now.** The white-label / multi-studio platform (admins
  controlling their own numbers + pricing site-wide) is a **separate branch for later** — we
  build studio-aware but single-tenant for now.

---

## 1. Counters (the source of truth)

Measured **within each reward's window**. Most already computed in
`app/api/hub/achievements/check/route.ts`; we add a window filter. New = **[NEW]**.

| Counter | For | Source | Window |
|---|---|---|---|
| `studio_hours` | customer | sum of `duration` over the user's completed `bookings` (HOURS, attended/paid) **[NEW]** | per year |
| `dollars_spent` | customer | what the user paid: studio + media + beats **[NEW]** | calendar year |
| `music_video_spend` | customer | $ spent on a given music video (drives bundled cutdowns) **[NEW]** | per purchase |
| `hours_run` | engineer | sum of `duration` over completed `bookings` where `engineer_name` == them (HOURS) **[NEW]** | month + quarter |
| `engineer_review_invites` | engineer | reviews left via that engineer's invite **[NEW]** | per review |
| `producer_revenue` | producer | gross $ of their beat sales (studio keeps 40%) | per year |
| `media_revenue` | media mgr | gross $ of the jobs they delivered (studio keeps 35%) **[NEW]** | per year |
| `referrals_converted` | customer | referred user completes a paid session **[NEW]** | per referral |

---

## 2. Customer rewards

`A` = auto · `✋` = Cole approves. **All visible** as progress.

### A. Studio loyalty — `studio_hours` · **per year**
| Hours (this year) | Reward | Issue |
|---|---|---|
| 5 | Free short-form video | ✋ |
| 10 | Free studio hour | ✋ |
| 20 | Discounted music video (25% off) | ✋ |
| 35 | 2 free studio hours | ✋ |
| 50 | Free short video **+** free studio hour | ✋ |
| 75 | Music video 40% off | ✋ |
| 100 | Free music video (up to $1k value) **or** 5 free studio hours | ✋ |

### B. Spend loyalty — `dollars_spent` · **per calendar year** (status for the rest of the year)
| Spent this year | Discount for rest of year | Issue |
|---|---|---|
| $1,000 | 2% off | A |
| $2,000 | 5% off | A |
| $5,000 | 10% off | A |
| $10,000 | 15% off | A |
| $20,000 | 20% off | A |

### C. Music-video cutdowns — **bundled with the purchase** (not a milestone)
**1 free cutdown per $250 of music-video spend** — the editor produces them with the video.
| Music video price | Free cutdowns | Issue |
|---|---|---|
| $500 | 2 | A |
| $1,000 | 4 | A |
| $1,500 | 6 | A |
| $2,000 | 8 | A |
*(A short can't be cut down — cutdowns only come from a music video.)*

### D. Referrals & onboarding
| Trigger | Reward | Issue |
|---|---|---|
| Referred friend completes a paid session *(needs referral tracking)* | 25% off your next session | ✋ |
| New user completes their profile | 1 free studio hour *(gate to first booking to prevent farming)* | ✋ |
| Leave a review *(screenshot required)* | $20 account credit | ✋ |

---

### E. Bands — higher thresholds, bigger rewards *(proposed — tune)*
Bands spend a lot more, so they get their own ladder. Hours/spend accrue to the **band account**
(the payer), never double-counted to members; members still earn personal rewards from their own
non-band bookings. Per year.

**Band studio hours (this year)**
| Band hours | Reward | Issue |
|---|---|---|
| 20 | Free band short-form video | ✋ |
| 40 | 2 free studio hours | ✋ |
| 80 | Free band photo session **or** music video 25% off | ✋ |
| 120 | Free music video (up to $1.5k value) | ✋ |
| 160 | Free recording day (5 hrs) **+** "Resident Band" status | ✋ |

**Band spend loyalty (this year → discount rest of year)** — all `A`
$3,000 → 5% · $6,000 → 10% · $12,000 → 15% · $25,000 → 20%

**Band perks:** the standard free setup hour; cutdowns bundle on a band music video (same
$250/cut rule); priority on 3-day block bookings.

---

## 3. Staff bonuses (flat cash, from the studio's cut)

### 3.1 Engineers
**Monthly milestone — one total, does NOT stack** (hit 60 hrs → $350, not $150+$350):
| Hours in a month | Bonus |
|---|---|
| 30 | $150 |
| 60 | $350 |

**Quarterly kicker — on top of the monthly bonuses:** **$1 per hour** worked that quarter,
no milestone needed (100 hrs in the quarter → +$100, automatic).

**Review invites:** $5 per review left via the engineer's invite.

*(No annual engineer bonus — just the monthly milestone + the quarterly $1/hr kicker.)*

### 3.2 Producers — **per year**, ONE total (studio keeps 40%)
Counter = their gross beat-sale revenue for the year. Bonus = the value of the **highest tier
reached**, not a sum (e.g. $10k of sales = **$750 total**, not $1,385).
| Revenue (year) | Total bonus |
|---|---|
| $500 | $35 |
| $1,000 | $75 |
| $2,500 | $175 |
| $5,000 | $350 |
| $10,000 | $750 |

### 3.3 Media managers (filmers/editors) — **per year**, ONE total (studio keeps 35%)
Lower per-tier than producers but reaches higher revenue. Counter = gross job revenue they
delivered for the year. Bonus = the **highest tier reached** ($20k delivered = **$1,800
total**, not summed).
| Revenue (year) | Total bonus |
|---|---|
| $500 | $30 |
| $1,000 | $70 |
| $2,500 | $150 |
| $5,000 | $300 |
| $10,000 | $700 |
| $20,000 | $1,800 |

### 3.4 Multi-hat
Counters live on the account, namespaced by activity — one person who engineers, produces,
and is also an artist accrues all the relevant tracks at once.

---

## 4. Economics check (bonus as % of the studio's cut)

Bonuses are **one total** (highest tier reached) and come **out of the studio's cut**, on top
of base comp. The payout stays a consistent slice of margin:

| Track | At revenue | Studio cut | Total bonus | Bonus = % of cut |
|---|---|---|---|---|
| Producer (40%) | $5,000 | $2,000 | $350 | 18% |
| Producer (40%) | $10,000 | $4,000 | $750 | 19% |
| Media (35%) | $10,000 | $3,500 | $700 | 20% |
| Media (35%) | $20,000 | $7,000 | $1,800 | 26% |

→ Consistent **~18–26% of the studio's cut**. The studio always nets the larger share after
the bonus.

---

## 5. Media ↔ development + public profiles

- **Link a shoot/session to a release project** (`linked_project_id`, already on
  `calendar_events`/`session_notes`, extend to `bookings` + `media_session_bookings`).
- **"Your next move" widget** recommends the next booking from the active project phase.
- **Media achievements** — add `media` + `media_manager` achievement categories.
- **Public profiles: released vs unreleased projects.** On `/u/[slug]`, clearly separate
  released work from in-progress/unreleased. (Identity feature, not a reward — but it makes
  the artist-development spine visible and gives "released" real weight.)

---

## 6. XP / levels (kept, firewalled from money)

Unchanged engine (levels 1–100, streaks, `lib/xp-system.ts`). Unlocks only non-monetary
status: level title, profile flair, leaderboard, streak cosmetics. **Never** free work/cash.

---

## 7. Badge inventory for Cole (art)

Tiers Bronze → Silver → Gold → Diamond → Platinum.
- **Customer:** Studio Hours (5/10/20/35/50/75/100) · Loyalty (2/5/10/15/20%) · Cutdown
  Bundle · Referrer · Reviewer · Welcome (profile complete).
- **Producer:** Revenue $500/$1k/$2.5k/$5k/$10k.
- **Engineer:** Monthly Hours (30/60) · Quarterly Grinder · Review Driver · Tenure.
- **Media Manager:** Revenue $500/$1k/$2.5k/$5k/$10k/$20k · Tenure.

---

## 8. Data model & build sketch

**Migrations**
- `reward_rules` — `track`, `counter`, `threshold`, `reward_type` (free_hours | free_short |
  free_music_video | mv_discount_pct | bundled_cutdowns | spend_discount_pct | referral_pct |
  credit | cash_bonus), `reward_value`, `issuance` (auto | approval), `window` (per_year |
  calendar_year | monthly | quarterly | per_purchase | per_event), `stack_mode` (one_total |
  cumulative), `expires_days`, `active`.
- `reward_grants` — `user_id`, `rule_id`, `status` (earned | pending_approval | approved |
  issued | redeemed | expired | denied), `period_key` (e.g. `2026-Q2`, `2026-07`, `2026`),
  `value_snapshot`, `counter_snapshot`, `expires_at`, `approved_by`, `audit`.
- Add `linked_project_id` to `bookings` + `media_session_bookings`; add `is_released`
  surfacing on public profiles.
- Extend `AchievementCategory` with `media` + `media_manager`.

**Logic** — `lib/rewards.ts`: the ladders above as data, windowed counter resolvers (hours
from `bookings.duration`; spend from payments; producer/media revenue), grant creation
(auto vs pending_approval; `one_total` vs `cumulative` per rule; deduped by `period_key`).
Cutdowns issue at music-video checkout (price ÷ 250).

**UI** — Customer Hub "Perks" surface (all visible, progress + window noted); staff bonus
progress on engineer/producer/media dashboards ("this month / quarter / year"); Admin →
Rewards approval queue + attention-center card.

---

## 9. Phased build plan
1. **Engine + data** — `reward_rules`, `reward_grants` (windowed, period-deduped, one_total),
   counter resolvers, **seed the Sweet Dreams numbers**, and the **go-live backfill** of current
   customers' historical hours/spend (excluding refunded + test rows). No UI yet; reversible.
2. **Admin Rules editor + approval queue** — `Admin → Rewards`: edit every threshold/reward/bonus
   as data (the control surface that makes numbers code-free), plus the pending-review approval
   queue + attention-center card.
3. **Customer rewards UI** — Hub "Perks" surface (all visible, progress + window) + cutdown
   bundling at music-video checkout + band track.
4. **Staff cash bonuses** — engineer monthly/quarterly, producer/media yearly, paid from the
   studio's cut on top of base comp + payroll wiring (keyed by `user_id`).
5. **Media coverage** — `media`/`media_manager` achievements, `linked_project_id`, "next move,"
   public-profile released vs unreleased.
6. **Growth** — referral codes + review (screenshot) tracking, both new systems.

---

## 10. Policy calls — RESOLVED (2026-06-05, round 2)
- **Refund after a reward was earned** → decrement the counter; **revoke** the reward if not yet
  redeemed; if already redeemed, **absorb + log** it (repeat abuse caught via the engineer
  anti-fraud path). [Cole: "do whatever you think is best."]
- **Free-reward work is paid from the rewards/marketing budget** (engineer/team made whole).
- **Discount allocation** (§11): studio sessions → studio absorbs; media `% off` → proportional;
  media comps → rewards budget.
- **Comped/free hours do NOT count** toward the next reward.
- **Self-as-engineer** session counts for **neither** track.
- **Referrals** — code applied **only at session signup**; no self-referral; an engineer who
  catches a duplicate account may **disband it or force payment**.
- **Free music video** caps at **$1k** value (pay the difference); **25% off a music video**
  applies to **any** price (even $2,500).
- **Bigger rewards = "pending review,"** approved by the **admin of that specific studio** before
  hitting a user's balance (§11/§12). Per-studio, not one global approver.
- **Late-year rewards** can be **redeemed the following year** (grant persists; 90-day clock).
- **Go-live** — the **current Sweet Dreams studio backfills** historical hours/spend; **new
  studios start from scratch** at 0.
- **Staff let go** → **pay out accrued/owed bonus** on exit.

**Design COMPLETE (2026-06-05):** band numbers accepted (§2E); **no annual engineer bonus**
(monthly milestone + quarterly $1/hr only). All thresholds/rewards/bonuses/prices are
**admin-editable config** (an Admin → Rewards Rules editor ships with the build) so the studio
tunes everything without code. Scope = **solo Sweet Dreams Music**; the white-label / per-studio
control platform is a separate branch for later.

---

## 11. Accounting rules (bonuses + free rewards)

- Staff bonuses are **funded from the studio's revenue share** and paid **on top of** base
  commission — never reducing the staff member's normal cut, never inflating their commission
  base. In payroll they're a **separate bonus line keyed by `user_id`** (not name — the Zion
  rename incident showed name-bucketing breaks payroll).
- Each bonus **reduces studio net margin** for its period; surface accrued vs paid bonuses in
  Accounting next to existing payouts.
- **Free customer rewards have a real cost.** A redeemed free studio hour still **pays the
  engineer** who runs it; a free music video still pays the filmer/editor. Studio-funded
  (a "rewards / marketing" cost bucket) — $0 revenue but real payout, *not* test-credit inert.
  Track them so the P&L stays honest.
- **Discount / comp cost allocation:**
  - **Studio sessions** — the **studio absorbs** it. A `% off` comes out of the studio's margin;
    a free hour is paid from the rewards/marketing budget. **The engineer is always paid full.**
  - **Media — comped/free** reward (e.g. a free music video): the **rewards/marketing budget**
    pays the team (filmer/editor) in full.
  - **Media — `% discount`** on a job they're still paying for: **proportional**. The discount
    lowers the gross, so payroll computes the **65/35 split on the discounted gross** — team and
    studio both earn a bit less ("everyone shares it").
- **Per-studio approval.** A "pending review" reward routes to the **admin of the studio** where
  it was earned (the engineer-admin of that location), who approves it onto the user's balance.
  The model carries a `studio_id`; today the current Sweet Dreams studio is the sole/default
  approver. New studios run their own counters + approvals.
- Test/comp sessions (cole@sweetdreams.us) stay **excluded** from all counters and bonuses.

---

## 12. Where progress is shown

- **Customers → Artist Hub "Perks" tab** (or folded into Achievements): each reward track with
  a progress bar ("62/100 hrs this year → free music video"), current discount tier, earned
  rewards (redeemable, with expiry), bundled cutdowns — plus a "next reward" line on the Hub
  Overview.
- **Engineers → Engineer dashboard "Bonuses" card:** this month's hours → next milestone +
  current monthly bonus, quarter-to-date $1/hr accrual, review-invite credits, year-to-date paid.
- **Media managers → Media Team dashboard:** YTD delivered revenue → next milestone + projected bonus.
- **Producers → Producer area:** YTD sales revenue → next milestone + projected bonus.
- **Admin → Rewards approval queue** (+ attention-center card) and an Accounting view of accrued vs paid.

---

## 13. Edge cases & policies to prepare for

Grouped, each with a recommended default. ⚑ = a genuine policy call for Cole.

**Refunds / cancellations / chargebacks**
- Refunded/cancelled activity → **decrement** the counter. Reward earned-but-not-redeemed on
  now-refunded activity → revoke (still pending). Already redeemed/paid → **flag for manual
  reconciliation**, don't auto-claw. ⚑ claw-back policy.
- Producer/media revenue refunded after a tier was hit → recompute the year; self-corrects
  before a year-end payout; if already paid, reconcile next year.

**Reward value & redemption**
- "Free music video up to $1k" on a $1.5k video → reward covers $1k, **customer pays the
  difference**; no cash back if cheaper.
- "Free studio hour" on a 3-hr booking → 1 hr free, 2 paid (paid hours get the better-of discount).
- "25% off a music video" → off the **canonical MV list price** (MV prices vary $500–$5k). ⚑ base.
- Granted reward **expires** unused (90 days) → warn ~14 days out, then lapse.
- Rule/values change after grant → honor the **snapshot** at grant time.
- A ✋ reward Cole **denies** after the customer saw it → show "pending review," never "earned,"
  until approved, so nothing is visibly yanked.

**Earning integrity (anti-farm)**
- **Free/comped hours don't count** toward the next reward (only paid activity moves counters). ⚑
- Customer **is also the engineer** on a session → counts for **neither** track.
- Referral: **can't refer yourself**, referee must be genuinely new, referrer paid **only after**
  the referee completes a *paid* session. Free-hour onboarding = **one per real person** (physical
  show-up self-limits multi-account abuse — your point).
- Reviews: no API proves a specific customer reviewed on Google/Apple → **manual verification**
  (they claim it / screenshot, staff confirms the public review, approves the $20). ⚑ ok?

**Window boundaries (calendar year, Jan 1–Dec 31)**
- Attribute a session to a year by **completion/session date**, not booking date.
- Reward earned Dec 30 → the **grant persists** (90-day redemption clock is separate); only the
  *counter* resets Jan 1.
- ⚑ **Go-live**: current-year activity backfills, or everyone starts at 0?

**Staff specifics**
- Session **reassigned** (Change Engineer) → hours credit the **final engineer at completion**.
- **Cash correction** lowers a session's revenue after a tier was hit → recompute.
- **Media bonus = revenue DELIVERED** (filmed/edited), kept distinct from the existing **sales
  commission** (`sold_by`) so nobody's double-paid for one job.
- Staff member **leaves mid-year** → year-end bonus prorated / paid on exit? ⚑
- All tenure & bonuses keyed by **user_id** (name changes must not reset progress).

**Identity / bands / multi-hat**
- **Band-booked hours** accrue to the **paying account only**, not every member (else 3 members
  each claim the same hours). ⚑
- Producer-who-is-also-an-artist accrues both tracks independently; ensure revenue isn't
  double-counted across tracks.

**System correctness**
- Two reward checks racing → **idempotent** grants (unique on `rule_id + period_key`, like the
  existing `xp_log` dedup).
- Live-computed vs materialized counter drift → one source of truth; recompute on read to start.

**Multi-studio & go-live (new)**
- **Per-studio approval + counters** — a reward routes to the **studio's admin**; a customer's
  hours at studio A don't fund a reward at studio B (each location runs its own economy). Model
  carries `studio_id`. New studios start at 0; the current studio **backfills** from history.
- **Backfill at launch** — one-time job computes existing customers' historical hours/spend from
  past `bookings`/payments (excluding refunded + test/comp rows) so they get credit for what
  they've already done.
- **Multi-band membership** — a member in several bands earns personal rewards from their own
  bookings; each band's hours accrue to **that band's** account only.
- **Discounted-media payroll** — a `%`-discounted media job splits 65/35 on the **discounted
  gross**; a comped media reward pays the team full from the rewards budget instead.

---

## 14. Launch model, backfill control & exposure (Cole, 2026-06-06)

The split that defines go-live: **customers look backward, staff look forward.**

- **Customers + bands BACKFILL.** Past users keep their accumulated current-year hours/spend so
  they start "set up" at their real progress. *(Proven: a read-only dry-run on live data found
  47 customers / 3 bands / 20 grant-worthy tiers already reached.)*
- **Staff bonuses BEGIN AT LAUNCH — no back-pay.** A `reward_settings.rewards_launch_date`
  clamps every staff counter so engineer/producer/media-manager bonuses only count work on/after
  launch. We never retroactively owe an employee a bonus.
- **Don't flood the giveaway.** Because the backfill instantly reaches free-work tiers for many
  people, backfilled free-work grants land **`pending_approval`, tagged `source='backfill'`** —
  they do **not** auto-issue. The admin reviews and approves selectively (bulk approve/deny in
  the all-users view). Only the cheap **spend-discount tiers** (status %) apply automatically.
  Going forward (post-launch), newly-crossed tiers follow the normal auto/approval rules.
- **Admin sees everyone.** An **all-users rewards view** lists every user + band, their current
  counters/progress per track, and their earned / pending / issued grants — with approve/deny.
  This is the control surface for the launch giveaway.
- **Past-months exposure plan.** Before flipping launch on, an **exposure report** totals the
  backfill: counts of free shorts / hours / videos + discount tiers reached, and an estimated
  retail $ value, so Cole sees exactly what going live would open up and decides what to honor.
- **Free rewards still cost real money** (the engineer/filmer is paid from the rewards budget),
  so the exposure number is the planning ceiling, not $0.
