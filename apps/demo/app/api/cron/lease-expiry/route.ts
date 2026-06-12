import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sendLeaseExpiryWarning, sendLeaseExpiredNotice } from '@/lib/email';
import { RENEWAL_DISCOUNT } from '@/lib/constants';
import { fmtStampDate } from '@/lib/studio-time';

export const maxDuration = 30;

// Vercel Cron — runs daily
// 1. Sends 30-day warning emails for leases expiring soon
// 2. Sends expired notice for leases past their expiry date
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const thirtyDaysFromNow = new Date(now);
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  let warningsSent = 0;
  let expiredSent = 0;

  // 1. Send 30-day warning for leases expiring within 30 days
  const { data: expiringLeases } = await supabase
    .from('beat_purchases')
    .select('id, buyer_email, license_type, amount_paid, lease_expires_at, expiry_warning_sent, renewal_blocked, beat_id, beats(title, producer)')
    .not('lease_expires_at', 'is', null)
    .lte('lease_expires_at', thirtyDaysFromNow.toISOString())
    .gt('lease_expires_at', now.toISOString())
    .eq('expiry_warning_sent', false)
    .is('revoked_at', null)
    .in('license_type', ['mp3_lease', 'trackout_lease']);

  if (expiringLeases) {
    for (const lease of expiringLeases) {
      if (!lease.buyer_email) continue;
      const beat = Array.isArray(lease.beats) ? lease.beats[0] : lease.beats;
      try {
        await sendLeaseExpiryWarning(lease.buyer_email, {
          buyerName: lease.buyer_email.split('@')[0] || 'there',
          beatTitle: (beat as { title: string })?.title || 'Beat',
          producerName: (beat as { producer: string })?.producer || 'Producer',
          licenseType: lease.license_type === 'mp3_lease' ? 'MP3 Lease' : 'Trackout Lease',
          // lease_expires_at is a true-UTC *_at instant → convert to Eastern (fmtStamp*)
          expiresAt: fmtStampDate(lease.lease_expires_at!, { month: 'long', day: 'numeric', year: 'numeric' }),
          renewalPrice: Math.round(lease.amount_paid * RENEWAL_DISCOUNT),
        });
        await supabase.from('beat_purchases').update({ expiry_warning_sent: true }).eq('id', lease.id);
        warningsSent++;
      } catch (e) { console.error(`Expiry warning error for ${lease.buyer_email}:`, e); }
    }
  }

  // 2. Send expired notice for leases past their expiry date
  const { data: expiredLeases } = await supabase
    .from('beat_purchases')
    .select('id, buyer_email, license_type, amount_paid, lease_expires_at, renewal_blocked, beat_id, beats(title, producer)')
    .not('lease_expires_at', 'is', null)
    .lt('lease_expires_at', now.toISOString())
    .eq('expiry_notice_sent', false)
    .is('revoked_at', null)
    .in('license_type', ['mp3_lease', 'trackout_lease']);

  if (expiredLeases) {
    for (const lease of expiredLeases) {
      if (!lease.buyer_email) continue;
      const beat = Array.isArray(lease.beats) ? lease.beats[0] : lease.beats;
      try {
        await sendLeaseExpiredNotice(lease.buyer_email, {
          buyerName: lease.buyer_email.split('@')[0] || 'there',
          beatTitle: (beat as { title: string })?.title || 'Beat',
          producerName: (beat as { producer: string })?.producer || 'Producer',
          licenseType: lease.license_type === 'mp3_lease' ? 'MP3 Lease' : 'Trackout Lease',
          renewalPrice: Math.round(lease.amount_paid * RENEWAL_DISCOUNT),
          canRenew: !lease.renewal_blocked,
        });
        await supabase.from('beat_purchases').update({ expiry_notice_sent: true }).eq('id', lease.id);
        expiredSent++;
      } catch (e) { console.error(`Expired notice error for ${lease.buyer_email}:`, e); }
    }
  }

  return NextResponse.json({ warningsSent, expiredSent });
}
