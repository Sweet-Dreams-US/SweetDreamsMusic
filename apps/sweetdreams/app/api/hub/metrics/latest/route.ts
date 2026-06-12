import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  // Get the most recent entry per platform using distinct on
  const { data: metrics, error } = await supabase
    .from('artist_metrics')
    .select('*')
    .eq('user_id', user.id)
    .order('metric_date', { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Group by platform, keep only the latest per platform
  const latestByPlatform: Record<string, typeof metrics[0]> = {};
  const previousByPlatform: Record<string, typeof metrics[0]> = {};

  for (const m of metrics || []) {
    if (!latestByPlatform[m.platform]) {
      latestByPlatform[m.platform] = m;
    } else if (!previousByPlatform[m.platform]) {
      previousByPlatform[m.platform] = m;
    }
  }

  return NextResponse.json({
    latest: latestByPlatform,
    previous: previousByPlatform,
  });
}
