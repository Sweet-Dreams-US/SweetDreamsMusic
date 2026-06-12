// app/api/admin/packages/templates/[id]/route.ts
//
// PATCH — update a single template. Body shape mirrors POST + adds the
//   ability to fully replace the lines array (replace, not merge — see
//   note below).
// DELETE — archive a template. Soft delete: sets is_active=false and
//   archived_at=now(). Existing entitlements that reference the
//   template via `template_id` keep working (FK is RESTRICT).
//
// Both admin-only.
//
// Why PATCH replaces lines wholesale instead of merging by line id: the
// calculator UI lets admin add/remove/reorder lines freely; modeling the
// edit as "delete all old lines, insert new ones" matches what the user
// experiences in the form. Trying to diff line by line introduces
// edge cases (what if quantity changed AND sort changed?) without UX
// benefit. Cascade FK on `package_template_lines.template_id` keeps the
// reference graph clean.

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import type { PackageLineKind } from '@/lib/packages';

interface UpdateLineInput {
  kind: PackageLineKind;
  quantity: number;
  full_price_cents: number;
  package_value_cents: number;
  media_offering_id?: string | null;
  notes?: string | null;
  sort_order?: number;
}

interface UpdateTemplatePayload {
  name?: string;
  description?: string | null;
  slug?: string | null;
  audience?: 'solo' | 'band';
  is_membership?: boolean;
  duration_days?: number | null;
  membership_months?: number | null;
  price_cents?: number;
  is_active?: boolean;
  /** If present, replaces all template lines wholesale. */
  lines?: UpdateLineInput[];
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: UpdateTemplatePayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const service = createServiceClient();

  // Build the partial update from whatever fields the caller sent.
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.description !== undefined) update.description = body.description;
  if (body.slug !== undefined) update.slug = body.slug;
  if (body.audience !== undefined) update.audience = body.audience;
  if (body.is_membership !== undefined) update.is_membership = body.is_membership;
  if (body.duration_days !== undefined) update.duration_days = body.duration_days;
  if (body.membership_months !== undefined) update.membership_months = body.membership_months;
  if (body.price_cents !== undefined) update.price_cents = body.price_cents;
  if (body.is_active !== undefined) update.is_active = body.is_active;

  if (Object.keys(update).length > 0) {
    const { error: updateErr } = await service
      .from('package_templates')
      .update(update)
      .eq('id', id);
    if (updateErr) {
      console.error('[admin/packages/templates PATCH] update:', updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  }

  // Replace lines if the caller sent an array (even if empty — that
  // means "this template has no lines now").
  if (Array.isArray(body.lines)) {
    // Validate up front before any destructive write.
    for (const [i, line] of body.lines.entries()) {
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

    // Delete existing lines, then insert the new set. The CASCADE FK on
    // package_template_lines.template_id makes this safe — entitlements
    // already minted from the prior version snapshot the line data into
    // package_entitlement_balances and don't depend on the line rows
    // continuing to exist.
    const { error: deleteErr } = await service
      .from('package_template_lines')
      .delete()
      .eq('template_id', id);
    if (deleteErr) {
      console.error('[admin/packages/templates PATCH] delete old lines:', deleteErr);
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    if (body.lines.length > 0) {
      const linesPayload = body.lines.map((line, idx) => ({
        template_id: id,
        kind: line.kind,
        quantity: line.quantity,
        media_offering_id: line.media_offering_id ?? null,
        full_price_cents: line.full_price_cents,
        package_value_cents: line.package_value_cents,
        notes: line.notes ?? null,
        sort_order: line.sort_order ?? idx,
      }));
      const { error: insertErr } = await service
        .from('package_template_lines')
        .insert(linesPayload);
      if (insertErr) {
        console.error('[admin/packages/templates PATCH] insert new lines:', insertErr);
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const service = createServiceClient();

  // Soft delete — flip is_active off and stamp archived_at. Hard delete
  // would FK-fail against any existing quotes/entitlements anyway (those
  // FKs are RESTRICT). Soft delete preserves history.
  const { error } = await service
    .from('package_templates')
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('[admin/packages/templates DELETE] archive:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
