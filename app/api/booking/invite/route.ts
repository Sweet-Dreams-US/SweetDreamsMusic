import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { SITE_URL, ENGINEERS, PRICING } from '@/lib/constants';
import { parseTimeSlot } from '@/lib/utils';
import { verifyEngineerAccess } from '@/lib/admin-auth';
import { sendSessionInvite } from '@/lib/email';

// Engineer creates a session and generates an invite link
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const hasAccess = await verifyEngineerAccess(supabase);

    if (!hasAccess) {
      return NextResponse.json({ error: 'Engineers and admins only' }, { status: 403 });
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const {
      date, startTime, duration, room,
      totalAmount, depositAmount,
      clientEmail, clientName, artistName, notes,
      paymentMethod, customPrice, mediaAddons,
    } = body;

    if (!date || !startTime || !duration || !room || !totalAmount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!clientName || !clientEmail) {
      return NextResponse.json({ error: 'Client name and email are required. Select a client from the library or enter their info manually.' }, { status: 400 });
    }

    // Use service client for DB operations (bypasses RLS — auth already verified above)
    const serviceClient = createServiceClient();

    // Auto-assign engineer from the creating user
    const engineerConfig = ENGINEERS.find(e => e.email.toLowerCase() === user.email!.toLowerCase());
    const engineerName = engineerConfig?.name || null;

    const startDec = parseTimeSlot(startTime);
    const endDec = (startDec + duration) % 24;
    const endTime = `${Math.floor(endDec)}:${endDec % 1 >= 0.5 ? '30' : '00'}`;

    const inviteToken = crypto.randomUUID();

    if (paymentMethod === 'cash') {
      // Cash invite — created as pending_deposit (NOT auto-confirmed). The slot
      // is NOT held until the engineer records the cash (which flips it to
      // 'confirmed' via /api/booking/record-payment). Deposit target is 50%,
      // mirroring the online flow; the engineer can record any amount.
      const cashDeposit = depositAmount && depositAmount > 0
        ? depositAmount
        : Math.round(totalAmount * PRICING.depositPercent / 100);
      const { data: booking, error } = await serviceClient
        .from('bookings')
        .insert({
          customer_name: clientName,
          customer_email: clientEmail,
          artist_name: artistName || null,
          start_time: `${date}T${startTime}:00+00:00`,
          end_time: `${date}T${endTime}:00+00:00`,
          duration,
          room,
          engineer_name: engineerName,
          created_by_email: user.email,
          total_amount: totalAmount,
          deposit_amount: cashDeposit,
          remainder_amount: totalAmount - cashDeposit,
          actual_deposit_paid: 0,
          deposit_method: 'cash',
          media_addons: mediaAddons || null,
          status: 'pending_deposit',
          admin_notes: `Cash invite created by ${user.email}. Token: ${inviteToken}. ${customPrice ? `Custom price: $${(customPrice / 100).toFixed(2)}. ` : ''}${notes || ''}`,
        })
        .select('id')
        .single();

      if (error) {
        console.error('Failed to create cash booking:', JSON.stringify(error));
        return NextResponse.json({ error: `Failed to create booking: ${error.message}` }, { status: 500 });
      }

      // Create media_sales records for cash bookings with media add-ons
      if (mediaAddons && Array.isArray(mediaAddons) && mediaAddons.length > 0) {
        for (const addon of mediaAddons) {
          await serviceClient.from('media_sales').insert({
            description: addon.description || addon.type,
            amount: addon.amount,
            sale_type: addon.type,
            sold_by: addon.sold_by || null,
            filmed_by: addon.filmed_by || null,
            edited_by: addon.edited_by || null,
            client_name: clientName,
            client_email: clientEmail,
            booking_id: booking.id,
            notes: `From session invite (cash)`,
          });
        }
      }

      const inviteUrl = `${SITE_URL}/book/invite/${inviteToken}?booking=${booking.id}`;

      // Send invite email if client email provided
      if (clientEmail) {
        try {
          const startDate = new Date(`${date}T${startTime}:00+00:00`);
          const dateStr = startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
          const timeStr = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

          await sendSessionInvite(clientEmail, {
            customerName: clientName || 'Client',
            engineerName: engineerConfig?.displayName || engineerName || 'Your engineer',
            date: dateStr,
            startTime: timeStr,
            duration,
            room,
            total: totalAmount,
            deposit: cashDeposit,
            inviteUrl,
            isCash: true,
          });
        } catch (emailErr) {
          console.error('Failed to send invite email:', emailErr);
        }
      }

      return NextResponse.json({ inviteUrl, bookingId: booking.id });
    }

    // Online payment — create pending booking, client pays deposit via invite link
    const { data: booking, error } = await serviceClient
      .from('bookings')
      .insert({
        customer_name: clientName,
        customer_email: clientEmail,
        artist_name: artistName || null,
        start_time: `${date}T${startTime}:00+00:00`,
        end_time: `${date}T${endTime}:00+00:00`,
        duration,
        room,
        engineer_name: engineerName,
        created_by_email: user.email,
        total_amount: totalAmount,
        deposit_amount: depositAmount,
        remainder_amount: totalAmount - depositAmount,
        deposit_method: 'card',
        media_addons: mediaAddons || null,
        status: 'pending_deposit',
        admin_notes: `Invite created by ${user.email}. Token: ${inviteToken}. ${customPrice ? `Custom price: $${(customPrice / 100).toFixed(2)}. ` : ''}${notes || ''}`,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to create invite booking:', JSON.stringify(error));
      return NextResponse.json({ error: `Failed to create invite: ${error.message}` }, { status: 500 });
    }

    const inviteUrl = `${SITE_URL}/book/invite/${inviteToken}?booking=${booking.id}`;

    // Send invite email with payment link if client email provided
    if (clientEmail) {
      try {
        const startDate = new Date(`${date}T${startTime}:00+00:00`);
        const dateStr = startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
        const timeStr = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

        await sendSessionInvite(clientEmail, {
          customerName: clientName || 'Client',
          engineerName: engineerConfig?.displayName || engineerName || 'Your engineer',
          date: dateStr,
          startTime: timeStr,
          duration,
          room,
          total: totalAmount,
          deposit: depositAmount,
          inviteUrl,
          isCash: false,
        });
      } catch (emailErr) {
        console.error('Failed to send invite email:', emailErr);
      }
    }

    return NextResponse.json({ inviteUrl, bookingId: booking.id });
  } catch (error) {
    console.error('Invite creation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
