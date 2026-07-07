# Unified Packages + Contract Builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the contract builder's double-price, let admins "start a contract from a package"
(reading both package systems), and make admin package templates sellable self-serve — without a
destructive migration.

**Architecture:** Keep both package definition systems (catalog `media_offerings kind=package`
with its slot configurator; admin `package_templates`). Add a read-time normalizer that flattens
either into the contract builder's existing `DeliverableRow` shape. Make `package_templates`
optionally sellable, reusing the existing quote→entitlement checkout/fulfillment. Ship in safe
slices; A+B carry no payment risk and go first.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (live project
`fweeyjnqwxywmpmnqpts`), Stripe, Tailwind v4. DDL via Supabase `apply_migration`; verification via
`npx tsc --noEmit`, `npm run build`, and one-off `tsx` proof scripts (repo convention — no unit
framework). Deploy pattern: branch → build → merge `--ff-only` to `main` → push → verify Vercel
deployment READY.

**Source spec:** `docs/superpowers/specs/2026-07-06-unified-packages-and-contract-builder-design.md`

---

## File Structure

**New files:**
- `lib/media-contract-packages.ts` — pure normalizer (`NormalizedPackageLine`,
  `ContractPackageOption`, `slugToLineItemKind`, `slotKeyToLineItemKind`, `normalizeTemplate`,
  `normalizeCatalogPackage`) + a thin DB loader `getContractPackageOptions`.
- `app/api/admin/media/contract-packages/route.ts` — GET, media-manager gated, returns options.
- `supabase-migrations/098_sellable_package_templates.sql` — additive columns on `package_templates`.
- `app/api/packages/templates/[id]/buy/route.ts` — self-serve: mint a `package_quote` for the buyer.
- `scripts/tmp-verify-normalizer.ts` — throwaway proof for the normalizer (deleted after).

**Modified files:**
- `components/media-team/ContractBuilder.tsx` — strip price from the offering dropdown (Slice A);
  add "Start from a package" control (Slice B).
- `components/admin/PackageCalculator.tsx` — add `is_sellable` toggle + `public_blurb` + `slug`.
- `app/api/admin/packages/templates/route.ts` and `.../[id]/route.ts` — persist the new fields.
- `lib/packages-server.ts` (or a new `lib/packages-sellable.ts`) — `getSellablePackages` loader.
- `app/media/page.tsx` and `components/hub/HubMedia.tsx` — surface sellable templates.

---

## SLICE A — Contract builder: kill the double price (Piece 1, no risk)

### Task A1: Remove the price from the offering selector

**Files:**
- Modify: `components/media-team/ContractBuilder.tsx` (option label ~704–709; select block ~695–711)

- [ ] **Step 1: Strip the price suffix from the `<option>` label**

Find (≈ lines 704–709):

```tsx
{offerings.map((o) => (
  <option key={o.id} value={o.id}>
    {o.title}
    {o.price_cents != null ? ` · ${formatCents(o.price_cents)}` : ' · (inquiry)'}
  </option>
))}
```

Replace with:

```tsx
{offerings.map((o) => (
  <option key={o.id} value={o.id}>
    {o.title}
  </option>
))}
```

- [ ] **Step 2: Add clarifying helper text under the select**

Immediately after the closing `</select>` of the offering selector (inside its wrapper `<div>`, ≈ line 711), add:

```tsx
<p className="font-mono text-[11px] text-black/50 mt-1">
  Category only — the total comes from the deliverables you price below.
</p>
```

- [ ] **Step 3: Remove the now-unused `formatCents` import if it is no longer referenced**

Run a search to confirm before removing:

Run: `rg "formatCents" components/media-team/ContractBuilder.tsx`
- If the only remaining match is the `import`, delete `formatCents` from that import line.
- If `formatCents` is still used elsewhere in the file, leave the import as-is.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no new errors in `ContractBuilder.tsx`.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add components/media-team/ContractBuilder.tsx
git commit -m "fix(contracts): offering selector is category-only — kills the double price"
```

---

## SLICE B — Start from a package (Piece 2, reads both systems, no writes)

### Task B1: Pure normalizer module

**Files:**
- Create: `lib/media-contract-packages.ts`

- [ ] **Step 1: Write the module (pure mappers + types + thin loader)**

```ts
// lib/media-contract-packages.ts
//
// Read-time normalizer: turns ANY package (admin package_templates OR catalog
// media_offerings kind='package') into the contract builder's DeliverableRow
// shape, so "start a contract from a package" is a pure copy into editable
// state. Prices are pre-filled where the source has a per-line value, else 0
// (admin sets per deal). No migration; no writes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LineItemKind } from '@/lib/media-packages';
import type { OfferingComponentSlot } from '@/lib/media';
import { createServiceClient } from '@/lib/supabase/server';

export interface NormalizedPackageLine {
  kind: LineItemKind;
  label: string;
  qty: number;
  unit_cents: number;
  source_slot_key: string | null;
  notes: string;
}

export interface ContractPackageOption {
  source: 'template' | 'catalog';
  id: string;
  name: string;
  audience: string;
  lines: NormalizedPackageLine[];
}

/** Map a catalog offering slug → the closest contract LineItemKind. */
export function slugToLineItemKind(slug: string): LineItemKind {
  if (slug.startsWith('mv-')) return 'music_video';
  if (slug.startsWith('short-')) return 'shorts';
  if (slug.includes('photo')) return 'photo_session';
  if (slug.includes('cover')) return 'cover_art';
  if (slug.includes('marketing')) return 'design_meeting';
  if (slug.includes('mix')) return 'mixing_session';
  return 'other';
}

/** Map a catalog package slot key → the closest contract LineItemKind. */
export function slotKeyToLineItemKind(key: string): LineItemKind {
  if (key === 'recording_hours') return 'recording_session';
  if (key === 'mix_master') return 'mixing_session';
  if (key.includes('short')) return 'shorts';
  if (key.includes('music_video')) return 'music_video';
  if (key.includes('photo')) return 'photo_session';
  if (key.includes('cover')) return 'cover_art';
  if (key.includes('marketing')) return 'design_meeting';
  return 'other';
}

/** cents-per-unit from a template line's full price / quantity (guarded). */
function perUnitCents(fullPriceCents: number, quantity: number): number {
  if (!quantity || quantity <= 0) return 0;
  return Math.max(0, Math.round(fullPriceCents / quantity));
}

interface TemplateLineRow {
  kind: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
  quantity: number;
  media_offering_id: string | null;
  full_price_cents: number;
  notes: string | null;
}

/** Normalize one package_template (+ its lines) into a ContractPackageOption. */
export function normalizeTemplate(
  tpl: { id: string; name: string; audience: string },
  lines: TemplateLineRow[],
  offeringsById: Map<string, { title: string; slug: string }>,
): ContractPackageOption {
  const normalized: NormalizedPackageLine[] = lines.map((l) => {
    const unit = perUnitCents(l.full_price_cents, l.quantity);
    if (l.kind === 'studio_hours') {
      return {
        kind: 'recording_session',
        label: l.notes?.trim() || 'Studio recording',
        qty: l.quantity,
        unit_cents: unit,
        source_slot_key: null,
        notes: '',
      };
    }
    if (l.kind === 'media_offering') {
      const off = l.media_offering_id ? offeringsById.get(l.media_offering_id) : undefined;
      return {
        kind: off ? slugToLineItemKind(off.slug) : 'other',
        label: off?.title || l.notes?.trim() || 'Media deliverable',
        qty: l.quantity,
        unit_cents: unit,
        source_slot_key: null,
        notes: '',
      };
    }
    // beat_credit + custom → generic "other"
    return {
      kind: 'other',
      label: l.notes?.trim() || (l.kind === 'beat_credit' ? 'Beat credit' : 'Custom item'),
      qty: l.quantity,
      unit_cents: unit,
      source_slot_key: null,
      notes: '',
    };
  });
  return { source: 'template', id: tpl.id, name: tpl.name, audience: tpl.audience, lines: normalized };
}

/** Normalize a catalog package (media_offerings kind='package') into an option. */
export function normalizeCatalogPackage(offering: {
  id: string;
  title: string;
  eligibility: string;
  components: { slots?: OfferingComponentSlot[] } | null;
}): ContractPackageOption {
  const slots = offering.components?.slots ?? [];
  const lines: NormalizedPackageLine[] = slots.map((slot) => {
    if (slot.kind === 'hours') {
      return {
        kind: 'recording_session',
        label: slot.label,
        qty: typeof slot.value === 'number' ? slot.value : 1,
        unit_cents: 0,
        source_slot_key: slot.key,
        notes: '',
      };
    }
    const qty = typeof slot.count === 'number' ? slot.count : 1;
    return {
      kind: slotKeyToLineItemKind(slot.key),
      label: slot.label,
      qty,
      unit_cents: 0, // catalog slot prices are tier/delta based — admin sets per deal
      source_slot_key: slot.key,
      notes: '',
    };
  });
  return {
    source: 'catalog',
    id: offering.id,
    name: offering.title,
    audience: offering.eligibility,
    lines,
  };
}

/** Load every package (template + catalog) as normalized contract options. */
export async function getContractPackageOptions(
  client?: SupabaseClient,
): Promise<ContractPackageOption[]> {
  const supabase = client || createServiceClient();

  const [{ data: templates }, { data: templateLines }, { data: offerings }] = await Promise.all([
    supabase.from('package_templates').select('id, name, audience').eq('is_active', true),
    supabase
      .from('package_template_lines')
      .select('template_id, kind, quantity, media_offering_id, full_price_cents, notes, sort_order')
      .order('sort_order', { ascending: true }),
    supabase
      .from('media_offerings')
      .select('id, slug, title, kind, eligibility, components')
      .eq('is_active', true),
  ]);

  const offeringsById = new Map<string, { title: string; slug: string }>();
  for (const o of offerings ?? []) offeringsById.set(o.id, { title: o.title, slug: o.slug });

  const linesByTemplate = new Map<string, TemplateLineRow[]>();
  for (const l of templateLines ?? []) {
    const arr = linesByTemplate.get(l.template_id) ?? [];
    arr.push(l as unknown as TemplateLineRow);
    linesByTemplate.set(l.template_id, arr);
  }

  const templateOptions = (templates ?? []).map((t) =>
    normalizeTemplate(t, linesByTemplate.get(t.id) ?? [], offeringsById),
  );

  const catalogOptions = (offerings ?? [])
    .filter((o) => o.kind === 'package')
    .map((o) => normalizeCatalogPackage(o));

  return [...templateOptions, ...catalogOptions];
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from `lib/media-contract-packages.ts`.

### Task B2: Prove the normalizer against real fixtures

**Files:**
- Create (throwaway): `scripts/tmp-verify-normalizer.ts`

- [ ] **Step 1: Write the proof using real fixture data (no DB)**

```ts
// scripts/tmp-verify-normalizer.ts — throwaway proof for lib/media-contract-packages.ts
import { normalizeTemplate, normalizeCatalogPackage } from '../lib/media-contract-packages';

// Real single-drop slots (from media_offerings.components on live DB)
const singleDrop = {
  id: 'a6c8f3e1-e52a-44a7-9b4b-0fb9dfc8b74d',
  title: 'Single Drop',
  eligibility: 'solo',
  components: {
    slots: [
      { key: 'recording_hours', kind: 'hours', label: 'Studio recording (3 hrs)', value: 3, skippable: false },
      { key: 'mix_master', kind: 'unit', count: 1, label: 'Mix + master', skippable: false },
      { key: 'cover_art', kind: 'unit', count: 1, label: 'Cover art', skippable: true, skip_delta_cents: 15000 },
      { key: 'shorts', kind: 'unit', count: 3, label: '3 shorts', options: [{ tier: 'basic', delta: 0 }] },
      { key: 'photo_session', kind: 'unit', count: 1, label: 'Photo session', skippable: true, skip_delta_cents: 20000 },
    ],
  },
} as const;

const catalog = normalizeCatalogPackage(singleDrop as never);
const assert = (cond: boolean, msg: string) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } };

assert(catalog.source === 'catalog', 'catalog source');
assert(catalog.lines.length === 5, 'single-drop → 5 lines');
assert(catalog.lines[0].kind === 'recording_session' && catalog.lines[0].qty === 3, 'recording 3 hrs');
assert(catalog.lines[1].kind === 'mixing_session', 'mix_master → mixing_session');
assert(catalog.lines[2].kind === 'cover_art', 'cover_art');
assert(catalog.lines[3].kind === 'shorts' && catalog.lines[3].qty === 3, '3 shorts');
assert(catalog.lines.every((l) => l.unit_cents === 0), 'catalog prices blank (admin sets)');

// Template fixture: 1 studio_hours line (6 hrs, $300) + 1 media_offering line (mv-mid ×1, $500)
const tplLines = [
  { kind: 'studio_hours', quantity: 6, media_offering_id: null, full_price_cents: 30000, notes: 'Recording block' },
  { kind: 'media_offering', quantity: 1, media_offering_id: 'off-mv', full_price_cents: 50000, notes: null },
] as const;
const offMap = new Map([['off-mv', { title: 'Mid-Tier Music Video', slug: 'mv-mid' }]]);
const tpl = normalizeTemplate({ id: 't1', name: 'Test Tpl', audience: 'solo' }, tplLines as never, offMap);

assert(tpl.source === 'template', 'template source');
assert(tpl.lines[0].kind === 'recording_session' && tpl.lines[0].qty === 6 && tpl.lines[0].unit_cents === 5000, 'studio_hours → recording $50/hr');
assert(tpl.lines[1].kind === 'music_video' && tpl.lines[1].label === 'Mid-Tier Music Video' && tpl.lines[1].unit_cents === 50000, 'media_offering → mv label+price');

console.log('OK — normalizer proof passed');
```

- [ ] **Step 2: Run the proof**

Run: `npx tsx scripts/tmp-verify-normalizer.ts`
Expected: `OK — normalizer proof passed` (exit 0). If any `FAIL:` line prints, fix the mapper and rerun.

- [ ] **Step 3: Delete the throwaway proof**

```bash
git rm -f --ignore-unmatch scripts/tmp-verify-normalizer.ts
rm -f scripts/tmp-verify-normalizer.ts
```

- [ ] **Step 4: Commit the normalizer**

```bash
git add lib/media-contract-packages.ts
git commit -m "feat(contracts): package normalizer — flatten template/catalog packages to line items"
```

### Task B3: Read route for the builder

**Files:**
- Create: `app/api/admin/media/contract-packages/route.ts`

- [ ] **Step 1: Write the GET route (media-manager gated)**

Mirror the auth used by `app/api/admin/media/bookings/contract/route.ts` (`verifyMediaManagerAccess` + `getSessionUser`).

```ts
// app/api/admin/media/contract-packages/route.ts
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth';
import { verifyMediaManagerAccess } from '@/lib/media-installments-server';
import { getContractPackageOptions } from '@/lib/media-contract-packages';

export async function GET() {
  const supabase = createServiceClient();
  const allowed = await verifyMediaManagerAccess(supabase);
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const options = await getContractPackageOptions(supabase);
  return NextResponse.json({ options });
}
```

> NOTE for implementer: confirm the exact export name/signature of the media-manager auth helper
> in `lib/media-installments-server.ts` (the contract route imports it). If it is named
> differently (e.g. `verifyMediaManagerAccess(supabase)` vs a request-based variant), match the
> contract route's usage exactly — do not invent a new helper.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/media/contract-packages/route.ts
git commit -m "feat(contracts): GET contract-packages — normalized package options for the builder"
```

### Task B4: "Start from a package" control in the builder

**Files:**
- Modify: `components/media-team/ContractBuilder.tsx` (state ~129–147; options fetch ~174–203;
  deliverables section header ~896–910)

- [ ] **Step 1: Add state + type import**

Near the other imports add:

```tsx
import type { ContractPackageOption } from '@/lib/media-contract-packages';
```

Near the option-pool state (≈ line 130) add:

```tsx
const [packageOptions, setPackageOptions] = useState<ContractPackageOption[]>([]);
const [startedFromPackage, setStartedFromPackage] = useState<string>('');
```

- [ ] **Step 2: Fetch package options in the existing options effect**

Inside the effect that already fetches clients/offerings (≈ lines 174–203), after the offerings
fetch, add a parallel fetch:

```tsx
try {
  const pkgRes = await fetch('/api/admin/media/contract-packages');
  if (pkgRes.ok) {
    const pkgData = await pkgRes.json();
    setPackageOptions(Array.isArray(pkgData.options) ? pkgData.options : []);
  }
} catch {
  // non-fatal: builder still works without package presets
}
```

- [ ] **Step 3: Add the picker UI above the deliverables list**

At the top of the deliverables section (≈ line 900, before the deliverable rows / slot quick-add),
insert:

```tsx
{packageOptions.length > 0 && (
  <div className="mb-4 border-2 border-black/10 p-3">
    <label className="block font-mono text-xs uppercase tracking-wider text-black/60 mb-1">
      Start from a package (optional)
    </label>
    <select
      value={startedFromPackage}
      onChange={(e) => {
        const id = e.target.value;
        setStartedFromPackage(id);
        if (!id) return;
        const opt = packageOptions.find((p) => `${p.source}:${p.id}` === id);
        if (!opt) return;
        setDeliverables(
          opt.lines.map((nl) => ({
            kind: nl.kind,
            label: nl.label,
            qty: String(nl.qty),
            unitDollars: nl.unit_cents ? (nl.unit_cents / 100).toFixed(2) : '',
            source_slot_key: nl.source_slot_key,
            notes: nl.notes,
            is_free_addon: false,
          })),
        );
      }}
      className="w-full border-2 border-black/15 px-3 py-2 font-mono text-sm"
    >
      <option value="">— Build from scratch —</option>
      {packageOptions.map((p) => (
        <option key={`${p.source}:${p.id}`} value={`${p.source}:${p.id}`}>
          {p.name} ({p.source === 'template' ? 'package' : 'catalog'})
        </option>
      ))}
    </select>
    <p className="font-mono text-[11px] text-black/50 mt-1">
      Loads the package's items as editable rows — set your own price on each. Replaces current rows.
    </p>
  </div>
)}
```

> NOTE: the `setDeliverables(...)` object literal MUST match the `DeliverableRow` shape exactly
> (lines 87–95): `{ kind, label, qty, unitDollars, source_slot_key, notes, is_free_addon }`.

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add components/media-team/ContractBuilder.tsx
git commit -m "feat(contracts): 'Start from a package' — load template/catalog packages as editable line items"
```

### Task B5: Ship + verify Slice A+B

- [ ] **Step 1: Merge to main + deploy**

```bash
git checkout main && git merge --ff-only <branch> && git push origin main
```

- [ ] **Step 2: Verify deployment READY** (Vercel MCP `get_deployment` on
  `sweet-dreams-music-git-main-sweet-dreams-projects.vercel.app`, or `Invoke-WebRequest` fallback).

- [ ] **Step 3: Live check** — open `/media-team/contracts/new`: offering dropdown shows NO price;
  "Start from a package" lists templates + catalog packages; selecting one fills editable rows;
  totals compute from the rows; installments still must sum to the total.

---

## SLICE C — Packages home sellable (Piece 3, payment path; ship after A+B verified)

### Task C1: Migration 098 — additive columns

**Files:**
- Create: `supabase-migrations/098_sellable_package_templates.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 098_sellable_package_templates.sql — make an admin package template sellable
-- self-serve on /media + the Artist Hub. Additive only; no data moved. When
-- is_sellable AND is_active, the template is surfaced for purchase; the buy
-- flow reuses the existing quote → checkout → mintEntitlementFromQuote path.

alter table package_templates
  add column if not exists is_sellable boolean not null default false;
alter table package_templates
  add column if not exists public_blurb text;

create index if not exists idx_package_templates_sellable
  on package_templates (is_sellable, is_active) where is_sellable = true;
```

- [ ] **Step 2: Apply the migration** (Supabase `apply_migration`, name `sellable_package_templates`, project `fweeyjnqwxywmpmnqpts`).

- [ ] **Step 3: Verify columns exist**

Run (Supabase `execute_sql`):
```sql
select column_name from information_schema.columns
where table_name='package_templates' and column_name in ('is_sellable','public_blurb');
```
Expected: both rows returned.

- [ ] **Step 4: Commit the migration file**

```bash
git add supabase-migrations/098_sellable_package_templates.sql
git commit -m "feat(packages): 098 — is_sellable + public_blurb on package_templates"
```

### Task C2: Persist the new fields through the template CRUD

**Files:**
- Modify: `app/api/admin/packages/templates/route.ts` (POST, ~143–270)
- Modify: `app/api/admin/packages/templates/[id]/route.ts` (PATCH, ~49–155)

- [ ] **Step 1: POST — accept + insert `is_sellable`, `public_blurb`, `slug`**

In the `package_templates` insert payload (≈ lines 218–240), add the three fields, reading from
the request body with safe defaults:

```ts
is_sellable: body.is_sellable === true,
public_blurb: typeof body.public_blurb === 'string' ? body.public_blurb.trim() || null : null,
slug: typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : null,
```

- [ ] **Step 2: PATCH — include the three fields in the partial update**

In the partial-update object (≈ lines 72–92), add (only when present in the body):

```ts
if (typeof body.is_sellable === 'boolean') update.is_sellable = body.is_sellable;
if (typeof body.public_blurb === 'string') update.public_blurb = body.public_blurb.trim() || null;
if (typeof body.slug === 'string') update.slug = body.slug.trim() || null;
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/packages/templates/route.ts app/api/admin/packages/templates/[id]/route.ts
git commit -m "feat(packages): persist is_sellable/public_blurb/slug through template CRUD"
```

### Task C3: Calculator UI — sellable controls

**Files:**
- Modify: `components/admin/PackageCalculator.tsx` (`PackageTemplateForEdit` ~45–56;
  `blankTemplate` ~72–84; save payload ~249–310; Basics section ~340–426)

- [ ] **Step 1: Extend the edit shape + blank seed**

Add to `PackageTemplateForEdit` (≈ line 45–56):

```ts
is_sellable: boolean;
public_blurb: string | null;
slug: string | null;
```

Add to `blankTemplate()` (≈ line 72–84) return object:

```ts
is_sellable: false,
public_blurb: null,
slug: null,
```

Ensure `toEditShape()` in `components/admin/PackageTemplates.tsx` copies these three fields from the
server row (it currently spreads/maps known fields — add `is_sellable`, `public_blurb`, `slug`).

- [ ] **Step 2: Add the form controls (in the Basics section, ≈ line 420)**

```tsx
<label className="flex items-center gap-2 mt-4">
  <input
    type="checkbox"
    checked={tpl.is_sellable}
    onChange={(e) => setTpl({ ...tpl, is_sellable: e.target.checked })}
  />
  <span className="font-mono text-sm">Sellable self-serve (show on /media + Artist Hub)</span>
</label>
{tpl.is_sellable && (
  <>
    <input
      type="text"
      value={tpl.slug ?? ''}
      onChange={(e) => setTpl({ ...tpl, slug: e.target.value })}
      placeholder="url-slug (e.g. studio-video-3mo)"
      className="w-full border-2 border-black/15 px-3 py-2 font-mono text-sm mt-2"
    />
    <textarea
      value={tpl.public_blurb ?? ''}
      onChange={(e) => setTpl({ ...tpl, public_blurb: e.target.value })}
      placeholder="Public blurb shown on the marketing card"
      rows={2}
      className="w-full border-2 border-black/15 px-3 py-2 font-mono text-sm mt-2"
    />
  </>
)}
```

- [ ] **Step 3: Include the fields in the save payload**

In the POST/PATCH body assembled by the save handler (≈ lines 249–310) add:

```ts
is_sellable: tpl.is_sellable,
public_blurb: tpl.public_blurb,
slug: tpl.slug,
```

- [ ] **Step 4: Typecheck + build → commit**

Run: `npx tsc --noEmit` then `npm run build` → exit 0.

```bash
git add components/admin/PackageCalculator.tsx components/admin/PackageTemplates.tsx
git commit -m "feat(packages): calculator — sellable toggle + slug + public blurb"
```

### Task C4: Sellable-packages loader

**Files:**
- Modify: `lib/packages-server.ts` (add loader; if this file does not exist, create
  `lib/packages-sellable.ts` and export from there)

- [ ] **Step 1: Add `getSellablePackages`**

```ts
export interface SellablePackage {
  id: string;
  name: string;
  slug: string | null;
  public_blurb: string | null;
  price_cents: number;
  audience: string;
  is_membership: boolean;
  membership_months: number | null;
}

export async function getSellablePackages(client?: SupabaseClient): Promise<SellablePackage[]> {
  const supabase = client || createServiceClient();
  const { data } = await supabase
    .from('package_templates')
    .select('id, name, slug, public_blurb, price_cents, audience, is_membership, membership_months')
    .eq('is_sellable', true)
    .eq('is_active', true)
    .order('price_cents', { ascending: true });
  return (data ?? []) as SellablePackage[];
}
```

- [ ] **Step 2: Typecheck → commit**

Run: `npx tsc --noEmit` → exit 0.

```bash
git add lib/packages-server.ts
git commit -m "feat(packages): getSellablePackages loader"
```

### Task C5: Self-serve buy route (reuses quote → checkout)

**Files:**
- Create: `app/api/packages/templates/[id]/buy/route.ts`

- [ ] **Step 1: Write the buy route**

Creates a `package_quote` (status `sent`) for the signed-in buyer, then returns the token. The
buyer is redirected to `/quotes/{token}`, which already runs the accept → Stripe checkout flow
(`app/api/quotes/[token]/accept/route.ts`), and the existing `package_quote` webhook branch mints
the entitlement. v1 supports **solo** buyers (user_id recipient); band templates fall back to the
admin-quote path.

```ts
// app/api/packages/templates/[id]/buy/route.ts
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Sign in to purchase.' }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();

  const { data: tpl } = await service
    .from('package_templates')
    .select('id, name, price_cents, is_sellable, is_active, audience')
    .eq('id', id)
    .maybeSingle();
  if (!tpl || !tpl.is_sellable || !tpl.is_active) {
    return NextResponse.json({ error: 'This package is not available for self-serve purchase.' }, { status: 404 });
  }
  if (tpl.audience === 'band') {
    return NextResponse.json({ error: 'Band packages are purchased through a quote — contact us.' }, { status: 400 });
  }

  const token = randomBytes(24).toString('hex');
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);

  const { data: quote, error } = await service
    .from('package_quotes')
    .insert({
      template_id: tpl.id,
      user_id: user.id,
      token,
      status: 'sent',
      total_price_cents: tpl.price_cents,
      total_full_price_cents: tpl.price_cents,
      total_discount_cents: 0,
      expires_at: expires.toISOString(),
      created_by_user_id: user.id,
    })
    .select('token')
    .single();

  if (error || !quote) {
    return NextResponse.json({ error: 'Could not start purchase. Try again.' }, { status: 500 });
  }
  return NextResponse.json({ token: quote.token, redirect: `/quotes/${quote.token}` });
}
```

- [ ] **Step 2: Typecheck + build → commit**

Run: `npx tsc --noEmit` then `npm run build` → exit 0.

```bash
git add app/api/packages/templates/[id]/buy/route.ts
git commit -m "feat(packages): self-serve buy — mint a quote + hand off to existing checkout"
```

### Task C6: Surface sellable packages on /media + hub

**Files:**
- Modify: `app/media/page.tsx` (after the packages section, ~208)
- Modify: `components/hub/HubMedia.tsx` (near the catalog section, ~213)

- [ ] **Step 1: /media — add a sellable-packages section (public, no prices per convention)**

Load in the server component (near `getActiveOfferings()`, ~78):
```tsx
import { getSellablePackages } from '@/lib/packages-server';
// ...
const sellablePackages = await getSellablePackages();
```

Render a section (after À La Carte, styled like the existing package section) mapping
`sellablePackages` to cards showing `name` + `public_blurb`; CTA links `user ? '/dashboard' :
'/login?redirect=/dashboard'` (public page hides prices — parity with catalog packages).

- [ ] **Step 2: Hub — sellable packages with price + Buy button**

In `HubMedia.tsx`, load `getSellablePackages()` server-side and pass to the client catalog (or a
small new client block). Each card shows `name`, `public_blurb`, `fmt(price_cents)`, and a Buy
button that:

```tsx
const res = await fetch(`/api/packages/templates/${pkg.id}/buy`, { method: 'POST' });
const data = await res.json();
if (res.ok && data.redirect) window.location.href = data.redirect;
else alert(data.error || 'Could not start purchase.');
```

- [ ] **Step 3: Typecheck + build → commit**

Run: `npx tsc --noEmit` then `npm run build` → exit 0.

```bash
git add app/media/page.tsx components/hub/HubMedia.tsx
git commit -m "feat(packages): surface sellable templates on /media + Artist Hub"
```

### Task C7: Ship + verify Slice C (payment path)

- [ ] **Step 1: Merge to main + deploy + verify READY.**
- [ ] **Step 2: Admin check** — mark a template `is_sellable` in the calculator; confirm it appears
  on the hub with its price and on `/media`.
- [ ] **Step 3: Test purchase** — as a solo test buyer, click Buy → lands on `/quotes/{token}` →
  Accept & Pay (Stripe test card) → confirm the webhook minted a `package_entitlement` with the
  expected `package_entitlement_balances` (studio_hours + media). Verify via `execute_sql`.

---

## SLICE D — Contract studio-credit grant (DEFERRED — needs a product decision)

**Why deferred, not built now:** the spec wants a `recording_session` line to grant redeemable
`studio_credits`. The contract builder's line `qty` is a generic count, so hours cannot be safely
inferred from it (a "recording_session, qty 1, $300" row could mean one 3-hour session, not one
hour). Auto-granting studio hours off an ambiguous `qty` is a money-path guess and is unsafe.

**Recommended shape when we build it:**
1. Add an explicit optional `hours` field to recording_session line items in the builder (and a
   nullable `hours` column on `media_booking_line_items`, migration 099), so studio hours are
   stated, not inferred.
2. Add a shared idempotent helper `grantContractStudioCreditsForBooking(service, bookingId)` in
   `lib/media-contract-credits.ts`: sum recording_session `hours`, and if > 0 and no
   `studio_credits` row exists for this `source_booking_id`, insert one
   (`hours_granted = Σ hours`, `source_booking_id = bookingId`, owner = booking user/band).
3. Call it from all three installment-paid transitions, guarded to fire once on first paid:
   - `app/api/media/contract/[token]/pay/route.ts`
   - `app/api/admin/media/bookings/[id]/installments/[instId]/record-payment/route.ts`
   - `app/api/booking/webhook/route.ts` (installment paid branch)
4. Golden-verify: existing contracts (no recording_session hours) grant nothing; a new contract
   with stated hours grants exactly those hours, once, even if the webhook retries.

**Confirm with Cole before building:** should a paid contract's recording line also become
redeemable studio time, or is the recording line simply the service being delivered (no extra
bookable credit)? This one-line answer decides whether Slice D happens at all.

---

## Self-Review (against the spec)

- **Piece 1 (double price):** Task A1 — covered.
- **Piece 2 (start from a package, both systems):** Tasks B1–B4 — covered (normalizer handles
  template + catalog; route + builder control).
- **Piece 3 (sellable home, define-once-use-either-way):** Tasks C1–C7 — covered (columns,
  calculator, loader, buy route reusing quote→checkout, surfacing).
- **Fulfillment / studio inclusion:** sellable templates reuse quote→entitlement (studio_hours
  redeemable via existing `redeem-session`). The *contract* studio-credit grant is Slice D,
  explicitly deferred with a stated reason + decision needed — not silently dropped.
- **Additive data model:** only migration 098 (two columns) — matches spec "additive only."
- **No destructive migration / no retired path:** honored throughout.
- **Type consistency:** `NormalizedPackageLine`/`ContractPackageOption` used identically in B1/B3/B4;
  `DeliverableRow` object in B4 matches lines 87–95; `LineItemKind` sourced from `lib/media-packages`.
- **Money discipline:** contract total stays Σ line items; sellable price recomputed server-side by
  the existing quote/checkout path; no stale catalog number trusted.
