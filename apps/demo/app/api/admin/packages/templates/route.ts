// app/api/admin/packages/templates/route.ts
//
// GET — list all package templates with their lines hydrated.
// POST — create a new template + its lines in a single payload.
//
// Both admin-only. The PATCH/DELETE per-id endpoints live at
// /api/admin/packages/templates/[id]/route.ts.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import type { PackageLineKind } from '@/lib/packages';

export interface TemplateLine {
  id: string;
  template_id: string;
  kind: 'studio_hours' | 'media_offering' | 'beat_credit' | 'custom';
  quantity: number;
  media_offering_id: string | null;
  full_price_cents: number;
  package_value_cents: number;
  notes: string | null;
  sort_order: number;
}

export interface PackageTemplate {
  id: string;
  name: string;
  description: string | null;
  slug: string | null;
  audience: 'solo' | 'band';
  is_membership: boolean;
  duration_days: number | null;
  membership_months: number | null;
  price_cents: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  lines: TemplateLine[];
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const service = createServiceClient();

  // Pull all templates (active + archived) sorted newest-first. Admin
  // sees archived too — they need to be able to reactivate or compare.
  const { data: templates, error: tErr } = await service
    .from('package_templates')
    .select('*')
    .order('created_at', { ascending: false });
  if (tErr) {
    console.error('[admin/packages/templates] fetch templates:', tErr);
    return NextResponse.json({ error: tErr.message }, { status: 500 });
  }

  const templatesArr = (templates ?? []) as Omit<PackageTemplate, 'lines'>[];

  // Empty state — no templates yet (the typical case in Round A). Skip
  // the lines query entirely.
  if (templatesArr.length === 0) {
    return NextResponse.json({ templates: [] });
  }

  // Hydrate lines in a single query, then group client-side. Avoids
  // N+1 even at low template counts.
  const templateIds = templatesArr.map((t) => t.id);
  const { data: lines, error: lErr } = await service
    .from('package_template_lines')
    .select('*')
    .in('template_id', templateIds)
    .order('sort_order', { ascending: true });
  if (lErr) {
    console.error('[admin/packages/templates] fetch lines:', lErr);
    return NextResponse.json({ error: lErr.message }, { status: 500 });
  }

  const linesByTemplate = new Map<string, TemplateLine[]>();
  for (const line of (lines ?? []) as TemplateLine[]) {
    const list = linesByTemplate.get(line.template_id) ?? [];
    list.push(line);
    linesByTemplate.set(line.template_id, list);
  }

  const result: PackageTemplate[] = templatesArr.map((t) => ({
    ...t,
    lines: linesByTemplate.get(t.id) ?? [],
  }));

  return NextResponse.json({ templates: result });
}

// ════════════════════════════════════════════════════════════════════
// POST — create a new template (with its lines) atomically
// ════════════════════════════════════════════════════════════════════
//
// Body shape:
//   {
//     name, description, slug?,
//     audience: 'solo' | 'band',
//     is_membership: boolean,
//     duration_days?: number,        // required for one-off
//     membership_months?: number,    // required for membership
//     price_cents: number,
//     is_active?: boolean,
//     lines: [{ kind, quantity, full_price_cents, package_value_cents,
//               media_offering_id?, notes?, sort_order? }, ...]
//   }
//
// Validation: shape is checked here, but the DB CHECK constraints
// (membership_has_months, oneoff_has_duration, exactly_one_recipient,
// non-negative numbers) catch any malformed inputs that slip through.

interface CreateLineInput {
  kind: PackageLineKind;
  quantity: number;
  full_price_cents: number;
  package_value_cents: number;
  media_offering_id?: string | null;
  notes?: string | null;
  sort_order?: number;
}

interface CreateTemplatePayload {
  name?: string;
  description?: string | null;
  slug?: string | null;
  audience?: 'solo' | 'band';
  is_membership?: boolean;
  duration_days?: number | null;
  membership_months?: number | null;
  price_cents?: number;
  is_active?: boolean;
  lines?: CreateLineInput[];
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  let body: CreateTemplatePayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  // Shape validation. Failing fast here gives the calculator UI clean
  // error messages; the DB CHECK constraints would otherwise return
  // cryptic violations.
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!body.audience || !['solo', 'band'].includes(body.audience)) {
    return NextResponse.json({ error: "audience must be 'solo' or 'band'" }, { status: 400 });
  }
  if (typeof body.is_membership !== 'boolean') {
    return NextResponse.json({ error: 'is_membership must be a boolean' }, { status: 400 });
  }
  if (typeof body.price_cents !== 'number' || body.price_cents < 0) {
    return NextResponse.json({ error: 'price_cents must be a non-negative number' }, { status: 400 });
  }
  if (body.is_membership) {
    if (typeof body.membership_months !== 'number' || body.membership_months <= 0) {
      return NextResponse.json(
        { error: 'membership_months is required and must be > 0 for memberships' },
        { status: 400 },
      );
    }
  } else {
    if (typeof body.duration_days !== 'number' || body.duration_days <= 0) {
      return NextResponse.json(
        { error: 'duration_days is required and must be > 0 for one-off packages' },
        { status: 400 },
      );
    }
  }

  const lines: CreateLineInput[] = Array.isArray(body.lines) ? body.lines : [];
  for (const [i, line] of lines.entries()) {
    if (!['studio_hours', 'media_offering', 'beat_credit', 'custom'].includes(line.kind)) {
      return NextResponse.json({ error: `lines[${i}].kind invalid` }, { status: 400 });
    }
    if (typeof line.quantity !== 'number' || line.quantity <= 0) {
      return NextResponse.json({ error: `lines[${i}].quantity must be > 0` }, { status: 400 });
    }
    if (typeof line.full_price_cents !== 'number' || line.full_price_cents < 0) {
      return NextResponse.json(
        { error: `lines[${i}].full_price_cents must be >= 0` },
        { status: 400 },
      );
    }
    if (typeof line.package_value_cents !== 'number' || line.package_value_cents < 0) {
      return NextResponse.json(
        { error: `lines[${i}].package_value_cents must be >= 0` },
        { status: 400 },
      );
    }
  }

  const service = createServiceClient();

  // Insert the template, then the lines, then return the hydrated
  // template. Two writes; if the line insert fails, the template row
  // exists with no lines (admin can edit + retry, or delete it). We
  // don't have a true transaction here because the Supabase JS client
  // doesn't expose one, but the worst-case state (template without
  // lines) is benign — admin sees it as "draft" and can fix it.
  const { data: created, error: createErr } = await service
    .from('package_templates')
    .insert({
      name: body.name.trim(),
      description: body.description ?? null,
      slug: body.slug ?? null,
      audience: body.audience,
      is_membership: body.is_membership,
      duration_days: body.duration_days ?? null,
      membership_months: body.membership_months ?? null,
      price_cents: body.price_cents,
      is_active: body.is_active ?? true,
    })
    .select('*')
    .single();

  if (createErr || !created) {
    console.error('[admin/packages/templates POST] insert template:', createErr);
    return NextResponse.json(
      { error: createErr?.message || 'Could not create template' },
      { status: 500 },
    );
  }

  const templateRow = created as { id: string };

  if (lines.length > 0) {
    const linesPayload = lines.map((line, idx) => ({
      template_id: templateRow.id,
      kind: line.kind,
      quantity: line.quantity,
      media_offering_id: line.media_offering_id ?? null,
      full_price_cents: line.full_price_cents,
      package_value_cents: line.package_value_cents,
      notes: line.notes ?? null,
      sort_order: line.sort_order ?? idx,
    }));

    const { error: linesErr } = await service
      .from('package_template_lines')
      .insert(linesPayload);

    if (linesErr) {
      console.error('[admin/packages/templates POST] insert lines:', linesErr);
      return NextResponse.json(
        { error: `Template created but lines failed: ${linesErr.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ template: { ...created, lines: lines.length > 0 ? lines : [] } });
}
