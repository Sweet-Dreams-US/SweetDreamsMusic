// lib/engineer-blocks.ts
//
// Server helper for checking engineer-specific availability blocks.
// Used by /api/booking/create + the engineer accept flow to reject a
// booking when the requested engineer is unavailable for that window.
//
// Studio-wide blocks (engineer_name=NULL) are checked separately by the
// existing availability endpoints. This helper is engineer-scoped only.

import { createServiceClient } from '@/lib/supabase/server';

export interface EngineerBlockedQuery {
  engineerName: string;
  startISO: string;
  endISO: string;
}

/**
 * Returns true if the named engineer has any block overlapping the given
 * window. Two intervals overlap iff start1 < end2 AND start2 < end1.
 *
 * The query is intentionally limited to engineer-specific rows
 * (engineer_name = X). Studio-wide blocks are admin-set and apply to
 * everyone, including engineer-claimed sessions, but are checked elsewhere.
 */
export async function isEngineerBlocked({
  engineerName,
  startISO,
  endISO,
}: EngineerBlockedQuery): Promise<boolean> {
  const service = createServiceClient();
  const { data: hits } = await service
    .from('studio_blocks')
    .select('id')
    .eq('engineer_name', engineerName)
    .lt('start_time', endISO)
    .gt('end_time', startISO)
    .limit(1);
  return !!hits && hits.length > 0;
}
