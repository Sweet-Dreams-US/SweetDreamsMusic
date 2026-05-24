import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sendPaymentReminder } from '@/lib/email';
import { ROOM_LABELS, TIMEZONE, type Room } from '@/lib/constants';
import { formatDuration } from '@/lib/utils';

export const maxDuration = 30;

// Vercel Cron — runs every hour
// Finds completed sessions with unpaid remainder where 12+ hours have passed
// Sends a friendly payment reminder email to the customer
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Find completed sessions with unpaid balance, 12+ hours old, reminder not yet sent
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  const { data: unpaidBookings, error } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_email, start_time, duration, room, total_amount, actual_deposit_paid, remainder_amount')
    .eq('status', 'completed')
    .gt('remainder_amount', 0)
    .eq('payment_reminder_sent', false)
    .lt('start_time', twelveHoursAgo)
    .order('start_time', { ascending: false });

  if (error) {
    console.error('Payment reminder cron error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!unpaidBookings || unpaidBookings.length === 0) {
    return NextResponse.json({ message: 'No unpaid sessions to remind', count: 0 });
  }

  let sentCount = 0;

  for (const booking of unpaidBookings) {
    if (!booking.customer_email) continue;

    // Format session date for the email
    const sessionDate = new Date(booking.start_time).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: TIMEZONE,
    });

    const amountPaid = booking.total_amount - booking.remainder_amount;

    try {
      // Create a payment link for convenience
      const { stripe } = await import('@/lib/stripe');
      const roomLabel = ROOM_LABELS[booking.room as Room] || booking.room;

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Session Balance — ${sessionDate} · ${roomLabel}`,
              description: `Remaining balance for your ${formatDuration(booking.duration)} session`,
            },
            unit_amount: booking.remainder_amount,
          },
          quantity: 1,
        }],
        customer_email: booking.customer_email,
        metadata: {
          type: 'session_remainder',
          booking_id: booking.id,
        },
        success_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://sweetdreamsmusic.com'}/book?paid=true`,
        cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://sweetdreamsmusic.com'}/book`,
      });

      await sendPaymentReminder(booking.customer_email, {
        customerName: booking.customer_name || 'there',
        sessionDate,
        duration: booking.duration,
        room: booking.room || 'Studio',
        totalAmount: booking.total_amount,
        amountPaid,
        remainingAmount: booking.remainder_amount,
        paymentLink: session.url || undefined,
      });

      // Mark reminder as sent
      await supabase
        .from('bookings')
        .update({ payment_reminder_sent: true })
        .eq('id', booking.id);

      sentCount++;
    } catch (e) {
      console.error(`Failed to send payment reminder for booking ${booking.id}:`, e);
    }
  }

  return NextResponse.json({ message: `Sent ${sentCount} payment reminder(s)`, count: sentCount });
}
