import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { PRICING, SITE_URL, ROOM_LABELS, type Room } from '@/lib/constants';
import { formatDuration } from '@/lib/utils';

// Client pays deposit for an invited booking via Stripe Checkout
export async function POST(request: NextRequest) {
  try {
    const { bookingId, token } = await request.json();

    if (!bookingId || !token) {
      return NextResponse.json({ error: 'Missing bookingId or token' }, { status: 400 });
    }

    // Require authenticated user — sessions need a real account
    const authClient = await createClient();
    const { data: { user: authUser } } = await authClient.auth.getUser();
    if (!authUser) {
      return NextResponse.json({ error: 'You must be signed in to pay for a session.' }, { status: 401 });
    }

    const supabase = createServiceClient();

    const { data: booking, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (error || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Validate token
    if (!booking.admin_notes || !booking.admin_notes.includes(`Token: ${token}`)) {
      return NextResponse.json({ error: 'Invalid invite token' }, { status: 403 });
    }

    // If already confirmed, tell the client — don't show an error
    if (booking.status === 'confirmed') {
      return NextResponse.json({ alreadyConfirmed: true, message: 'Session already confirmed' });
    }

    // Must be pending (invites use 'pending_deposit' status)
    if (booking.status !== 'pending' && booking.status !== 'pending_deposit') {
      return NextResponse.json({ error: 'This booking has been cancelled. Please contact the studio for a new invite.' }, { status: 400 });
    }

    const roomLabel = ROOM_LABELS[booking.room as Room] || booking.room;
    const startDate = new Date(booking.start_time);
    const dateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const timeStr = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

    // Link booking to the authenticated user's real account info
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, email')
      .eq('id', authUser.id)
      .single();

    const realName = profile?.display_name || authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Client';
    const realEmail = authUser.email || booking.customer_email;

    // Update booking with real account info (replaces "Pending Invite" / "Invited: ...")
    await supabase
      .from('bookings')
      .update({
        customer_name: realName,
        customer_email: realEmail,
      })
      .eq('id', bookingId);

    // Find or create Stripe customer — use the authenticated user's email
    const email = realEmail;
    let customerId: string | undefined;
    if (email) {
      const customers = await stripe.customers.list({ email, limit: 1 });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email,
          name: booking.customer_name || undefined,
        });
        customerId = customer.id;
      }
    }

    // Build line items — split session vs media if add-ons exist
    const mediaAddons = booking.media_addons;
    let lineItems: Array<{ price_data: { currency: string; product_data: { name: string; description?: string }; unit_amount: number }; quantity: number }>;

    if (mediaAddons && Array.isArray(mediaAddons) && mediaAddons.length > 0) {
      const mediaTotal = mediaAddons.reduce((sum: number, a: { amount: number }) => sum + a.amount, 0);
      const sessionTotal = booking.total_amount - mediaTotal;
      // Proportional deposit split
      const sessionDeposit = booking.total_amount > 0
        ? Math.round((sessionTotal / booking.total_amount) * booking.deposit_amount)
        : 0;
      const mediaDeposit = booking.deposit_amount - sessionDeposit;

      lineItems = [
        {
          price_data: {
            currency: PRICING.currency,
            product_data: {
              name: `Recording Session Deposit — ${roomLabel}`,
              description: `${formatDuration(booking.duration)} session on ${dateStr} at ${timeStr}`,
            },
            unit_amount: sessionDeposit,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: PRICING.currency,
            product_data: {
              name: `Media Add-ons Deposit`,
              description: mediaAddons.map((a: { description?: string; type: string }) => a.description || a.type).join(', '),
            },
            unit_amount: mediaDeposit,
          },
          quantity: 1,
        },
      ];
    } else {
      lineItems = [
        {
          price_data: {
            currency: PRICING.currency,
            product_data: {
              name: `Recording Session Deposit — ${roomLabel}`,
              description: `${formatDuration(booking.duration)} session on ${dateStr} at ${timeStr} (50% deposit)`,
            },
            unit_amount: booking.deposit_amount,
          },
          quantity: 1,
        },
      ];
    }

    // Create Stripe Checkout Session for the deposit
    // NOTE: setup_future_usage is card-only. Cash App Pay, Venmo, etc. do NOT support
    // saving for future charges. Setting it at the payment_intent_data level breaks
    // non-card payment methods (checkout never completes, webhook never fires).
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: lineItems,
      payment_method_options: {
        card: {
          setup_future_usage: 'off_session',
        },
      },
      success_url: `${SITE_URL}/book/invite/${token}?booking=${bookingId}&paid=1`,
      cancel_url: `${SITE_URL}/book/invite/${token}?booking=${bookingId}`,
      metadata: {
        type: 'invite_deposit',
        booking_id: bookingId,
        invite_token: token,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Invite payment error:', error);
    return NextResponse.json({ error: 'Failed to create payment session' }, { status: 500 });
  }
}
