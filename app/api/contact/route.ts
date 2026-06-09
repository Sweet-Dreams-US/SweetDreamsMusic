import { NextRequest, NextResponse } from 'next/server';
import { sendContactForm } from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const { name, email, phone, message, company } = await request.json();

    if (!name || !email || !message) {
      return NextResponse.json({ error: 'Name, email, and message are required' }, { status: 400 });
    }

    // Honeypot: real users never fill the hidden "company" field. If it's set,
    // it's a bot — silently accept (so it doesn't retry) but drop the message.
    if (company && String(company).trim()) {
      return NextResponse.json({ success: true });
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
