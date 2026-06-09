import { NextRequest, NextResponse } from 'next/server';
import { sendSweetSpotInquiry } from '@/lib/email';

/**
 * Sweet Spot inquiry endpoint.
 *
 * Clones the shape of /api/contact but:
 *   - Requires band name + phone + preferredTime (not just name/email/message)
 *   - Emails Jay and Cole specifically via sendSweetSpotInquiry()
 *   - Keeps the inquiry out of the general contact inbox so Sweet Spot leads
 *     are easy to filter and follow up on
 *
 * Spam protection is a honeypot (the hidden "company" field), matching /api/contact.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, bandName, email, phone, preferredTime, message, company } = body;

    // Required field validation — mirror the form's `required` attributes so
    // a direct POST (bypassing the form) gets the same rejection.
    if (!name || !bandName || !email || !phone || !preferredTime) {
      return NextResponse.json(
        { error: 'Name, band name, email, phone, and preferred time are required' },
        { status: 400 },
      );
    }

    // Honeypot: real bands never fill the hidden "company" field. If it's set,
    // it's a bot — silently accept (so it doesn't retry) but drop the inquiry.
    if (company && String(company).trim()) {
      return NextResponse.json({ success: true });
    }

    await sendSweetSpotInquiry({
      name: String(name).trim(),
      bandName: String(bandName).trim(),
      email: String(email).trim(),
      phone: String(phone).trim(),
      preferredTime: String(preferredTime).trim(),
      message: message ? String(message).trim() : '',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Sweet Spot inquiry error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
