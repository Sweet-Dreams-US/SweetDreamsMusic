import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  sendSessionReminder,
  sendSessionReminderToStaff,
  sendMediaSessionReminder,
  sendMediaSessionReminderToEngineer,
} from '@/lib/email';
import { ENGINEERS, SUPER_ADMINS, TIMEZONE } from '@/lib/constants';
import { SESSION_KIND_LABELS, type MediaSessionKind } from '@/lib/media-scheduling';
import { fmtSessionDate, fmtSessionTime } from '@/lib/studio-time';

export const maxDuration = 30;

// Vercel Cron — runs every 15 minutes
// Finds confirmed sessions starting in the next 45-75 minutes and sends reminders
//
// IMPORTANT: Session times are stored as LOCAL Fort Wayne time in UTC columns.
// e.g., a 10:30 PM session is stored as T22:30:00 regardless of timezone.
// We must compare against Fort Wayne local time, NOT UTC.
export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Get current Fort Wayne time as a comparable value
  // Since DB stores local FW time in UTC columns, we need to compare
  // using FW local time, not UTC
  const nowFW = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));

  // Window: 45 to 75 minutes from now in Fort Wayne time
  const windowStart = new Date(nowFW.getTime() + 45 * 60 * 1000);
  const windowEnd = new Date(nowFW.getTime() + 75 * 60 * 1000);

  // Format as ISO strings for DB comparison (these will match the stored local times)
  const windowStartISO = windowStart.toISOString();
  const windowEndISO = windowEnd.toISOString();

  console.log(`[CRON] Session reminder check — FW time: ${nowFW.toISOString()}, window: ${windowStartISO} to ${windowEndISO}`);

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_email, artist_name, start_time, duration, room, engineer_name, created_by_email, status')
    .eq('status', 'confirmed')
    .eq('reminder_sent', false)
    .gte('start_time', windowStartISO)
    .lte('start_time', windowEndISO);

  if (error) {
    console.error('[CRON] Failed to fetch bookings:', error);
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 });
  }

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ message: 'No reminders to send', count: 0 });
  }

  let sent = 0;

  for (const booking of bookings) {
    try {
      // bookings.start_time is wall-clock-as-UTC → read as UTC (fmtSession*)
      const dateStr = fmtSessionDate(booking.start_time, { weekday: 'long', month: 'long', day: 'numeric' });
      const timeStr = fmtSessionTime(booking.start_time);

      // Resolve actual client name — invites may store 'Pending Invite' as fallback
      const displayName = (booking.customer_name && !booking.customer_name.includes('Pending') && !booking.customer_name.includes('Invited:'))
        ? booking.customer_name
        : booking.artist_name || booking.customer_email || 'Client';

      // Check if session prep has been filled out
      const { data: prepData } = await supabase
        .from('session_prep')
        .select('completed')
        .eq('booking_id', booking.id)
        .maybeSingle();

      const hasPrep = !!prepData?.completed;

      // 1. Send reminder to client (if they have an email and it's not empty)
      if (booking.customer_email && booking.customer_email.trim()) {
        await sendSessionReminder(booking.customer_email, {
          customerName: displayName,
          artistName: booking.artist_name || null,
          date: dateStr,
          startTime: timeStr,
          room: booking.room || '',
          engineerName: booking.engineer_name || null,
          bookingId: booking.id,
          hasPrep,
        });
      }

      // 2. Send to admins and assigned/creating engineer
      const staffEmails = new Set<string>([...SUPER_ADMINS]);

      // Add the assigned engineer's email
      if (booking.engineer_name) {
        const eng = ENGINEERS.find(
          (e) => e.name === booking.engineer_name || e.displayName === booking.engineer_name
        );
        if (eng) staffEmails.add(eng.email);
      }

      // Add the engineer who created the invite
      if (booking.created_by_email) {
        staffEmails.add(booking.created_by_email);
      }

      // Build prep summary for staff email
      let prepSummary = null;
      if (prepData) {
        const fullPrep = await supabase
          .from('session_prep')
          .select('session_type, session_goals, beat_source, lyrics_status, reference_tracks')
          .eq('booking_id', booking.id)
          .maybeSingle();

        if (fullPrep.data) {
          prepSummary = {
            sessionType: fullPrep.data.session_type,
            goals: fullPrep.data.session_goals,
            beatSource: fullPrep.data.beat_source,
            lyricsStatus: fullPrep.data.lyrics_status,
            refCount: Array.isArray(fullPrep.data.reference_tracks) ? fullPrep.data.reference_tracks.length : 0,
          };
        }
      }

      await sendSessionReminderToStaff([...staffEmails], {
        customerName: displayName,
        customerEmail: booking.customer_email?.trim() || 'Not provided',
        artistName: booking.artist_name || null,
        date: dateStr,
        startTime: timeStr,
        duration: booking.duration,
        room: booking.room || '',
        engineerName: booking.engineer_name || 'Unassigned',
        prepSummary,
      });

      // 3. Mark reminder as sent
      await supabase
        .from('bookings')
        .update({ reminder_sent: true })
        .eq('id', booking.id);

      sent++;
      console.log(`[CRON] Reminder sent for booking ${booking.id} — ${booking.customer_name}`);
    } catch (err) {
      console.error(`[CRON] Failed to send reminder for booking ${booking.id}:`, err);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Phase E follow-up: media session reminders. Same time window, same
  // hour-before nudge — but pulled from `media_session_bookings` instead
  // of `bookings`. The shape is different (engineer_id FK, parent booking,
  // session_kind enum) so we run a separate loop rather than awkwardly
  // unifying the queries.
  //
  // Failure-isolated from the studio-booking loop above: if media reminders
  // fail, studio reminders still completed; if studio failed, we still try
  // media. Cron continues regardless.
  // ────────────────────────────────────────────────────────────────────
  let mediaSent = 0;
  try {
    const { data: mediaSessions, error: mediaErr } = await supabase
      .from('media_session_bookings')
      .select('id, parent_booking_id, starts_at, ends_at, session_kind, location, external_location_text, engineer_id, status')
      .eq('status', 'scheduled')
      .eq('reminder_sent', false)
      .gte('starts_at', windowStartISO)
      .lte('starts_at', windowEndISO);

    if (mediaErr) {
      console.error('[CRON] Failed to fetch media sessions:', mediaErr);
    } else if (mediaSessions && mediaSessions.length > 0) {
      type MediaRow = {
        id: string;
        parent_booking_id: string;
        starts_at: string;
        ends_at: string;
        session_kind: string;
        location: 'studio' | 'external';
        external_location_text: string | null;
        engineer_id: string;
      };
      const rows = mediaSessions as MediaRow[];

      // Hydrate parent → buyer email + name + offering title in one pass.
      const parentIds = Array.from(new Set(rows.map((r) => r.parent_booking_id)));
      const { data: parents } = await supabase
        .from('media_bookings')
        .select('id, user_id, offering_id')
        .in('id', parentIds);
      const parentMap = new Map<string, { user_id: string; offering_id: string }>();
      for (const p of (parents || []) as Array<{ id: string; user_id: string; offering_id: string }>) {
        parentMap.set(p.id, { user_id: p.user_id, offering_id: p.offering_id });
      }
      const buyerIds = Array.from(new Set([...parentMap.values()].map((p) => p.user_id)));
      const engineerIds = Array.from(new Set(rows.map((r) => r.engineer_id)));
      const [{ data: profiles }, { data: engineerProfiles }] = await Promise.all([
        buyerIds.length
          ? supabase.from('profiles').select('user_id, display_name, email').in('user_id', buyerIds)
          : Promise.resolve({ data: [] }),
        engineerIds.length
          ? supabase.from('profiles').select('user_id, display_name, email').in('user_id', engineerIds)
          : Promise.resolve({ data: [] }),
      ]);
      const profileMap = new Map<string, { display_name: string | null; email: string | null }>();
      for (const p of (profiles || []) as Array<{ user_id: string; display_name: string | null; email: string | null }>) {
        profileMap.set(p.user_id, p);
      }
      const engineerProfileMap = new Map<string, { display_name: string | null; email: string | null }>();
      for (const p of (engineerProfiles || []) as Array<{ user_id: string; display_name: string | null; email: string | null }>) {
        engineerProfileMap.set(p.user_id, p);
      }

      for (const session of rows) {
        try {
          const parent = parentMap.get(session.parent_booking_id);
          if (!parent) {
            console.warn(`[CRON] Media session ${session.id} missing parent — skipping`);
            continue;
          }
          const buyer = profileMap.get(parent.user_id);
          const buyerName =
            buyer?.display_name || buyer?.email?.split('@')[0] || 'there';

          // Engineer name resolution: prefer the canonical ENGINEERS roster
          // entry (matches what the rest of the system uses). Fall back to
          // their profile display_name.
          const engineerProfile = engineerProfileMap.get(session.engineer_id);
          const engineerEmail = engineerProfile?.email;
          const matchedRoster = engineerEmail
            ? ENGINEERS.find((e) => e.email.toLowerCase() === engineerEmail.toLowerCase())
            : null;
          const engineerName = matchedRoster?.displayName || engineerProfile?.display_name || 'Engineer';

          const kindLabel = SESSION_KIND_LABELS[session.session_kind as MediaSessionKind] || session.session_kind;

          // Buyer reminder
          if (buyer?.email) {
            await sendMediaSessionReminder(buyer.email, {
              buyerName,
              sessionKindLabel: kindLabel,
              startsAt: session.starts_at,
              endsAt: session.ends_at,
              location: session.location,
              externalLocationText: session.external_location_text,
              engineerName,
              bookingId: session.parent_booking_id,
            });
          }

          // Engineer reminder
          if (engineerEmail) {
            await sendMediaSessionReminderToEngineer(engineerEmail, {
              engineerName,
              buyerName,
              sessionKindLabel: kindLabel,
              startsAt: session.starts_at,
              endsAt: session.ends_at,
              location: session.location,
              externalLocationText: session.external_location_text,
            });
          }

          await supabase
            .from('media_session_bookings')
            .update({ reminder_sent: true })
            .eq('id', session.id);

          mediaSent++;
          console.log(`[CRON] Media session reminder sent for ${session.id} — ${kindLabel} for ${buyerName}`);
        } catch (err) {
          console.error(`[CRON] Failed to send media session reminder for ${session.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[CRON] Media session reminder loop crashed:', err);
  }

  return NextResponse.json({
    message: `Sent ${sent} studio reminders + ${mediaSent} media reminders`,
    count: sent + mediaSent,
    studio: sent,
    media: mediaSent,
  });
}
