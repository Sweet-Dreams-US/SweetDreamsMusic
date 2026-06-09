import { NextRequest, NextResponse } from 'next/server';
import { sendContactForm } from '@/lib/email';

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;

export async function POST(request: NextRequest) {
  try {
    const { name, email, phone, message, turnstileToken } = await request.json();

    if (!name || !email || !message) {
      return NextResponse.json({ error: 'Name, email, and message are required' }, { status: 400 });
    }

    // Cloudflare Turnstile — BEST EFFORT. Verify only when BOTH the secret and a
    // token are present; a missing secret (it's currently not set in prod) or a
    // widget that failed to load must NEVER block a real customer's message. Spam
    // protection turns back on automatically once TURNSTILE_SECRET_KEY is set and
    // the widget issues valid tokens.
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
    } else if (!TURNSTILE_SECRET) {
      console.warn('[contact] TURNSTILE_SECRET_KEY not configured — skipping CAPTCHA verification.');
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
