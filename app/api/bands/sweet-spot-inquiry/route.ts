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
 * Uses the same TURNSTILE_SECRET_KEY already in production for /api/contact.
 */

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, bandName, email, phone, preferredTime, message, turnstileToken } = body;

    // Required field validation — mirror the form's `required` attributes so
    // a direct POST (bypassing the form) gets the same rejection.
    if (!name || !bandName || !email || !phone || !preferredTime) {
      return NextResponse.json(
        { error: 'Name, band name, email, phone, and preferred time are required' },
        { status: 400 },
      );
    }

    // Cloudflare Turnstile — BEST EFFORT (verify only when the secret + a token are
    // both present). A missing secret or a broken widget must never block a real
    // band inquiry; protection resumes once TURNSTILE_SECRET_KEY is configured.
    if (TURNSTILE_SECRET && turnstileToken) {
      try {
        const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: TURNSTILE_SECRET, response: turnstileToken }),
        });
        const verifyData = await verifyRes.json();
        if (!verifyData.success) {
          console.error('Turnstile verification failed (sweet spot inquiry):', verifyData['error-codes']);
          return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
        }
      } catch (e) {
        console.warn('[sweet-spot] Turnstile verify errored — allowing inquiry through:', e);
      }
    } else if (!TURNSTILE_SECRET) {
      console.warn('[sweet-spot] TURNSTILE_SECRET_KEY not configured — skipping CAPTCHA verification.');
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
