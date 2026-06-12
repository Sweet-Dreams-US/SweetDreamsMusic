/**
 * scripts/probe-iszac-email.ts
 *
 * Sends a single test email to Iszac and logs Resend's full response so we
 * can tell whether the message was accepted, rejected, or rate-limited.
 *
 * Run: npx tsx --env-file=.env.local scripts/probe-iszac-email.ts
 */

import { Resend } from 'resend';

const KEY = process.env.RESEND_API_KEY;
if (!KEY) {
  console.error('Missing RESEND_API_KEY');
  process.exit(1);
}

const resend = new Resend(KEY);
const FROM = 'Sweet Dreams Music <studio@sweetdreamsmusic.com>';
const TO = 'iisszzaacc@gmail.com';

(async () => {
  console.log(`Sending probe email\n  from: ${FROM}\n  to:   ${TO}`);
  const result = await resend.emails.send({
    from: FROM,
    to: TO,
    subject: 'Sweet Dreams — Probe (please confirm receipt)',
    html: `
      <h2>Test email from the seed script</h2>
      <p>If you received this, please reply or text Cole — we're verifying that
      band-engineer priority alerts are reaching your inbox (3 went out earlier
      and Cole didn't see them land).</p>
      <p>Sent at: ${new Date().toISOString()}</p>
    `,
  });
  console.log('Resend response:');
  console.log(JSON.stringify(result, null, 2));
})().catch((e) => {
  console.error('Probe failed:', e);
  process.exit(1);
});
