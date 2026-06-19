import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { calculateLevel } from '@/lib/xp-system';
import { ACHIEVEMENTS } from '@/lib/achievements';
import { ENGINEERS } from '@/lib/constants';
import { grantEventReward } from '@/lib/rewards-server';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const service = createServiceClient();

  // Determine if this user is an engineer (by email match)
  const isEngineer = ENGINEERS.some(
    (e) => e.email.toLowerCase() === user.email?.toLowerCase()
  );
  const engineerConfig = ENGINEERS.find(
    (e) => e.email.toLowerCase() === user.email?.toLowerCase()
  );

  // Get profile first to check producer status
  const { data: profileData } = await supabase
    .from('profiles')
    .select('id, total_xp, artist_level, daily_streak, display_name, genre, career_stage, profile_picture_url, public_profile_slug, role, is_producer')
    .eq('user_id', user.id)
    .single();

  const isProducer = !!profileData?.is_producer;
  const profileId = profileData?.id;

  // Query all relevant data in parallel
  const [
    sessionsResult,
    engineerSessionsResult,
    projectsResult,
    completedProjectsResult,
    goalsResult,
    completedGoalsResult,
    metricsResult,
    tasksResult,
    sessionNotesResult,
    beatPurchasesResult,
    calendarEventsResult,
    platformConnectionsResult,
    existingAchievementsResult,
    // Producer-specific
    producerBeatsResult,
    producerLeasesResult,
    producerExclusivesResult,
    // Engineer media sales
    engineerMediaSalesResult,
    // Private sales
    privateSalesResult,
    // Revenue: session earnings for engineers
    engineerBookingsResult,
    // Revenue: beat sales for producers
    producerBeatRevenueResult,
  ] = await Promise.all([
    // Completed bookings as CLIENT (customer_email = user.email)
    // IMPORTANT: Exclude sessions where this user is the ENGINEER, not the client
    // We filter out bookings where engineer_name matches this user's engineer name
    service
      .from('bookings')
      .select('id, engineer_name', { count: 'exact', head: false })
      .eq('customer_email', user.email!)
      .eq('status', 'completed'),

    // Completed bookings as ENGINEER (for engineer-specific achievements)
    isEngineer && engineerConfig
      ? service
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('engineer_name', engineerConfig.name)
          .eq('status', 'completed')
      : Promise.resolve({ count: 0, data: null, error: null }),

    // Total artist_projects
    supabase
      .from('artist_projects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),

    // Completed/released projects
    supabase
      .from('artist_projects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .or('status.eq.completed,current_phase.eq.released'),

    // Total goals
    supabase
      .from('artist_goals')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),

    // Completed goals
    supabase
      .from('artist_goals')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'completed'),

    // Metrics entries
    supabase
      .from('artist_metrics')
      .select('week_of')
      .eq('user_id', user.id)
      .order('week_of', { ascending: false }),

    // Completed tasks
    supabase
      .from('artist_project_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'completed'),

    // Profile data
    supabase
      .from('profiles')
      .select('total_xp, artist_level, daily_streak, display_name, genre, career_stage, profile_picture_url, public_profile_slug, role')
      .eq('user_id', user.id)
      .single(),

    // Session notes by this user
    supabase
      .from('session_notes')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', user.id),

    // Beat purchases by this user
    service
      .from('beat_purchases')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_id', user.id),

    // Calendar events created by this user
    supabase
      .from('calendar_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),

    // Platform connections (Spotify, YouTube, etc.)
    supabase
      .from('platform_connections')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),

    // Existing achievements
    supabase
      .from('artist_achievements')
      .select('achievement_key')
      .eq('user_id', user.id),

    // Producer: beats uploaded with IDs (for purchase lookups)
    isProducer && profileId
      ? service.from('beats').select('id, total_lease_revenue').eq('producer_id', profileId).neq('status', 'rejected')
      : Promise.resolve({ count: 0, data: null, error: null }),

    // Placeholders — producer purchases queried separately below
    Promise.resolve({ data: null, error: null }),
    Promise.resolve({ data: null, error: null }),

    // Engineer: media sales (sold_by matches engineer name)
    isEngineer && engineerConfig
      ? service.from('media_sales').select('id', { count: 'exact', head: true }).eq('sold_by', engineerConfig.name)
      : Promise.resolve({ count: 0, data: null, error: null }),

    // Private sales completed (created by this user's profile)
    isProducer && profileId
      ? service.from('private_beat_sales').select('id', { count: 'exact', head: true }).eq('created_by', profileId).eq('status', 'completed')
      : Promise.resolve({ count: 0, data: null, error: null }),

    // Engineer: all completed bookings with amounts (for revenue calc)
    isEngineer && engineerConfig
      ? service.from('bookings').select('total_amount').eq('engineer_name', engineerConfig.name).eq('status', 'completed')
      : Promise.resolve({ data: null, error: null }),

    // Placeholder — producer revenue computed from beats query above
    Promise.resolve({ data: null, error: null }),
  ]);

  // Filter out sessions where the user was the engineer, not the client
  const clientSessions = isEngineer && engineerConfig
    ? (sessionsResult.data || []).filter(
        (b: { engineer_name: string | null }) => b.engineer_name !== engineerConfig.name
      )
    : (sessionsResult.data || []);
  const completedSessions = clientSessions.length;
  const engineerSessions = (engineerSessionsResult as { count: number | null }).count || 0;

  const totalProjects = projectsResult.count || 0;
  const completedProjects = completedProjectsResult.count || 0;
  const totalGoals = goalsResult.count || 0;
  const completedGoals = completedGoalsResult.count || 0;
  const metricCount = metricsResult.data?.length || 0;
  const completedTasks = tasksResult.count || 0;
  const profile = profileData;
  const sessionNotesCount = sessionNotesResult.count || 0;
  const beatPurchaseCount = beatPurchasesResult.count || 0;
  const calendarEventCount = calendarEventsResult.count || 0;
  const platformConnectionCount = platformConnectionsResult.count || 0;
  const hasPublicProfile = !!profile?.public_profile_slug;

  // Producer data
  const producerBeats = producerBeatsResult.data as { id: string; total_lease_revenue: number }[] | null;
  const producerBeatCount = producerBeats?.length || 0;
  const producerBeatIds = producerBeats?.map(b => b.id) || [];

  // Query producer's beat purchases (leases + exclusives) using beat IDs
  let producerLeaseCount = 0;
  let producerExclusiveCount = 0;
  let producerBeatRevenue = 0;
  if (isProducer && producerBeatIds.length > 0) {
    const { data: producerPurchases } = await service
      .from('beat_purchases')
      .select('license_type, amount_paid')
      .in('beat_id', producerBeatIds);
    if (producerPurchases) {
      for (const p of producerPurchases) {
        if (p.license_type === 'exclusive') {
          producerExclusiveCount++;
        } else {
          producerLeaseCount++;
        }
        producerBeatRevenue += p.amount_paid || 0;
      }
    }
  }

  // Engineer media sales
  const engineerMediaSalesCount = (engineerMediaSalesResult as unknown as { count: number | null }).count || 0;

  // Private sales
  const privateSaleCount = (privateSalesResult as unknown as { count: number | null }).count || 0;

  // Revenue calculation (in cents)
  // Engineer revenue: 60% of session total_amount
  let totalEarnings = 0;
  if (isEngineer && engineerBookingsResult.data) {
    const bookingsData = engineerBookingsResult.data as unknown as { total_amount: number }[];
    const sessionRevenue = bookingsData.reduce((s, b) => s + b.total_amount, 0);
    totalEarnings += Math.round(sessionRevenue * 0.6); // 60% engineer cut
  }
  // Producer revenue: 60% of beat sales
  if (isProducer) {
    totalEarnings += Math.round(producerBeatRevenue * 0.6); // 60% producer cut
  }
  const totalEarningsDollars = totalEarnings / 100;

  const existingKeys = new Set(
    ((existingAchievementsResult.data || []) as unknown as { achievement_key: string }[]).map((a) => a.achievement_key)
  );

  // Calculate metric weeks streak (consecutive weeks)
  let metricWeeksStreak = 0;
  if (metricsResult.data && metricsResult.data.length > 0) {
    metricWeeksStreak = 1;
    const weeks = metricsResult.data.map((m) => new Date(m.week_of).getTime());
    for (let i = 1; i < weeks.length; i++) {
      const diff = weeks[i - 1] - weeks[i]; // sorted desc
      // ~7 days in ms (allow some slack: 5-9 days)
      if (diff >= 5 * 86400000 && diff <= 9 * 86400000) {
        metricWeeksStreak++;
      } else {
        break;
      }
    }
  }

  // career_stage retired (computed by the career engine now) — bio replaces
  // it here, matching the s1_brand gate (photo + bio).
  const { data: bioRow } = await service.from('profiles')
    .select('bio').eq('user_id', user.id).maybeSingle();
  const profileComplete = !!(
    profile?.display_name &&
    profile?.genre &&
    (bioRow as { bio?: string | null } | null)?.bio &&
    profile?.profile_picture_url
  );

  // Reward: completing your profile earns the one-time 'cust_profile_complete'
  // grant (1 free studio hour, approval-gated). This is the ONLY trigger for the
  // event-driven 'profile_complete' counter — the window sweeps skip one_time rules.
  // Idempotent + one-per-real-person: grantEventReward no-ops if the user already
  // holds this grant (any status). Never auto-issues — it lands 'pending_approval'
  // per the rule's issuance='approval', so an admin approves the free hour.
  // Best-effort: a rewards hiccup must not break achievement/XP processing.
  if (profileComplete) {
    try {
      await grantEventReward(service, 'cust_profile_complete', { userId: user.id }, { source: 'achievements-check' });
    } catch {
      // swallow — rewards are a side-effect of this check, not its contract
    }
  }

  const artistLevel = profile?.artist_level || 0;
  const dailyStreak = profile?.daily_streak || 0;

  // Achievement conditions map — artist achievements (session-based ones only count CLIENT sessions)
  const conditions: Record<string, boolean> = {
    // Artist session achievements (excludes sessions where user was the engineer)
    first_session: completedSessions >= 1,
    five_sessions: completedSessions >= 5,
    ten_sessions: completedSessions >= 10,
    twenty_five_sessions: completedSessions >= 25,

    // Engineer-specific achievements (only for engineers)
    ...(isEngineer ? {
      eng_first_session: engineerSessions >= 1,
      eng_five_sessions: engineerSessions >= 5,
      eng_ten_sessions: engineerSessions >= 10,
      eng_twenty_five_sessions: engineerSessions >= 25,
      eng_fifty_sessions: engineerSessions >= 50,
      eng_hundred_sessions: engineerSessions >= 100,
      eng_first_media_sale: engineerMediaSalesCount >= 1,
      eng_five_media_sales: engineerMediaSalesCount >= 5,
    } : {}),

    // Producer achievements (only for producers)
    ...(isProducer ? {
      first_beat_upload: producerBeatCount >= 1,
      five_beats_uploaded: producerBeatCount >= 5,
      ten_beats_uploaded: producerBeatCount >= 10,
      first_lease_sold: producerLeaseCount >= 1,
      five_leases_sold: producerLeaseCount >= 5,
      twenty_five_leases_sold: producerLeaseCount >= 25,
      first_exclusive_sold: producerExclusiveCount >= 1,
      five_exclusives_sold: producerExclusiveCount >= 5,
      first_private_sale: privateSaleCount >= 1,
    } : {}),

    // Revenue milestones (for anyone who earns — engineers, producers)
    ...((isEngineer || isProducer) ? {
      earned_500: totalEarningsDollars >= 500,
      earned_2500: totalEarningsDollars >= 2500,
      earned_10000: totalEarningsDollars >= 10000,
      earned_25000: totalEarningsDollars >= 25000,
    } : {}),

    first_project: totalProjects >= 1,
    first_release: completedProjects >= 1,
    five_releases: completedProjects >= 5,
    ten_releases: completedProjects >= 10,
    first_metric_log: metricCount >= 1,
    four_week_streak: metricWeeksStreak >= 4,
    twelve_week_streak: metricWeeksStreak >= 12,
    first_goal_set: totalGoals >= 1,
    first_goal_completed: completedGoals >= 1,
    five_goals_completed: completedGoals >= 5,
    profile_complete: profileComplete,
    public_profile: hasPublicProfile,
    first_beat_purchase: beatPurchaseCount >= 1,
    first_session_notes: sessionNotesCount >= 1,
    first_calendar_event: calendarEventCount >= 1,
    connect_platform: platformConnectionCount >= 1,
    level_5: artistLevel >= 5,
    level_10: artistLevel >= 10,
    level_25: artistLevel >= 25,
    level_50: artistLevel >= 50,
    seven_day_streak: dailyStreak >= 7,
    thirty_day_streak: dailyStreak >= 30,
    hundred_tasks: completedTasks >= 100,
  };

  const newAchievements: string[] = [];
  let totalXpAwarded = 0;

  for (const [key, met] of Object.entries(conditions)) {
    if (met && !existingKeys.has(key) && ACHIEVEMENTS[key]) {
      // Use upsert with onConflict to prevent duplicate inserts
      // If the achievement already exists (race condition), this is a no-op
      const { error: insertError } = await supabase.from('artist_achievements').upsert({
        user_id: user.id,
        achievement_key: key,
      }, { onConflict: 'user_id,achievement_key', ignoreDuplicates: true });

      // Only count XP if the insert actually succeeded (not a duplicate)
      if (!insertError) {
        // Double-check it was actually inserted (not already there from a race)
        const { count } = await supabase
          .from('artist_achievements')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('achievement_key', key);

        // Only award XP if this is genuinely new (check xp_log for prior award)
        const { count: priorXpCount } = await supabase
          .from('xp_log')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('action', 'unlock_achievement')
          .eq('reference_id', `achievement_${key}`);

        if (count && count > 0 && (!priorXpCount || priorXpCount === 0)) {
          newAchievements.push(key);
          totalXpAwarded += ACHIEVEMENTS[key].xp;
        }
      }
    }
  }

  // Award XP for genuinely new achievements using atomic SQL increment
  if (totalXpAwarded > 0) {
    // Atomic increment — prevents race condition where two requests read same value
    try {
      await supabase.rpc('increment_xp', {
        p_user_id: user.id,
        p_xp_amount: totalXpAwarded,
      });
      // Recalculate level from the updated total
      const { data: updatedProfile } = await supabase
        .from('profiles')
        .select('total_xp')
        .eq('user_id', user.id)
        .single();
      if (updatedProfile) {
        const levelInfo = calculateLevel(updatedProfile.total_xp);
        await supabase.from('profiles').update({ artist_level: levelInfo.level }).eq('user_id', user.id);
      }
    } catch {
      // Fallback if RPC doesn't exist — use regular update
      const { data: freshProfile } = await supabase
        .from('profiles')
        .select('total_xp')
        .eq('user_id', user.id)
        .single();
      const currentXp = freshProfile?.total_xp || 0;
      const newTotal = currentXp + totalXpAwarded;
      const levelInfo = calculateLevel(newTotal);
      await supabase.from('profiles').update({ total_xp: newTotal, artist_level: levelInfo.level }).eq('user_id', user.id);
    }

    // Log XP entries with reference_id for deduplication
    const xpLogs = newAchievements.map((key) => ({
      user_id: user.id,
      action: 'unlock_achievement',
      xp_amount: ACHIEVEMENTS[key].xp,
      label: `Unlocked: ${ACHIEVEMENTS[key].title}`,
      reference_id: `achievement_${key}`,
      metadata: { achievement: key },
    }));

    if (xpLogs.length > 0) {
      // ignoreDuplicates so a concurrent grant's 23505 (083 unique index) on
      // one row can't abort the whole batch and silently drop siblings whose
      // XP was already totaled above.
      await supabase.from('xp_log').upsert(xpLogs, {
        onConflict: 'user_id,action,reference_id', ignoreDuplicates: true,
      });
    }
  }

  // Return progress data so the UI can show "3/5 sessions" etc.
  const progress: Record<string, { current: number; target: number }> = {
    first_session: { current: Math.min(completedSessions, 1), target: 1 },
    five_sessions: { current: Math.min(completedSessions, 5), target: 5 },
    ten_sessions: { current: Math.min(completedSessions, 10), target: 10 },
    twenty_five_sessions: { current: Math.min(completedSessions, 25), target: 25 },
    first_project: { current: Math.min(totalProjects, 1), target: 1 },
    first_release: { current: Math.min(completedProjects, 1), target: 1 },
    five_releases: { current: Math.min(completedProjects, 5), target: 5 },
    ten_releases: { current: Math.min(completedProjects, 10), target: 10 },
    first_metric_log: { current: Math.min(metricCount, 1), target: 1 },
    four_week_streak: { current: Math.min(metricWeeksStreak, 4), target: 4 },
    twelve_week_streak: { current: Math.min(metricWeeksStreak, 12), target: 12 },
    first_goal_set: { current: Math.min(totalGoals, 1), target: 1 },
    first_goal_completed: { current: Math.min(completedGoals, 1), target: 1 },
    five_goals_completed: { current: Math.min(completedGoals, 5), target: 5 },
    first_beat_purchase: { current: Math.min(beatPurchaseCount, 1), target: 1 },
    first_calendar_event: { current: Math.min(calendarEventCount, 1), target: 1 },
    connect_platform: { current: Math.min(platformConnectionCount, 1), target: 1 },
    level_5: { current: Math.min(artistLevel, 5), target: 5 },
    level_10: { current: Math.min(artistLevel, 10), target: 10 },
    level_25: { current: Math.min(artistLevel, 25), target: 25 },
    level_50: { current: Math.min(artistLevel, 50), target: 50 },
    seven_day_streak: { current: Math.min(dailyStreak, 7), target: 7 },
    thirty_day_streak: { current: Math.min(dailyStreak, 30), target: 30 },
    hundred_tasks: { current: Math.min(completedTasks, 100), target: 100 },
    ...(isEngineer ? {
      eng_first_session: { current: Math.min(engineerSessions, 1), target: 1 },
      eng_five_sessions: { current: Math.min(engineerSessions, 5), target: 5 },
      eng_ten_sessions: { current: Math.min(engineerSessions, 10), target: 10 },
      eng_twenty_five_sessions: { current: Math.min(engineerSessions, 25), target: 25 },
      eng_fifty_sessions: { current: Math.min(engineerSessions, 50), target: 50 },
      eng_hundred_sessions: { current: Math.min(engineerSessions, 100), target: 100 },
      eng_first_media_sale: { current: Math.min(engineerMediaSalesCount, 1), target: 1 },
      eng_five_media_sales: { current: Math.min(engineerMediaSalesCount, 5), target: 5 },
    } : {}),
    ...(isProducer ? {
      first_beat_upload: { current: Math.min(producerBeatCount, 1), target: 1 },
      five_beats_uploaded: { current: Math.min(producerBeatCount, 5), target: 5 },
      ten_beats_uploaded: { current: Math.min(producerBeatCount, 10), target: 10 },
      first_lease_sold: { current: Math.min(producerLeaseCount, 1), target: 1 },
      five_leases_sold: { current: Math.min(producerLeaseCount, 5), target: 5 },
      twenty_five_leases_sold: { current: Math.min(producerLeaseCount, 25), target: 25 },
      first_exclusive_sold: { current: Math.min(producerExclusiveCount, 1), target: 1 },
      five_exclusives_sold: { current: Math.min(producerExclusiveCount, 5), target: 5 },
      first_private_sale: { current: Math.min(privateSaleCount, 1), target: 1 },
    } : {}),
    ...((isEngineer || isProducer) ? {
      earned_500: { current: Math.min(Math.round(totalEarningsDollars), 500), target: 500 },
      earned_2500: { current: Math.min(Math.round(totalEarningsDollars), 2500), target: 2500 },
      earned_10000: { current: Math.min(Math.round(totalEarningsDollars), 10000), target: 10000 },
      earned_25000: { current: Math.min(Math.round(totalEarningsDollars), 25000), target: 25000 },
    } : {}),
  };

  return NextResponse.json({ newAchievements, totalXpAwarded, progress });
}
