// lib/media-contract-packages.ts
//
// Read-time normalizer: turns ANY package — an admin `package_templates` row
// OR a catalog `media_offerings` row with kind='package' — into the contract
// builder's DeliverableRow shape, so "start a contract from a package" is a
// pure copy into editable state.
//
// Prices are pre-filled where the source carries a per-line value (template
// lines: full_price_cents / quantity); catalog package slots are tier/delta
// priced, so they come in at $0 for the admin to set per deal. No migration,
// no writes — this only reads and reshapes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LineItemKind } from '@/lib/media-packages';
import type { OfferingComponentSlot } from '@/lib/media';
// NOTE: `createServiceClient` is dynamically imported inside
// getContractPackageOptions (not statically) so this module's static imports
// stay type-only — that keeps the pure mappers below importable from a plain
// `tsx` proof without pulling in `next/headers` via lib/supabase/server.

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
  const supabase = client || (await import('./supabase/server')).createServiceClient();

  const [templatesRes, templateLinesRes, offeringsRes] = await Promise.all([
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

  const templates = (templatesRes.data ?? []) as Array<{ id: string; name: string; audience: string }>;
  const templateLines = (templateLinesRes.data ?? []) as Array<TemplateLineRow & { template_id: string }>;
  const offerings = (offeringsRes.data ?? []) as Array<{
    id: string;
    slug: string;
    title: string;
    kind: string;
    eligibility: string;
    components: { slots?: OfferingComponentSlot[] } | null;
  }>;

  const offeringsById = new Map<string, { title: string; slug: string }>();
  for (const o of offerings) offeringsById.set(o.id, { title: o.title, slug: o.slug });

  const linesByTemplate = new Map<string, TemplateLineRow[]>();
  for (const l of templateLines) {
    const arr = linesByTemplate.get(l.template_id) ?? [];
    arr.push(l);
    linesByTemplate.set(l.template_id, arr);
  }

  const templateOptions = templates.map((t) =>
    normalizeTemplate(t, linesByTemplate.get(t.id) ?? [], offeringsById),
  );

  const catalogOptions = offerings
    .filter((o) => o.kind === 'package')
    .map((o) => normalizeCatalogPackage(o));

  return [...templateOptions, ...catalogOptions];
}
