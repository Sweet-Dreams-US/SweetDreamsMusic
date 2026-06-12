import { NextRequest, NextResponse } from 'next/server';
import { sendContactForm } from '@/lib/email';

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;

export async function POST(request: NextRequest) {
  try {
    const { name, email, phone, message, company, turnstileToken } = await request.json();

    if (!name || !email || !message) {
      return NextResponse.json({ error: 'Name, email, and message are required' }, { status: 400 });
    }

    // Honeypot: real users never fill the hidden "company" field. If it's set,
    // it's a bot — silently accept (so it doesn't retry) but drop the message.
    if (company && String(company).trim()) {
      return NextResponse.json({ success: true });
    }

    // Cloudflare Turnstile — verify when both the secret and a token are present.
    // A missing secret or a widget that failed to load won't hard-block (the
    // honeypot is the backstop); a token that's present but INVALID is rejected.
    if (TURNSTILE_SECRET && turnstileToken) {
      try {
        const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: TURNSTILE_SECRET, response: turnstileToken }),
        });
        const verifyData = await verifyRes.json();
        if (!verifyData.success) {
          console.error('Turnstile verification failed:', verifyData['error-codes']);
          return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
        }
      } catch (e) {
        console.warn('[contact] Turnstile verify errored — allowing message through:', e);
      }
    }

    await sendContactForm({
      name,
      email,
      subject: phone ? `${name} (${phone})` : name,
      message,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Contact form error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
