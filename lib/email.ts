import { Resend } from 'resend';
import { SUPER_ADMINS, ROOM_LABELS, SITE_URL, type Room } from './constants';
import { formatDuration } from './utils';
import { mirrorToThread } from './messaging-mirror';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = 'Sweet Dreams Music <studio@sweetdreamsmusic.com>';

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Round 8 hardening: escape user-supplied text before interpolating into
// email HTML. The chat thread (Round 8b) and any future helper that takes
// free-form buyer input should run text through this — otherwise a buyer
// can inject <script>, <img onerror=...>, etc. into admin inboxes.
//
// Replaces the five HTML-significant chars and converts \n to <br/> so the
// caller doesn't have to. For interpolation into href/src attributes use
// a different escape — but we don't do that for user-supplied URLs (the
// validators upstream require http(s)://).
export function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br/>');
}

function wrap(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#000;font-family:'IBM Plex Mono',monospace;color:#fff"><div style="max-width:600px;margin:0 auto;padding:40px 24px">${content}<div style="margin-top:40px;padding-top:24px;border-top:1px solid #333;text-align:center"><p style="color:#666;font-size:11px;margin:0">Sweet Dreams Music LLC &mdash; Fort Wayne, IN</p><p style="color:#666;font-size:11px;margin:4px 0 0"><a href="${SITE_URL}" style="color:#F4C430;text-decoration:none">sweetdreamsmusic.com</a></p></div></div></body></html>`;
}

function btn(text: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;background:#F4C430;color:#000;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-size:13px;padding:14px 28px;text-decoration:none;margin-top:16px">${text}</a>`;
}

function h1(text: string): string {
  return `<h1 style="font-size:24px;font-weight:700;color:#F4C430;text-transform:uppercase;letter-spacing:0.02em;margin:0 0 16px">${text}</h1>`;
}

function p(text: string): string {
  return `<p style="font-size:14px;line-height:1.6;color:#ccc;margin:0 0 12px">${text}</p>`;
}

function detail(label: string, value: string): string {
  return `<tr><td style="padding:6px 16px 6px 0;color:#888;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">${label}</td><td style="padding:6px 0;color:#fff;font-size:14px;font-weight:600">${value}</td></tr>`;
}

function detailTable(rows: string): string {
  return `<table style="margin:20px 0;border-collapse:collapse">${rows}</table>`;
}

export async function sendBookingConfirmation(to: string, details: {
  customerName: string; date: string; startTime: string; duration: number;
  room: string; total: number; deposit: number; bookingId?: string;
}) {
  // Round 9e: mirror this notification into the buyer's Sweet Dreams thread
  // so it shows up in their in-app inbox alongside the email. Studio sessions
  // don't have media_booking threads, so we always target the SD thread.
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Booking Confirmed',
    body: `Your ${formatDuration(details.duration)} session is booked for ${details.date} at ${details.startTime} in ${ROOM_LABELS[details.room as Room] || details.room}. Deposit ${formatMoney(details.deposit)} paid; remainder ${formatMoney(details.total - details.deposit)} due at session.`,
  });
  try {
    const roomLabel = ROOM_LABELS[details.room as Room] || details.room;
    const prepUrl = details.bookingId ? `${SITE_URL}/dashboard/prep/${details.bookingId}` : `${SITE_URL}/dashboard`;
    await resend.emails.send({
      from: FROM, to, subject: 'Booking Confirmed — Sweet Dreams Music',
      html: wrap(`
        ${h1('Booking Confirmed')}
        ${p(`Hey ${details.customerName}, your session is booked!`)}
        ${detailTable(`
          ${detail('Date', details.date)}
          ${detail('Time', details.startTime)}
          ${detail('Duration', `${formatDuration(details.duration)}`)}
          ${detail('Studio', roomLabel)}
          ${detail('Deposit Paid', formatMoney(details.deposit))}
          ${detail('Remainder Due', formatMoney(details.total - details.deposit))}
          ${detail('Total', formatMoney(details.total))}
        `)}
        ${p('An engineer will be assigned to your session shortly. You\'ll receive another email when they\'re confirmed.')}
        ${p('The remaining balance will be charged to your card on file after your session.')}
        <div style="margin-top:24px;padding:20px;background:#111;border-left:3px solid #F4C430">
          ${p('<strong style="color:#F4C430">🎤 Prepare for Your Session</strong>')}
          ${p('Don\'t waste studio time searching for beats! Upload your beat, share reference tracks, and let your engineer know what you want to accomplish — so you can hit the ground running.')}
          ${btn('Prepare Now', prepUrl)}
        </div>
        ${btn('View Dashboard', `${SITE_URL}/dashboard`)}
      `),
    });
  } catch (e) { console.error('Email error (booking confirmation):', e); }
}

export async function sendEngineerNewBookingAlert(engineerEmails: string[], booking: {
  id: string; customerName: string; date: string; startTime: string;
  duration: number; room: string;
}) {
  const roomLabel = ROOM_LABELS[booking.room as Room] || booking.room;
  const html = wrap(`
    ${h1('New Session Available')}
    ${p('A new booking just came in. First to claim it gets the session.')}
    ${detailTable(`
      ${detail('Client', booking.customerName)}
      ${detail('Date', booking.date)}
      ${detail('Time', booking.startTime)}
      ${detail('Duration', `${formatDuration(booking.duration)}`)}
      ${detail('Studio', roomLabel)}
    `)}
    ${btn('Claim Session', `${SITE_URL}/engineer`)}
  `);

  // Send individually so one bounce doesn't kill all
  for (const email of engineerEmails) {
    try {
      console.log('[EMAIL] Sending engineer alert to:', email);
      await resend.emails.send({
        from: FROM, to: email, subject: 'New Session Available — Claim It', html,
      });
      console.log('[EMAIL] Sent successfully to:', email);
    } catch (e) {
      console.error('[EMAIL] Failed to send engineer alert to:', email, e);
    }
  }
}

export async function sendEngineerPriorityAlert(to: string, details: {
  id: string; customerName: string; date: string; startTime: string;
  duration: number; room: string; priorityHours: number | string;
}) {
  try {
    const roomLabel = ROOM_LABELS[details.room as Room] || details.room;
    const windowLabel = typeof details.priorityHours === 'number'
      ? `${details.priorityHours} hours`
      : details.priorityHours;
    await resend.emails.send({
      from: FROM, to,
      subject: 'You\'ve Been Requested — Accept or Pass',
      html: wrap(`
        ${h1('You\'ve Been Requested')}
        ${p(`A client specifically requested you for their session. You have <strong>${windowLabel}</strong> to accept before it opens to other engineers.`)}
        ${detailTable(`
          ${detail('Client', details.customerName)}
          ${detail('Date', details.date)}
          ${detail('Time', details.startTime)}
          ${detail('Duration', `${formatDuration(details.duration)}`)}
          ${detail('Studio', roomLabel)}
          ${detail('Priority Window', windowLabel)}
        `)}
        ${btn('Accept or Pass', `${SITE_URL}/engineer`)}
        ${p('Click <strong>Accept</strong> to lock in the session, or <strong>Pass</strong> to immediately open it to other engineers.')}
        ${p('If you don\'t respond, the session will automatically open to others when the priority window expires.')}
      `),
    });
  } catch (e) { console.error('Email error (priority alert):', e); }
}

export async function sendPriorityReminderToEngineer(to: string, details: {
  customerName: string; date: string; startTime: string; room: string;
  hoursRemaining: string;
}) {
  try {
    const roomLabel = ROOM_LABELS[details.room as Room] || details.room;
    await resend.emails.send({
      from: FROM, to,
      subject: `Priority Expiring Soon — ${details.customerName}'s Session`,
      html: wrap(`
        ${h1('Priority Expiring Soon')}
        ${p(`You were requested for a session with ${details.customerName} and your priority expires in <strong>${details.hoursRemaining}</strong>.`)}
        ${detailTable(`
          ${detail('Client', details.customerName)}
          ${detail('Date', details.date)}
          ${detail('Time', details.startTime)}
          ${detail('Studio', roomLabel)}
        `)}
        ${btn('Accept or Pass', `${SITE_URL}/engineer`)}
        ${p('If you don\'t respond, the session will automatically open to all engineers.')}
      `),
    });
  } catch (e) { console.error('Email error (priority reminder):', e); }
}

export async function sendEngineerAssignedNonRequested(to: string, details: {
  customerName: string; requestedEngineer: string; assignedEngineer: string;
  date: string; startTime: string; rescheduleDeadline: string;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Engineer Update',
    body: `${details.requestedEngineer} couldn't take your session on ${details.date} at ${details.startTime}. ${details.assignedEngineer} accepted instead. To reschedule for your preferred engineer, request from your dashboard before ${details.rescheduleDeadline}.`,
  });
  try {
    await resend.emails.send({
      from: FROM, to,
      subject: 'Engineer Update — Sweet Dreams Music',
      html: wrap(`
        ${h1('Your Session Engineer')}
        ${p(`Hey ${details.customerName},`)}
        ${p(`Unfortunately, <strong>${details.requestedEngineer}</strong> was not available for your session. <strong>${details.assignedEngineer}</strong> has accepted your session and will be your engineer.`)}
        ${detailTable(`
          ${detail('Your Engineer', details.assignedEngineer)}
          ${detail('Originally Requested', details.requestedEngineer)}
          ${detail('Session Date', details.date)}
          ${detail('Session Time', details.startTime)}
        `)}
        ${p('All of our engineers are professionals who will give you an amazing session.')}
        <div style="margin-top:24px;padding:20px;background:#111;border-left:3px solid #F4C430">
          ${p('If you\'d like to reschedule to try to get your preferred engineer, you can request a reschedule from your dashboard.')}
          ${p(`<span style="color:#F4C430;font-size:12px;font-weight:700">Reschedule requests must be submitted by ${details.rescheduleDeadline} (8 hours before your session).</span>`)}
          ${btn('Request Reschedule', `${SITE_URL}/dashboard`)}
        </div>
      `),
    });
  } catch (e) { console.error('Email error (non-requested engineer assigned):', e); }
}

export async function sendEngineerPassNotification(engineerEmails: string[], details: {
  customerName: string; date: string; startTime: string;
  duration: number; room: string; passedEngineer: string;
}) {
  const roomLabel = ROOM_LABELS[details.room as Room] || details.room;
  const html = wrap(`
    ${h1('Session Now Available')}
    ${p(`${details.passedEngineer} passed on this session. It's now open — first to accept gets it.`)}
    ${detailTable(`
      ${detail('Client', details.customerName)}
      ${detail('Date', details.date)}
      ${detail('Time', details.startTime)}
      ${detail('Duration', `${formatDuration(details.duration)}`)}
      ${detail('Studio', roomLabel)}
    `)}
    ${btn('Accept Session', `${SITE_URL}/engineer`)}
  `);

  for (const email of engineerEmails) {
    try {
      await resend.emails.send({
        from: FROM, to: email, subject: `Session Available — ${details.customerName}`, html,
      });
    } catch (e) {
      console.error(`Email error (pass notification to ${email}):`, e);
    }
  }
}

/**
 * Sent to SUPER_ADMINS when Iszac passes a band session. Bands route only to
 * Iszac — there's no fallback claim path — so when he passes, admins need to
 * step in and coordinate a reschedule with the band directly. The buyer is
 * NOT auto-notified (Round 8b chat thread is the right surface for that).
 */
export async function sendBandSessionNeedsRescheduleAdmin(details: {
  bookingId: string;
  customerName: string;
  bandName?: string | null;
  date: string;
  startTime: string;
  duration: number;
}) {
  try {
    await resend.emails.send({
      from: FROM,
      to: [...SUPER_ADMINS],
      subject: `Iszac passed band session — coordinate reschedule (${details.customerName})`,
      html: wrap(`
        ${h1('Band Session — Needs Reschedule')}
        ${p(`Iszac passed on this band session. Bands route only to him, so no other engineer can pick it up — admins need to coordinate a reschedule with the band directly.`)}
        ${detailTable(`
          ${detail('Band', details.bandName || details.customerName)}
          ${detail('Booker', details.customerName)}
          ${detail('Original date', details.date)}
          ${detail('Original time', details.startTime)}
          ${detail('Duration', `${formatDuration(details.duration)}`)}
          ${detail('Booking ID', details.bookingId.slice(0, 8))}
        `)}
        ${btn('Open in admin', `${SITE_URL}/admin`)}
        ${p('<span style="color:#888;font-size:12px">Reach out to the band, propose a new date, then update the booking from the admin panel. The buyer hasn\'t been auto-notified yet.</span>')}
      `),
    });
  } catch (e) { console.error('Email error (band needs reschedule):', e); }
}

export async function sendPriorityExpiredToClient(to: string, details: {
  customerName: string; requestedEngineer: string; date: string; startTime: string;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Engineer Update',
    body: `${details.requestedEngineer} isn't available for your ${details.date} ${details.startTime} session. Another engineer will pick it up — or you can request a reschedule from your dashboard.`,
  });
  try {
    await resend.emails.send({
      from: FROM, to,
      subject: 'Engineer Update — Sweet Dreams Music',
      html: wrap(`
        ${h1('Engineer Update')}
        ${p(`Hey ${details.customerName},`)}
        ${p(`Unfortunately, ${details.requestedEngineer} is not available for your session on ${details.date} at ${details.startTime}. One of our other talented engineers will be reaching out to handle your session.`)}
        ${p('If you\'d like to reschedule to wait for your preferred engineer, you can request a reschedule from your dashboard.')}
        ${detailTable(`
          ${detail('Requested Engineer', details.requestedEngineer)}
          ${detail('Session Date', details.date)}
          ${detail('Session Time', details.startTime)}
        `)}
        ${btn('View Dashboard', `${SITE_URL}/dashboard`)}
        ${p('All of our engineers are professionals who will give you an amazing session. If you have any concerns, reach out to us.')}
      `),
    });
  } catch (e) { console.error('Email error (priority expired):', e); }
}

export async function sendRescheduleRequestAlert(details: {
  customerName: string; customerEmail: string; artistName?: string | null;
  date: string; startTime: string; room: string;
  reason: string; currentEngineer: string | null;
}) {
  try {
    const roomLabel = ROOM_LABELS[details.room as Room] || details.room;
    await resend.emails.send({
      from: FROM, to: [...SUPER_ADMINS],
      subject: `Reschedule Request — ${details.customerName}`,
      html: wrap(`
        ${h1('Reschedule Request')}
        ${p(`${details.customerName} has requested to reschedule their session.`)}
        ${detailTable(`
          ${detail('Client', details.customerName)}
          ${details.artistName ? detail('Artist Name', details.artistName) : ''}
          ${detail('Email', details.customerEmail)}
          ${detail('Current Date', details.date)}
          ${detail('Current Time', details.startTime)}
          ${detail('Studio', roomLabel)}
          ${details.currentEngineer ? detail('Current Engineer', details.currentEngineer) : ''}
          ${detail('Reason', details.reason)}
        `)}
        ${p('Please review this request and reach out to the client to coordinate.')}
        ${btn('View Admin Dashboard', `${SITE_URL}/admin`)}
      `),
    });
  } catch (e) { console.error('Email error (reschedule request):', e); }
}

export async function sendEngineerAssigned(to: string, details: {
  customerName: string; engineerName: string; date: string; startTime: string;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Engineer Assigned',
    body: `${details.engineerName} has been confirmed as your engineer for the ${details.date} session at ${details.startTime}.`,
  });
  try {
    await resend.emails.send({
      from: FROM, to, subject: 'Engineer Assigned — Sweet Dreams Music',
      html: wrap(`
        ${h1('Engineer Assigned')}
        ${p(`Hey ${details.customerName}, your engineer has been confirmed!`)}
        ${detailTable(`
          ${detail('Engineer', details.engineerName)}
          ${detail('Date', details.date)}
          ${detail('Time', details.startTime)}
        `)}
        ${p('See you at the studio. If you need to make changes, reach out to us.')}
        ${btn('View Dashboard', `${SITE_URL}/dashboard`)}
      `),
    });
  } catch (e) { console.error('Email error (engineer assigned):', e); }
}

export async function sendEngineerClaimConfirmation(to: string, details: {
  engineerName: string; customerName: string; date: string; startTime: string;
  duration: number; room: string; total: number; remainder: number;
}) {
  try {
    const roomLabel = ROOM_LABELS[details.room as Room] || details.room;
    await resend.emails.send({
      from: FROM, to, subject: 'Session Claimed — Sweet Dreams Music',
      html: wrap(`
        ${h1('Session Claimed')}
        ${p(`Hey ${details.engineerName}, you've claimed this session.`)}
        ${detailTable(`
          ${detail('Client', details.customerName)}
          ${detail('Date', details.date)}
          ${detail('Time', details.startTime)}
          ${detail('Duration', `${formatDuration(details.duration)}`)}
          ${detail('Studio', roomLabel)}
          ${detail('Session Total', formatMoney(details.total))}
          ${detail('Remainder to Collect', formatMoney(details.remainder))}
        `)}
        ${p('Remember to charge the remainder after the session wraps up.')}
        ${btn('View Dashboard', `${SITE_URL}/engineer`)}
      `),
    });
  } catch (e) { console.error('Email error (engineer claim confirmation):', e); }
}

export async function sendAdminBookingAlert(booking: {
  id: string; customerName: string; customerEmail: string; date: string;
  startTime: string; duration: number; room: string; total: number;
}) {
  try {
    const roomLabel = ROOM_LABELS[booking.room as Room] || booking.room;
    await resend.emails.send({
      from: FROM, to: [...SUPER_ADMINS], subject: `New Booking — ${booking.customerName}`,
      html: wrap(`
        ${h1('New Booking')}
        ${detailTable(`
          ${detail('Client', booking.customerName)}
          ${detail('Email', booking.customerEmail)}
          ${detail('Date', booking.date)}
          ${detail('Time', booking.startTime)}
          ${detail('Duration', `${formatDuration(booking.duration)}`)}
          ${detail('Studio', roomLabel)}
          ${detail('Total', formatMoney(booking.total))}
        `)}
        ${btn('View in Admin', `${SITE_URL}/admin`)}
      `),
    });
  } catch (e) { console.error('Email error (admin alert):', e); }
}

export async function sendSessionReminder(to: string, details: {
  customerName: string; artistName?: string | null; date: string; startTime: string;
  room: string; engineerName: string | null; bookingId?: string; hasPrep?: boolean;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Session in 1 hour',
    body: `Reminder: your session is at ${details.startTime} in ${ROOM_LABELS[details.room as Room] || details.room}.${details.engineerName ? ` Engineer: ${details.engineerName}.` : ''} See you soon.`,
  });
  try {
    const roomLabel = ROOM_LABELS[details.room as Room] || details.room;
    const prepUrl = details.bookingId ? `${SITE_URL}/dashboard/prep/${details.bookingId}` : null;
    await resend.emails.send({
      from: FROM, to, subject: 'Session in 1 Hour — Sweet Dreams Music',
      html: wrap(`
        ${h1('Session Reminder')}
        ${p(`Hey ${details.customerName}, your session starts in 1 hour!`)}
        ${detailTable(`
          ${detail('Date', details.date)}
          ${detail('Time', details.startTime)}
          ${detail('Studio', roomLabel)}
          ${details.engineerName ? detail('Engineer', details.engineerName) : ''}
        `)}
        ${!details.hasPrep && prepUrl ? `
          <div style="margin-top:16px;padding:16px;background:#111;border-left:3px solid #F4C430">
            ${p('<strong style="color:#F4C430">⚡ Quick Tip</strong>')}
            ${p('You haven\'t filled out your session prep yet. Even a quick note about what you want to work on helps your engineer prepare.')}
            ${btn('Prepare Now', prepUrl)}
          </div>
        ` : ''}
        ${p('Make sure to arrive a few minutes early. See you soon!')}
      `),
    });
  } catch (e) { console.error('Email error (session reminder):', e); }
}

export async function sendSessionReminderToStaff(emails: string[], details: {
  customerName: string; customerEmail: string; artistName?: string | null;
  date: string; startTime: string; duration: number;
  room: string; engineerName: string;
  prepSummary?: { sessionType?: string; hasBeats?: boolean; beatSource?: string; lyricsStatus?: string; goals?: string; refCount?: number } | null;
}) {
  try {
    const roomLabel = ROOM_LABELS[details.room as Room] || details.room;
    const prep = details.prepSummary;
    const prepSection = prep ? `
      <div style="margin-top:16px;padding:16px;background:#111;border-left:3px solid #F4C430">
        <p style="font-size:12px;color:#F4C430;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px">Session Prep</p>
        ${detailTable(`
          ${prep.sessionType ? detail('Type', prep.sessionType) : ''}
          ${prep.goals ? detail('Goals', prep.goals.substring(0, 120) + (prep.goals.length > 120 ? '...' : '')) : ''}
          ${prep.beatSource ? detail('Beat', prep.beatSource) : ''}
          ${prep.lyricsStatus ? detail('Lyrics', prep.lyricsStatus) : ''}
          ${prep.refCount ? detail('References', `${prep.refCount} track${prep.refCount > 1 ? 's' : ''}`) : ''}
        `)}
      </div>
    ` : '';

    const html = wrap(`
      ${h1('Upcoming Session — 1 Hour')}
      ${p('A session is starting in about 1 hour.')}
      ${detailTable(`
        ${detail('Name', details.customerName)}
        ${details.artistName ? detail('Artist Name', details.artistName) : ''}
        ${detail('Email', details.customerEmail)}
        ${detail('Date', details.date)}
        ${detail('Time', details.startTime)}
        ${detail('Duration', `${formatDuration(details.duration)}`)}
        ${detail('Studio', roomLabel)}
        ${detail('Engineer', details.engineerName)}
      `)}
      ${prepSection}
      ${btn('View Dashboard', `${SITE_URL}/admin`)}
    `);

    for (const email of emails) {
      try {
        await resend.emails.send({
          from: FROM, to: email,
          subject: `Session in 1 Hour — ${details.customerName}${details.artistName ? ` (${details.artistName})` : ''}`,
          html,
        });
      } catch (e) {
        console.error(`Email error (staff reminder to ${email}):`, e);
      }
    }
  } catch (e) { console.error('Email error (staff reminder):', e); }
}

/**
 * Password reset email.
 *
 * Sent from /api/auth/forgot-password — we generate the recovery link via
 * service.auth.admin.generateLink({ type: 'recovery' }) and email it via
 * Resend rather than letting Supabase Auth send its own (rate-limited,
 * unbranded) version. The link still verifies through Supabase's normal
 * recovery flow — clicking it sets a session and lands on /reset-password
 * where updateUser({ password }) does the actual change.
 *
 * Deliberately NOT mirrored into the user's Sweet Dreams thread: anyone
 * with concurrent access to the inbox (shared computer, partner who can
 * read your email, etc.) could use the link. Email-only is the right
 * audience for a credential-rotation flow.
 */
export async function sendPasswordReset(to: string, resetLink: string, name?: string) {
  try {
    await resend.emails.send({
      from: FROM, to, subject: 'Reset Your Password — Sweet Dreams Music',
      html: wrap(`
        ${h1('Reset Password')}
        ${p(name ? `Hey ${name}, we received a request to reset your password.` : 'We received a request to reset your password.')}
        ${p('Click the button below to set a new one. The link is valid for 1 hour.')}
        ${btn('Reset Password', resetLink)}
        ${p('<span style="color:#888;font-size:12px">If you didn\'t request this, you can safely ignore this email — your password won\'t change unless you click the link above.</span>')}
        <p style="font-size:11px;color:#666;margin-top:24px;word-break:break-all">${resetLink}</p>
      `),
    });
  } catch (e) { console.error('Email error (password reset):', e); }
}

export async function sendWelcomeEmail(to: string, name: string) {
  // First message in the user's brand-new Sweet Dreams thread.
  await mirrorToThread({
    userEmail: to,
    kind: 'update',
    subject: `Welcome, ${name}`,
    body: `Glad to have you at Sweet Dreams Music. This is your inbox — every receipt, booking confirmation, engineer assignment, and platform update lands here. You can reply directly to talk to Cole, Jay, or any of the engineers. They'll see it and respond from this same thread.`,
  });
  try {
    await resend.emails.send({
      from: FROM, to, subject: 'Welcome to Sweet Dreams Music',
      html: wrap(`
        ${h1('Welcome')}
        ${p(`Hey ${name}, welcome to Sweet Dreams Music!`)}
        ${p('Your account is set up. You can now book recording sessions, browse beats, and build your public artist profile.')}
        ${btn('Book a Session', `${SITE_URL}/book`)}
        ${p('See you in the studio.')}
      `),
    });
  } catch (e) { console.error('Email error (welcome):', e); }
}

export async function sendSessionFilesDelivered(to: string, details: {
  customerName: string; engineerName: string; fileCount: number;
  date: string; room: string;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Your Files Are Ready',
    body: `${details.engineerName} uploaded ${details.fileCount} file${details.fileCount > 1 ? 's' : ''} from your ${ROOM_LABELS[details.room as Room] || details.room} session. Download from your dashboard.`,
  });
  try {
    const roomLabel = ROOM_LABELS[details.room as Room] || details.room;
    const reviewUrl = 'https://g.page/r/CcWAY0XlIQNpEBM/review';
    await resend.emails.send({
      from: FROM, to, subject: 'Your Session Files Are Ready — Sweet Dreams Music',
      html: wrap(`
        ${h1('Your Files Are Ready')}
        ${p(`Hey ${details.customerName},`)}
        ${p(`Thanks for coming in! ${details.engineerName} has uploaded ${details.fileCount} file${details.fileCount > 1 ? 's' : ''} from your ${roomLabel} session. You can download them from your dashboard.`)}
        ${btn('Download Files', `${SITE_URL}/dashboard`)}
        <div style="margin-top:32px;padding:24px;background:#111;border-left:3px solid #F4C430">
          ${p('We hope you had a great experience at Sweet Dreams Music. If you did, it would mean a lot if you left us a quick review on Google.')}
          <a href="${reviewUrl}" style="display:inline-block;background:#F4C430;color:#000;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-size:13px;padding:14px 28px;text-decoration:none;margin-top:12px">Leave a Review</a>
        </div>
        ${p('See you next time!')}
      `),
    });
  } catch (e) { console.error('Email error (files delivered):', e); }
}

export async function sendPaymentLink(to: string, details: {
  customerName: string; amount: number; paymentUrl: string;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Payment link',
    body: `Outstanding balance: ${formatMoney(details.amount)}. Pay at ${details.paymentUrl}.`,
    attachments: [{ label: 'Pay now', url: details.paymentUrl, kind: 'link' as const }],
  });
  try {
    await resend.emails.send({
      from: FROM, to, subject: 'Complete Your Remaining Balance — Sweet Dreams Music',
      html: wrap(`
        ${h1('Remaining Balance')}
        ${p(`Hey ${details.customerName}, your session is complete! Please pay the remaining balance below.`)}
        ${detailTable(`
          ${detail('Amount Due', formatMoney(details.amount))}
        `)}
        ${p('Click the button below to securely complete your payment.')}
        ${btn('PAY NOW', details.paymentUrl)}
        ${p('<span style="color:#666;font-size:11px">This is a secure payment link powered by Stripe. If you have any questions, reply to this email.</span>')}
      `),
    });
  } catch (e) { console.error('Email error (payment link):', e); }
}

export async function sendSessionInvite(to: string, details: {
  customerName: string; engineerName: string; date: string; startTime: string;
  duration: number; room: string; total: number; deposit: number;
  inviteUrl: string; isCash: boolean;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: details.isCash ? 'Session Scheduled' : 'Session Invite',
    body: `${details.engineerName} ${details.isCash ? 'booked a session for you' : 'invited you to a session'} on ${details.date} at ${details.startTime} in ${ROOM_LABELS[details.room as Room] || details.room}. ${details.isCash ? '' : `Pay ${formatMoney(details.deposit)} deposit to confirm.`}`,
    attachments: [{ label: details.isCash ? 'View session' : 'Confirm + pay', url: details.inviteUrl, kind: 'link' as const }],
  });
  try {
    const roomLabel = ROOM_LABELS[details.room as Room] || details.room;
    const subject = details.isCash
      ? 'Session Scheduled — Sweet Dreams Music'
      : 'You\'re Invited to a Session — Sweet Dreams Music';

    await resend.emails.send({
      from: FROM, to, subject,
      html: wrap(`
        ${h1(details.isCash ? 'Session Scheduled' : 'Session Invite')}
        ${p(`Hey ${details.customerName}, ${details.engineerName} has ${details.isCash ? 'booked a session for you' : 'invited you to a session'} at Sweet Dreams Music!`)}
        ${detailTable(`
          ${detail('Date', details.date)}
          ${detail('Time', details.startTime)}
          ${detail('Duration', `${formatDuration(details.duration)}`)}
          ${detail('Studio', roomLabel)}
          ${detail('Total', formatMoney(details.total))}
          ${details.isCash
            ? detail('Payment', 'Cash — pay at the studio')
            : detail('Deposit Due', formatMoney(details.deposit))
          }
        `)}
        ${details.isCash
          ? p('Your session is confirmed. See you at the studio!')
          : p('Click the button below to pay your deposit and confirm your session.')
        }
        ${btn(details.isCash ? 'VIEW SESSION' : 'PAY DEPOSIT & CONFIRM', details.inviteUrl)}
        ${p('<span style="color:#666;font-size:11px">If you have any questions, reply to this email.</span>')}
      `),
    });
  } catch (e) { console.error('Email error (session invite):', e); }
}

export async function sendBeatReviewNotification(to: string, details: {
  producerName: string; beatTitle: string;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'update',
    subject: 'New beat for review',
    body: `A new beat "${details.beatTitle}" was uploaded to your catalog and needs your review before it goes live on the store.`,
    attachments: [{ label: 'Review beat', url: `${SITE_URL}/producer`, kind: 'link' as const }],
  });
  try {
    await resend.emails.send({
      from: FROM, to,
      subject: 'New Beat Uploaded — Review Required',
      html: wrap(`
        ${h1('New Beat for Review')}
        ${p(`Hey ${details.producerName},`)}
        ${p(`A new beat has been uploaded to your catalog and needs your review before it goes live on the store.`)}
        ${detailTable(`
          ${detail('Beat', details.beatTitle)}
          ${detail('Status', 'Pending Review')}
        `)}
        ${p('Please log in to your Producer Dashboard to review the beat details and sign the agreement to make it live.')}
        ${btn('Review Beat', `${SITE_URL}/producer`)}
        ${p('<span style="color:#666;font-size:11px">The beat will not appear on the store until you review and approve it.</span>')}
      `),
    });
  } catch (e) { console.error('Email error (beat review notification):', e); }
}

export async function sendContactForm(details: {
  name: string; email: string; subject: string; message: string;
}) {
  try {
    await resend.emails.send({
      from: FROM, to: [...SUPER_ADMINS], replyTo: details.email,
      subject: `Contact Form: ${details.subject}`,
      html: wrap(`
        ${h1('Contact Form')}
        ${detailTable(`
          ${detail('Name', details.name)}
          ${detail('Email', details.email)}
          ${detail('Subject', details.subject)}
        `)}
        <div style="background:#111;padding:16px;margin:16px 0;border-left:3px solid #F4C430">
          <p style="font-size:14px;color:#ccc;margin:0;white-space:pre-wrap">${details.message}</p>
        </div>
      `),
    });
  } catch (e) { console.error('Email error (contact form):', e); }
}

// ── Private Beat Sale Emails ──────────────────────────────────────────

export async function sendPrivateBeatSaleInvite(to: string, details: {
  buyerName: string; beatTitle: string; producerName: string;
  licenseType: string; amount: number; requiresPayment: boolean; token: string;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Private Beat Sale',
    body: `${details.producerName} set up a private beat sale for "${details.beatTitle}" (${details.licenseType}, ${details.requiresPayment ? formatMoney(details.amount) : 'no charge'}). Review + sign the license to receive your files.`,
    attachments: [{ label: 'Review & sign', url: `${SITE_URL}/beats/private/${details.token}`, kind: 'link' as const }],
  });
  try {
    const actionText = details.requiresPayment ? 'Review & Purchase' : 'Review & Sign';
    await resend.emails.send({
      from: FROM, to,
      subject: `Private Beat Sale — ${details.beatTitle}`,
      html: wrap(`
        ${h1('PRIVATE BEAT SALE')}
        ${p(`Hey ${details.buyerName}, ${details.producerName} has set up a private beat sale for you.`)}
        ${detailTable(`
          ${detail('Beat', details.beatTitle)}
          ${detail('Producer', details.producerName)}
          ${detail('License', details.licenseType)}
          ${detail('Price', details.requiresPayment ? formatMoney(details.amount) : 'Included / No Charge')}
        `)}
        ${p(details.requiresPayment
          ? 'Review the details below, sign the license agreement, and complete your payment to receive your files.'
          : 'Review the details below and sign the license agreement to receive your files.'
        )}
        ${btn(actionText, `${SITE_URL}/beats/private/${details.token}`)}
        ${p('<span style="color:#666;font-size:11px">If you have any questions, reply to this email.</span>')}
      `),
    });
  } catch (e) { console.error('Email error (private beat sale invite):', e); }
}

export async function sendPrivateBeatSaleComplete(to: string, details: {
  buyerName: string; beatTitle: string; producerName: string;
  licenseType: string; amount: number; token: string;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Beat Purchase Complete',
    body: `Purchase complete: "${details.beatTitle}" by ${details.producerName} (${details.licenseType}, ${formatMoney(details.amount)}). License agreement is on your download page.`,
    attachments: [{ label: 'Download files', url: `${SITE_URL}/beats/private/${details.token}`, kind: 'link' as const }],
  });
  try {
    await resend.emails.send({
      from: FROM, to,
      subject: `Beat Purchase Complete — ${details.beatTitle}`,
      html: wrap(`
        ${h1('PURCHASE COMPLETE')}
        ${p(`Hey ${details.buyerName}, your beat purchase is complete! You can now download your files.`)}
        ${detailTable(`
          ${detail('Beat', details.beatTitle)}
          ${detail('Producer', details.producerName)}
          ${detail('License', details.licenseType)}
          ${detail('Amount Paid', formatMoney(details.amount))}
        `)}
        ${btn('Download Files', `${SITE_URL}/beats/private/${details.token}`)}
        ${p('<span style="color:#666;font-size:11px">Your license agreement is available on your download page.</span>')}
      `),
    });
  } catch (e) { console.error('Email error (private beat sale complete):', e); }
}

export async function sendPrivateBeatSaleNotification(to: string, details: {
  buyerName: string; buyerEmail: string; beatTitle: string;
  licenseType: string; amount: number; paymentMethod: string;
}) {
  try {
    await resend.emails.send({
      from: FROM, to,
      subject: `Beat Sale Completed — ${details.beatTitle}`,
      html: wrap(`
        ${h1('SALE COMPLETED')}
        ${p(`${details.buyerName} has completed their private beat purchase.`)}
        ${detailTable(`
          ${detail('Buyer', details.buyerName)}
          ${detail('Email', details.buyerEmail)}
          ${detail('Beat', details.beatTitle)}
          ${detail('License', details.licenseType)}
          ${detail('Amount', formatMoney(details.amount))}
          ${detail('Payment', details.paymentMethod)}
        `)}
        ${p('The buyer now has access to download their files and license agreement.')}
      `),
    });
  } catch (e) { console.error('Email error (private beat sale notification):', e); }
}

// Beat purchase confirmation (public store)
export async function sendBeatPurchaseConfirmation(to: string, details: {
  buyerName: string;
  beatTitle: string;
  producerName: string;
  licenseType: string;
  amount: number;
  purchaseId: string;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Beat Purchase Confirmed',
    body: `Purchase complete: "${details.beatTitle}" by ${details.producerName} (${details.licenseType}, ${formatMoney(details.amount)}). Download from /dashboard/purchases.`,
  });
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: `Purchase Confirmed — ${details.beatTitle}`,
      html: wrap(
        h1('PURCHASE CONFIRMED') +
        p(`${details.buyerName}, your beat purchase is complete.`) +
        detailTable(
          detail('Beat', details.beatTitle) +
          detail('Producer', details.producerName) +
          detail('License', details.licenseType) +
          detail('Amount', formatMoney(details.amount)) +
          detail('Purchase ID', details.purchaseId)
        ) +
        p('Your files are ready for download. You can also access your purchases anytime from your dashboard.') +
        btn('VIEW MY PURCHASES', `${SITE_URL}/dashboard/purchases`) +
        p('Your signed license agreement is stored in your account and attached to this purchase. You can view and download it at any time.')
      ),
    });
  } catch (e) { console.error('Email error (beat purchase confirmation):', e); }
}

// Producer notification when someone buys their beat
export async function sendBeatSaleProducerNotification(to: string, details: {
  buyerName: string;
  buyerEmail: string;
  beatTitle: string;
  licenseType: string;
  amount: number;
  producerEarnings: number;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Beat Sold',
    body: `${details.buyerName} bought "${details.beatTitle}" (${details.licenseType}, ${formatMoney(details.amount)}). Your earnings: ${formatMoney(details.producerEarnings)} (60%). Track at /producer.`,
  });
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: `Beat Sold — ${details.beatTitle}`,
      html: wrap(
        h1('BEAT SOLD') +
        p(`Someone just purchased your beat "${details.beatTitle}".`) +
        detailTable(
          detail('Beat', details.beatTitle) +
          detail('Buyer', details.buyerName) +
          detail('Email', details.buyerEmail) +
          detail('License', details.licenseType) +
          detail('Sale Amount', formatMoney(details.amount)) +
          detail('Your Earnings (60%)', formatMoney(details.producerEarnings))
        ) +
        btn('VIEW YOUR EARNINGS', `${SITE_URL}/producer`)
      ),
    });
  } catch (e) { console.error('Email error (producer sale notification):', e); }
}

// ── Beat Approval Flow Emails ───────────────────────────────────────

export async function sendAdminBeatApprovalNotification(adminEmails: string[], details: {
  producerName: string; beatTitle: string; genre: string | null;
}) {
  const html = wrap(
    h1('NEW BEAT — APPROVAL NEEDED') +
    p(`A producer has uploaded a new beat that needs your approval before it can go live.`) +
    detailTable(
      detail('Producer', details.producerName) +
      detail('Beat', details.beatTitle) +
      (details.genre ? detail('Genre', details.genre) : '')
    ) +
    p('Review this beat in the admin dashboard under the Beats tab.') +
    btn('REVIEW BEAT', `${SITE_URL}/admin`)
  );

  for (const email of adminEmails) {
    try {
      await resend.emails.send({
        from: FROM, to: email,
        subject: `Beat Approval Needed — ${details.beatTitle}`,
        html,
      });
    } catch (e) {
      console.error(`Email error (admin beat approval to ${email}):`, e);
    }
  }
}

export async function sendBeatApprovedNotification(to: string, details: {
  beatTitle: string;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Beat Approved',
    body: `"${details.beatTitle}" was approved. Sign the agreement + upload cover art at /producer to go live on the store.`,
  });
  try {
    await resend.emails.send({
      from: FROM, to,
      subject: `Beat Approved — ${details.beatTitle}`,
      html: wrap(
        h1('BEAT APPROVED') +
        p(`Your beat has been approved by the Sweet Dreams team.`) +
        detailTable(
          detail('Beat', details.beatTitle) +
          detail('Status', 'Approved — Agreement Required')
        ) +
        p('Log in to your Producer Dashboard to sign the agreement and upload your cover art. Once complete, your beat will be live on the store.') +
        btn('SIGN AGREEMENT', `${SITE_URL}/producer`)
      ),
    });
  } catch (e) { console.error('Email error (beat approved):', e); }
}

export async function sendBeatRejectedNotification(to: string, details: {
  beatTitle: string; reason?: string;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Beat Not Approved',
    body: `"${details.beatTitle}" was not approved.${details.reason ? ` Reason: ${details.reason}` : ''} Reach out if you'd like to re-submit.`,
  });
  try {
    await resend.emails.send({
      from: FROM, to,
      subject: `Beat Not Approved — ${details.beatTitle}`,
      html: wrap(
        h1('BEAT NOT APPROVED') +
        p(`Unfortunately, your beat was not approved for the Sweet Dreams store.`) +
        detailTable(
          detail('Beat', details.beatTitle) +
          (details.reason ? detail('Reason', details.reason) : '')
        ) +
        p('If you have questions or would like to re-submit, feel free to reach out to us.') +
        btn('VIEW DASHBOARD', `${SITE_URL}/producer`)
      ),
    });
  } catch (e) { console.error('Email error (beat rejected):', e); }
}

// ── Lease Revocation Email ────────────────────────────────────────────

export async function sendLeaseRevokedNotification(to: string, details: {
  buyerName: string;
  beatTitle: string;
  producerName: string;
  licenseType: string;
  purchaseDate: string;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'update',
    subject: 'Lease Grandfathered',
    body: `Exclusive rights to "${details.beatTitle}" by ${details.producerName} were purchased by another buyer. Your ${details.licenseType} (purchased ${details.purchaseDate}) will run until expiry but cannot be renewed. Per the lease agreement you signed.`,
  });
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: `Lease Revoked — "${details.beatTitle}" Exclusive Purchased`,
      html: wrap(
        h1('LEASE REVOKED') +
        p(`${details.buyerName}, we're writing to let you know that exclusive rights to the beat "${details.beatTitle}" have been purchased by another buyer.`) +
        detailTable(
          detail('Beat', details.beatTitle) +
          detail('Producer', details.producerName) +
          detail('Your License', details.licenseType) +
          detail('Original Purchase', details.purchaseDate)
        ) +
        p('Per the terms of your lease agreement, when exclusive rights are purchased, all existing non-exclusive leases are revoked. This means:') +
        `<ul style="color:#ccc;font-size:14px;line-height:1.8;padding-left:20px;margin:12px 0">
          <li>You may no longer distribute new copies or stream this beat</li>
          <li>Any existing published works using this beat should be taken down</li>
          <li>Your download access for this beat has been disabled</li>
        </ul>` +
        p('We understand this may be inconvenient, and we appreciate your understanding. This policy is outlined in the lease agreement you signed at the time of purchase.') +
        p('If you have any questions, please don\'t hesitate to reach out.') +
        btn('VIEW MY PURCHASES', `${SITE_URL}/dashboard/purchases`)
      ),
    });
  } catch (e) { console.error('Email error (lease revoked):', e); }
}

// ── Payment Reminder ──────────────────────────────────────────────────

export async function sendPaymentReminder(to: string, details: {
  customerName: string;
  sessionDate: string;
  duration: number;
  room: string;
  totalAmount: number;
  amountPaid: number;
  remainingAmount: number;
  paymentLink?: string;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Session Balance Due',
    body: `Remaining balance from your ${details.sessionDate} session: ${formatMoney(details.remainingAmount)} of ${formatMoney(details.totalAmount)} (${formatMoney(details.amountPaid)} paid). Files + new bookings stay on hold until cleared.`,
    attachments: details.paymentLink ? [{ label: 'Pay now', url: details.paymentLink, kind: 'link' as const }] : [],
  });
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: `Friendly Reminder — Session Balance Due`,
      html: wrap(
        h1('SESSION BALANCE DUE') +
        p(`Hey ${details.customerName}, thanks for coming in! We hope you had a great session.`) +
        p(`We wanted to reach out because there's a remaining balance from your recent session. Please take a moment to complete your payment when you get a chance.`) +
        detailTable(
          detail('Session', `${details.sessionDate} · ${formatDuration(details.duration)} · ${ROOM_LABELS[details.room as Room] || details.room}`) +
          detail('Total', formatMoney(details.totalAmount)) +
          detail('Paid', formatMoney(details.amountPaid)) +
          detail('Remaining Balance', formatMoney(details.remainingAmount))
        ) +
        (details.paymentLink
          ? btn('PAY NOW', details.paymentLink) + '<br/><br/>'
          : ''
        ) +
        p('If you\'ve already sent payment, please disregard this message. If you have any questions, feel free to reach out.') +
        p('Please note that we are unable to deliver session files or accept new bookings until the balance is resolved.')
      ),
    });
  } catch (e) { console.error('Email error (payment reminder):', e); }
}

// ── Paystub Email ─────────────────────────────────────────────────────

export async function sendPaystubEmail(to: string, details: {
  recipientName: string;
  payoutAmount: number;
  method: string;
  note: string | null;
  periodLabel: string | null;
  sessionPay: number;
  sessionCount: number;
  sessionHours: number;
  mediaCommission: number;
  mediaWorkerPay: number;
  beatProducerPay: number;
  /** Package salesperson commission — optional; 0 when the person
   *  closed no package quotes this period. */
  packageCommission?: number;
  totalEarned: number;
  totalPaid: number;
  balanceAfter: number;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: `Paystub — ${formatMoney(details.payoutAmount)}${details.periodLabel ? ` (${details.periodLabel})` : ''}`,
    body: `Payout of ${formatMoney(details.payoutAmount)} via ${details.method} recorded.${details.note ? ` Note: ${details.note}` : ''} Total earned: ${formatMoney(details.totalEarned)}. Balance after: ${formatMoney(details.balanceAfter)}.`,
  });
  try {
    const d = details;
    let earningsRows = '';
    if (d.sessionPay > 0) earningsRows += detail('Session Pay', `${d.sessionCount} sessions · ${d.sessionHours}hr — ${formatMoney(d.sessionPay)}`);
    if (d.mediaCommission > 0) earningsRows += detail('Media Commission', formatMoney(d.mediaCommission));
    if (d.mediaWorkerPay > 0) earningsRows += detail('Media Work Pay', formatMoney(d.mediaWorkerPay));
    if (d.beatProducerPay > 0) earningsRows += detail('Beat Sales', formatMoney(d.beatProducerPay));
    if ((d.packageCommission ?? 0) > 0) earningsRows += detail('Package Commission', formatMoney(d.packageCommission ?? 0));

    await resend.emails.send({
      from: FROM,
      to,
      subject: `Paystub — ${formatMoney(d.payoutAmount)} Payment${d.periodLabel ? ` (${d.periodLabel})` : ''}`,
      html: wrap(
        h1('PAYSTUB') +
        p(`${d.recipientName}, a payout of ${formatMoney(d.payoutAmount)} has been recorded for you.`) +
        detailTable(
          detail('Payout Amount', formatMoney(d.payoutAmount)) +
          detail('Method', d.method.charAt(0).toUpperCase() + d.method.slice(1).replace('_', ' ')) +
          (d.periodLabel ? detail('Period', d.periodLabel) : '') +
          (d.note ? detail('Note', d.note) : '') +
          detail('Date', new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))
        ) +
        (earningsRows ? (
          '<div style="margin:24px 0;padding:16px;border:1px solid #333;border-radius:4px">' +
          '<p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 12px">Earnings Summary</p>' +
          `<table style="width:100%;border-collapse:collapse">${earningsRows}</table>` +
          `<table style="width:100%;border-collapse:collapse;margin-top:12px;border-top:1px solid #444;padding-top:8px">` +
          detail('All-Time Earned', formatMoney(d.totalEarned)) +
          detail('All-Time Paid', formatMoney(d.totalPaid)) +
          detail('Remaining Balance', formatMoney(d.balanceAfter)) +
          '</table></div>'
        ) : '') +
        p('This paystub is for your records. If you have any questions about this payment, please reach out.') +
        btn('VIEW DASHBOARD', `${SITE_URL}/engineer`)
      ),
    });
  } catch (e) { console.error('Email error (paystub):', e); }
}

// ── Lease Expiry Emails ───────────────────────────────────────────────

export async function sendLeaseExpiryWarning(to: string, details: {
  buyerName: string;
  beatTitle: string;
  producerName: string;
  licenseType: string;
  expiresAt: string;
  renewalPrice: number;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Lease Expiring Soon',
    body: `Your ${details.licenseType} for "${details.beatTitle}" by ${details.producerName} expires ${details.expiresAt}. Renew for ${formatMoney(details.renewalPrice)} from /dashboard/purchases.`,
  });
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: `Your Lease Expires Soon — "${details.beatTitle}"`,
      html: wrap(
        h1('LEASE EXPIRING SOON') +
        p(`Hey ${details.buyerName}, your ${details.licenseType} for "${details.beatTitle}" by ${details.producerName} expires on <strong>${details.expiresAt}</strong>.`) +
        p(`Renew your license to continue streaming, distributing, and monetizing your music with this beat.`) +
        detailTable(
          detail('Beat', details.beatTitle) +
          detail('Producer', details.producerName) +
          detail('License', details.licenseType) +
          detail('Expires', details.expiresAt) +
          detail('Renewal Price', formatMoney(details.renewalPrice))
        ) +
        p('You can also upgrade to a Trackout Lease or Exclusive Rights from your purchases dashboard.') +
        btn('RENEW LICENSE', `${SITE_URL}/dashboard/purchases`) +
        '<br/><br/>' +
        p('For exclusive rights or questions, contact jayvalleo@sweetdreamsmusic.com or cole@sweetdreams.us')
      ),
    });
  } catch (e) { console.error('Email error (lease expiry warning):', e); }
}

export async function sendLeaseExpiredNotice(to: string, details: {
  buyerName: string;
  beatTitle: string;
  producerName: string;
  licenseType: string;
  renewalPrice: number;
  canRenew: boolean;
}) {
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: 'Lease Expired',
    body: details.canRenew
      ? `Your ${details.licenseType} for "${details.beatTitle}" by ${details.producerName} expired. Renew for ${formatMoney(details.renewalPrice)} (25% off) from /dashboard/purchases.`
      : `Your ${details.licenseType} for "${details.beatTitle}" by ${details.producerName} expired. Beat is now exclusive — please remove any content using this beat from distribution.`,
  });
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: `Lease Expired — "${details.beatTitle}"`,
      html: wrap(
        h1('LEASE EXPIRED') +
        p(`Hey ${details.buyerName}, your ${details.licenseType} for "${details.beatTitle}" by ${details.producerName} has expired.`) +
        (details.canRenew ? (
          p('Your license terms are no longer active. To continue using this beat in your music, please renew your license.') +
          detailTable(
            detail('Renewal Price', `${formatMoney(details.renewalPrice)} (25% off original)`)
          ) +
          btn('RENEW LICENSE', `${SITE_URL}/dashboard/purchases`)
        ) : (
          p('This beat has been sold exclusively to another buyer. Your license cannot be renewed. Please remove any content using this beat from distribution platforms.')
        )) +
        '<br/><br/>' +
        p('For questions, contact jayvalleo@sweetdreamsmusic.com or cole@sweetdreams.us')
      ),
    });
  } catch (e) { console.error('Email error (lease expired):', e); }
}

/**
 * Band invite email — sent when a band owner/admin invites a new member via email.
 * The acceptance link lands them at /bands/accept/[token] where they can review
 * the invite and either accept (creating or joining their account) or reject.
 */
export async function sendBandInviteEmail(details: {
  toEmail: string;
  bandName: string;
  inviterName: string;
  role: 'admin' | 'member';
  token: string;
}) {
  await mirrorToThread({
    userEmail: details.toEmail,
    kind: 'update',
    subject: `Band Invite — ${details.bandName}`,
    body: `${details.inviterName} invited you to join ${details.bandName} as ${details.role === 'admin' ? 'an admin' : 'a member'}. Review the invite to accept.`,
    attachments: [{ label: 'Review & accept', url: `${SITE_URL}/bands/accept/${details.token}`, kind: 'link' as const }],
  });
  try {
    const acceptUrl = `${SITE_URL}/bands/accept/${details.token}`;
    await resend.emails.send({
      from: FROM,
      to: details.toEmail,
      subject: `You're invited to join ${details.bandName} on Sweet Dreams Music`,
      html: wrap(`
        ${h1('Band Invite')}
        ${p(`<strong style="color:#fff">${details.inviterName}</strong> invited you to join <strong style="color:#F4C430">${details.bandName}</strong> as ${details.role === 'admin' ? 'an admin' : 'a member'}.`)}
        ${p('Sweet Dreams Music is a full-service studio in Fort Wayne, IN. The band hub lets you collaborate on bookings, releases, and live showcases with your bandmates.')}
        ${detailTable(`
          ${detail('Band', details.bandName)}
          ${detail('Role', details.role.charAt(0).toUpperCase() + details.role.slice(1))}
          ${detail('Invited by', details.inviterName)}
        `)}
        ${btn('Review & Accept Invite', acceptUrl)}
        ${p('<span style="color:#888;font-size:12px">This invite expires in 14 days. If you don\'t have a Sweet Dreams account yet, you\'ll be prompted to create one.</span>')}
      `),
    });
  } catch (e) { console.error('Email error (band invite):', e); }
}

/**
 * Band member joined notification.
 *
 * Fired after a band invite is accepted — sent to the band owner and every
 * existing member who has `can_manage_members = true`. The new joiner is NOT
 * notified (they obviously know they just joined).
 *
 * Recipients are passed in as a deduped list from the accept-invite handler;
 * this function just composes and sends. We swallow errors in a try/catch so
 * the API response isn't blocked on email delivery.
 */
export async function sendBandMemberJoinedNotification(
  recipientEmails: string[],
  details: {
    bandName: string;
    bandId: string;
    joinerName: string;
    joinerRole: 'admin' | 'member';
  },
) {
  if (recipientEmails.length === 0) return;
  // Mirror to every recipient's Sweet Dreams thread (each band manager
  // gets a copy in their own inbox).
  for (const email of recipientEmails) {
    await mirrorToThread({
      userEmail: email,
      kind: 'update',
      subject: `New member: ${details.bandName}`,
      body: `${details.joinerName} accepted their invite and joined ${details.bandName} as ${details.joinerRole === 'admin' ? 'an admin' : 'a member'}.`,
      attachments: [{ label: 'Open band hub', url: `${SITE_URL}/dashboard/bands/${details.bandId}`, kind: 'link' as const }],
    });
  }
  try {
    const bandUrl = `${SITE_URL}/dashboard/bands/${details.bandId}`;
    await resend.emails.send({
      from: FROM,
      to: recipientEmails,
      subject: `${details.joinerName} joined ${details.bandName}`,
      html: wrap(`
        ${h1('New Band Member')}
        ${p(`<strong style="color:#F4C430">${details.joinerName}</strong> just accepted their invite and joined <strong style="color:#fff">${details.bandName}</strong>.`)}
        ${detailTable(`
          ${detail('Band', details.bandName)}
          ${detail('New member', details.joinerName)}
          ${detail('Role', details.joinerRole === 'admin' ? 'Admin' : 'Member')}
        `)}
        ${btn('Open band hub', bandUrl)}
        ${p('<span style="color:#888;font-size:12px">You\'re receiving this because you manage members for this band. Head to the band hub to update their permissions or stage name.</span>')}
      `),
    });
  } catch (e) { console.error('Email error (band member joined):', e); }
}

/**
 * Event invitation email.
 *
 * Sent when an admin invites someone (by email) to an event. The accept URL
 * uses a token that lets the recipient confirm going / maybe / not_going
 * without needing to be logged in — they click through to /events/rsvp/[token]
 * which handles the response.
 *
 * We don't mention the event visibility to the invitee (no "this is private")
 * — they can infer it from the fact they got a personal invite, and exposing
 * the flag in the email body is unnecessary signal.
 */
export async function sendEventInvitation(details: {
  toEmail: string;
  eventTitle: string;
  eventSlug: string;
  eventStartsAt: string;  // ISO — we format for display
  eventLocation: string | null;
  inviterName: string;
  token: string;
  customNote?: string;    // optional personal note from the admin
}) {
  const acceptUrl = `${SITE_URL}/events/rsvp/${details.token}`;
  const whenFormatted = new Date(details.eventStartsAt).toLocaleString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  // Mirror to the invitee's Sweet Dreams thread if they're a registered
  // user. If the email doesn't match a profile, the helper logs a warning
  // and silently skips — invites to strangers don't create orphan threads.
  await mirrorToThread({
    userEmail: details.toEmail,
    kind: 'booking_notification',
    subject: `You're invited: ${details.eventTitle}`,
    body: `${details.inviterName} invited you to ${details.eventTitle} on ${whenFormatted}${details.eventLocation ? ` at ${details.eventLocation}` : ''}.${details.customNote ? `\n\nNote from ${details.inviterName}: ${details.customNote}` : ''}`,
    attachments: [{ label: 'RSVP', url: acceptUrl, kind: 'link' as const }],
  });
  try {
    await resend.emails.send({
      from: FROM,
      to: details.toEmail,
      subject: `You're invited: ${details.eventTitle}`,
      html: wrap(`
        ${h1("You're Invited")}
        ${p(`<strong style="color:#fff">${details.inviterName}</strong> invited you to <strong style="color:#F4C430">${details.eventTitle}</strong>.`)}
        ${detailTable(`
          ${detail('Event', details.eventTitle)}
          ${detail('When', whenFormatted)}
          ${details.eventLocation ? detail('Where', details.eventLocation) : ''}
          ${detail('Invited by', details.inviterName)}
        `)}
        ${details.customNote ? `
          <p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin:20px 0 8px">A note from ${details.inviterName}</p>
          <div style="background:#111;padding:16px;margin:0 0 16px;border-left:3px solid #F4C430">
            <p style="font-size:14px;color:#ccc;margin:0;white-space:pre-wrap">${details.customNote}</p>
          </div>
        ` : ''}
        ${btn('RSVP', acceptUrl)}
        ${p('<span style="color:#888;font-size:12px">Click RSVP to confirm. You can say yes, maybe, or no — no account needed.</span>')}
      `),
    });
  } catch (e) { console.error('Email error (event invitation):', e); }
}

/**
 * Request-to-attend alert for admins.
 *
 * Sent when a visitor requests to attend a `private_listed` event. Goes to
 * every SUPER_ADMIN so the first one to open it can approve/deny. Reply-to
 * is the requester's email, so hitting Reply in Gmail goes to them directly.
 */
export async function sendEventRsvpRequestAlert(details: {
  eventTitle: string;
  eventId: string;
  requesterName: string;
  requesterEmail: string;
  message: string;
  guestCount: number;
}) {
  try {
    const adminUrl = `${SITE_URL}/admin#events`;
    await resend.emails.send({
      from: FROM,
      to: [...SUPER_ADMINS],
      replyTo: details.requesterEmail,
      subject: `Request to attend: ${details.eventTitle}`,
      html: wrap(`
        ${h1('New Attendance Request')}
        ${p(`<strong style="color:#F4C430">${details.requesterName}</strong> wants to attend <strong style="color:#fff">${details.eventTitle}</strong>.`)}
        ${detailTable(`
          ${detail('Event', details.eventTitle)}
          ${detail('Requester', details.requesterName)}
          ${detail('Email', details.requesterEmail)}
          ${detail('Bringing', details.guestCount === 0 ? 'Just themselves' : `${details.guestCount} additional guest${details.guestCount > 1 ? 's' : ''}`)}
        `)}
        ${details.message ? `
          <p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin:20px 0 8px">Their message</p>
          <div style="background:#111;padding:16px;margin:0 0 16px;border-left:3px solid #F4C430">
            <p style="font-size:14px;color:#ccc;margin:0;white-space:pre-wrap">${details.message}</p>
          </div>
        ` : ''}
        ${btn('Open event admin', adminUrl)}
        ${p('<span style="color:#888;font-size:12px">Reply to this email to talk to the requester directly — replies go to their address.</span>')}
      `),
    });
  } catch (e) { console.error('Email error (event request alert):', e); }
}

/**
 * Request-to-attend decision email.
 *
 * Sent to the requester when an admin approves or denies their request to
 * attend a private_listed event. When approved, their RSVP row was updated
 * to status='going' — we tell them they're in.
 */
export async function sendEventRsvpDecision(details: {
  toEmail: string;
  eventTitle: string;
  eventSlug: string;
  eventStartsAt: string;
  eventLocation: string | null;
  approved: boolean;
  declineReason?: string;
}) {
  const eventUrl = `${SITE_URL}/events/${details.eventSlug}`;
  const whenFormatted = new Date(details.eventStartsAt).toLocaleString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  await mirrorToThread({
    userEmail: details.toEmail,
    kind: 'booking_notification',
    subject: details.approved
      ? `You're in: ${details.eventTitle}`
      : `About your request: ${details.eventTitle}`,
    body: details.approved
      ? `Your request to attend ${details.eventTitle} on ${whenFormatted}${details.eventLocation ? ` at ${details.eventLocation}` : ''} was approved. See you there.`
      : `We couldn't fit you in for ${details.eventTitle} this time.${details.declineReason ? `\n\n${details.declineReason}` : ''}\n\nKeep an eye on the events page for what's coming up next.`,
    attachments: [{
      label: details.approved ? 'View event details' : 'See upcoming events',
      url: details.approved ? eventUrl : `${SITE_URL}/events`,
      kind: 'link' as const,
    }],
  });
  try {
    await resend.emails.send({
      from: FROM,
      to: details.toEmail,
      subject: details.approved
        ? `You're in: ${details.eventTitle}`
        : `About your request: ${details.eventTitle}`,
      html: wrap(details.approved
        ? `
          ${h1("You're in")}
          ${p(`Your request to attend <strong style="color:#F4C430">${details.eventTitle}</strong> was approved. See you there.`)}
          ${detailTable(`
            ${detail('Event', details.eventTitle)}
            ${detail('When', whenFormatted)}
            ${details.eventLocation ? detail('Where', details.eventLocation) : ''}
          `)}
          ${btn('View event details', eventUrl)}
          ${p('<span style="color:#888;font-size:12px">Save the date — we look forward to seeing you.</span>')}
        `
        : `
          ${h1('About your request')}
          ${p(`We couldn't fit you in for <strong style="color:#fff">${details.eventTitle}</strong> this time.`)}
          ${details.declineReason ? `
            <div style="background:#111;padding:16px;margin:0 0 16px;border-left:3px solid #F4C430">
              <p style="font-size:14px;color:#ccc;margin:0;white-space:pre-wrap">${details.declineReason}</p>
            </div>
          ` : ''}
          ${p('We hope to see you at another Sweet Dreams Music event soon — keep an eye on the events page for what\'s coming up.')}
          ${btn('See upcoming events', `${SITE_URL}/events`)}
        `
      ),
    });
  } catch (e) { console.error('Email error (event rsvp decision):', e); }
}

/**
 * Event cancellation notification to everyone who RSVP'd.
 *
 * Fired from PATCH /api/admin/events/[id] when `is_cancelled` transitions
 * false→true. We BCC all attendees in a single send rather than N sends
 * — keeps us inside Resend's per-second cap and doesn't leak the roster
 * to other attendees. `toEmails` must only contain users who opted in
 * (status='going' or 'maybe'); `not_going` recipients are intentionally
 * skipped because they already said they weren't coming.
 */
export async function sendEventCancellation(details: {
  toEmails: string[];
  eventTitle: string;
  eventStartsAt: string; // ISO
  eventLocation: string | null;
  reason: string | null;
}) {
  if (details.toEmails.length === 0) return;
  const whenFormatted = new Date(details.eventStartsAt).toLocaleString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  // Mirror cancellation to each recipient's Sweet Dreams thread. The email
  // itself goes BCC (one send) but each user sees the cancellation in their
  // own thread, not pooled into a shared one.
  for (const recipientEmail of details.toEmails) {
    await mirrorToThread({
      userEmail: recipientEmail,
      kind: 'booking_notification',
      subject: `Cancelled: ${details.eventTitle}`,
      body: `${details.eventTitle} (was scheduled for ${whenFormatted}${details.eventLocation ? ` at ${details.eventLocation}` : ''}) has been cancelled.${details.reason ? `\n\nNote from the team: ${details.reason}` : ''}`,
      attachments: [{ label: 'See upcoming events', url: `${SITE_URL}/events`, kind: 'link' as const }],
    });
  }
  try {
    await resend.emails.send({
      from: FROM,
      to: FROM, // send-only address — real recipients go via bcc
      bcc: details.toEmails,
      subject: `Cancelled: ${details.eventTitle}`,
      html: wrap(`
        ${h1('Event Cancelled')}
        ${p(`<strong style="color:#fff">${details.eventTitle}</strong> has been cancelled.`)}
        ${detailTable(`
          ${detail('Event', details.eventTitle)}
          ${detail('Was scheduled for', whenFormatted)}
          ${details.eventLocation ? detail('Was at', details.eventLocation) : ''}
        `)}
        ${details.reason ? `
          <p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin:20px 0 8px">Note from the team</p>
          <div style="background:#111;padding:16px;margin:0 0 16px;border-left:3px solid #F4C430">
            <p style="font-size:14px;color:#ccc;margin:0;white-space:pre-wrap">${details.reason}</p>
          </div>
        ` : ''}
        ${p('We\'re sorry for the inconvenience. Keep an eye on our events page — we\'ll post anything we reschedule or replace this with.')}
        ${btn('See upcoming events', `${SITE_URL}/events`)}
      `),
    });
  } catch (e) { console.error('Email error (event cancellation):', e); }
}

/**
 * Media Hub purchase confirmation — sent to the buyer after Stripe webhook
 * processes a `media_purchase`. Wraps the offering title, total paid, the
 * configurator's selections (one bullet per slot), and the prepaid balance
 * granted (if any). Falls back gracefully when the package wasn't
 * configurable — `configurationLines` is just an empty array in that case
 * and the "Your build" panel is omitted.
 *
 * The "what happens next" copy mirrors what we tell session bookers:
 * production reaches out within 1 business day to lock dates. Phase D will
 * upgrade this to a direct calendar link when scheduling self-serves.
 */
export async function sendMediaPurchaseConfirmation(to: string, details: {
  buyerName: string;
  offeringTitle: string;
  amountPaid: number;
  studioHoursIncluded: number;
  bandAttached: boolean;
  configurationLines: string[];
  bookingId?: string;
}) {
  // Mirror into the booking thread (project-specific) so all the
  // back-and-forth about THIS order lives together. If we have no
  // bookingId fall back to the buyer's Sweet Dreams thread.
  await mirrorToThread({
    userEmail: to,
    mediaBookingId: details.bookingId,
    kind: 'booking_notification',
    subject: 'Order Confirmed',
    body: `Payment received for ${details.offeringTitle} (${formatMoney(details.amountPaid)}). ${details.studioHoursIncluded > 0 ? `${details.studioHoursIncluded} hours added to ${details.bandAttached ? 'your band' : 'your account'}'s prepaid balance. ` : ''}A producer reaches out within 1 business day to plan dates.`,
  });
  try {
    const ownerLabel = details.bandAttached ? 'your band' : 'your account';
    const buildSection = details.configurationLines.length > 0
      ? `
        <p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin:24px 0 8px">Your build</p>
        <div style="background:#111;padding:16px;margin:0 0 16px;border-left:3px solid #F4C430">
          <ul style="color:#ccc;font-size:14px;line-height:1.8;padding-left:20px;margin:0">
            ${details.configurationLines.map((line) => `<li>${line}</li>`).join('')}
          </ul>
        </div>
      `
      : '';
    const creditSection = details.studioHoursIncluded > 0
      ? `
        <div style="margin-top:24px;padding:20px;background:#111;border-left:3px solid #F4C430">
          ${p('<strong style="color:#F4C430">🎙️ Prepaid Studio Time</strong>')}
          ${p(`Your purchase loaded <strong>${details.studioHoursIncluded} hour${details.studioHoursIncluded === 1 ? '' : 's'}</strong> of recording time onto ${ownerLabel}'s prepaid balance. Schedule whenever you're ready — no expiration, no rush.`)}
        </div>
      `
      : '';

    await resend.emails.send({
      from: FROM,
      to,
      subject: `Order Confirmed — ${details.offeringTitle}`,
      html: wrap(
        h1('ORDER CONFIRMED') +
        p(`Hey ${details.buyerName}, we received your payment for <strong style="color:#F4C430">${details.offeringTitle}</strong>. Production starts now.`) +
        detailTable(
          detail('Order', details.offeringTitle) +
          detail('Total', formatMoney(details.amountPaid)) +
          (details.studioHoursIncluded > 0
            ? detail('Studio Hours', `${details.studioHoursIncluded} hr${details.studioHoursIncluded === 1 ? '' : 's'} added to ${ownerLabel}'s balance`)
            : '') +
          (details.bookingId ? detail('Reference', details.bookingId.slice(0, 8)) : '')
        ) +
        buildSection +
        creditSection +
        '<br/>' +
        p('A producer reaches out within 1 business day to lock in scheduling, gather any references, and walk you through next steps.') +
        btn('VIEW IN DASHBOARD', `${SITE_URL}/dashboard/media`) +
        p('<span style="color:#888;font-size:12px">Reply to this email if you need to flag anything before we start.</span>')
      ),
    });
  } catch (e) { console.error('Email error (media purchase confirmation):', e); }
}

/**
 * Admin alert for a media purchase. Goes to Cole + Jay so the production
 * team sees the order land in real time. Uses the same email the Sweet
 * Spot inquiries route to (`jayvalleo@sweetdreams.us`, `cole@sweetdreams.us`)
 * rather than the generic SUPER_ADMINS list — these are media-specific and
 * Jay's the production lead, not the studio operator.
 *
 * `replyTo` is set to the buyer's email so an admin hitting Reply lands in
 * the buyer's inbox, not back in the studio@ send-only address.
 */
export async function sendMediaPurchaseAdminAlert(details: {
  buyerName: string;
  buyerEmail: string;
  offeringTitle: string;
  amountPaid: number;
  studioHoursIncluded: number;
  bandAttached: boolean;
  configurationLines: string[];
  /** Round 6 additions — drive the "follow up by phone" call to action. */
  customerPhone?: string | null;
  fullPriceTotal?: number;
  depositPaid?: number;
  cartItemCount?: number;
}) {
  try {
    const buildSection = details.configurationLines.length > 0
      ? `
        <p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin:24px 0 8px">${
          (details.cartItemCount ?? 1) > 1 ? 'Cart contents' : 'Their build'
        }</p>
        <div style="background:#111;padding:16px;margin:0 0 16px;border-left:3px solid #F4C430">
          <ul style="color:#ccc;font-size:14px;line-height:1.8;padding-left:20px;margin:0">
            ${details.configurationLines.map((line) => `<li>${line}</li>`).join('')}
          </ul>
        </div>
      `
      : '';

    // Round 6: header callout for the follow-up call. Phone is THE
    // critical detail for admin — surface it loud + linked.
    const phone = details.customerPhone?.trim();
    const phoneCallout = phone
      ? `
        <div style="background:#F4C430;color:#000;padding:14px 18px;margin:0 0 20px;border-radius:2px">
          <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 6px;font-weight:700">📞 Call to plan</p>
          <p style="font-size:18px;margin:0;font-weight:700"><a href="tel:${phone.replace(/[^+\d]/g, '')}" style="color:#000;text-decoration:none">${phone}</a></p>
        </div>
      `
      : `
        <div style="background:#660000;color:#fff;padding:14px 18px;margin:0 0 20px;border-radius:2px">
          <p style="font-size:12px;margin:0;font-weight:700">⚠ No phone on file — reach out by email</p>
        </div>
      `;

    // Deposit / remainder breakdown when we know both numbers.
    const depositRow = details.fullPriceTotal != null && details.depositPaid != null
      ? detail(
          'Deposit / Total',
          `${formatMoney(details.depositPaid)} of ${formatMoney(details.fullPriceTotal)} — remainder ${formatMoney(
            details.fullPriceTotal - details.depositPaid,
          )}`,
        )
      : detail('Amount', formatMoney(details.amountPaid));

    const subject = `${(details.cartItemCount ?? 1) > 1 ? 'Cart' : 'Media Sale'} — ${
      details.offeringTitle
    } — Deposit ${formatMoney(details.amountPaid)}`;

    await resend.emails.send({
      from: FROM,
      to: ['jayvalleo@sweetdreams.us', 'cole@sweetdreams.us'],
      replyTo: details.buyerEmail,
      subject,
      html: wrap(
        h1((details.cartItemCount ?? 1) > 1 ? 'MEDIA CART SALE' : 'MEDIA SALE') +
        phoneCallout +
        p(`<strong style="color:#F4C430">${details.buyerName}</strong> just bought <strong>${details.offeringTitle}</strong>.`) +
        detailTable(
          detail('Buyer', details.buyerName) +
          detail('Email', details.buyerEmail) +
          (phone ? detail('Phone', phone) : '') +
          detail('Order', details.offeringTitle) +
          depositRow +
          (details.studioHoursIncluded > 0
            ? detail('Studio Hours', `${details.studioHoursIncluded} hr${details.studioHoursIncluded === 1 ? '' : 's'} (${details.bandAttached ? 'band balance' : 'personal balance'})`)
            : detail('Studio Hours', 'none')) +
          detail('Attribution', details.bandAttached ? 'Band' : 'Personal')
        ) +
        buildSection +
        btn('OPEN ADMIN', `${SITE_URL}/admin`) +
        p('<span style="color:#888;font-size:12px">Reply to this email to reach the buyer directly.</span>')
      ),
    });
  } catch (e) { console.error('Email error (media admin alert):', e); }
}

/**
 * Media session scheduling — buyer confirmation. Sent when a buyer schedules
 * a media_session_bookings row from their order detail page. Lays out the
 * date, time, location, and assigned engineer so the buyer's calendar
 * matches what's in our system.
 *
 * No re-scheduling link in the body for now — Phase D MVP requires cancel +
 * recreate. The button routes to the order detail page where they can
 * inspect or cancel.
 */
export async function sendMediaSessionScheduled(to: string, details: {
  buyerName: string;
  offeringTitle: string;
  sessionKindLabel: string;
  startsAt: string; // ISO
  endsAt: string;   // ISO
  location: 'studio' | 'external';
  externalLocationText: string | null;
  engineerName: string;
  bookingId?: string; // routes mirror into the booking thread when present
}) {
  const when = new Date(details.startsAt).toLocaleString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  const endTime = new Date(details.endsAt).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
  const locationLabel = details.location === 'studio'
    ? 'Sweet Dreams Studio (Fort Wayne)'
    : details.externalLocationText || 'External — details to follow';
  await mirrorToThread({
    userEmail: to,
    mediaBookingId: details.bookingId,
    kind: 'booking_notification',
    subject: 'Session Scheduled',
    body: `Your ${details.sessionKindLabel.toLowerCase()} for ${details.offeringTitle} is locked in: ${when} – ${endTime} with ${details.engineerName} at ${locationLabel}.`,
    attachments: [{ label: 'View order', url: `${SITE_URL}/dashboard/media/orders`, kind: 'link' as const }],
  });
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: `Session Scheduled — ${details.sessionKindLabel} for ${details.offeringTitle}`,
      html: wrap(
        h1('SESSION SCHEDULED') +
        p(`Hey ${details.buyerName}, your ${details.sessionKindLabel.toLowerCase()} for <strong>${details.offeringTitle}</strong> is locked in.`) +
        detailTable(
          detail('Type', details.sessionKindLabel) +
          detail('Engineer', details.engineerName) +
          detail('Starts', when) +
          detail('Ends', endTime) +
          detail('Location', locationLabel)
        ) +
        p('We\'ll send a reminder before the session. If you need to cancel, you can do that from your order page.') +
        btn('VIEW ORDER', `${SITE_URL}/dashboard/media/orders`)
      ),
    });
  } catch (e) { console.error('Email error (media session scheduled):', e); }
}

/**
 * Media session scheduling — engineer alert. Sent to the assigned engineer
 * the moment a buyer locks the session. Engineer's view of the world: who,
 * what, when, where, and any notes the buyer left.
 *
 * No "claim/decline" affordance — these sessions are pre-assigned (the
 * buyer picked the engineer in the form). If the engineer can't make it,
 * they coordinate with admin to reassign.
 */
export async function sendMediaSessionEngineerAlert(to: string, details: {
  engineerName: string;
  buyerName: string;
  offeringTitle: string;
  sessionKindLabel: string;
  startsAt: string;
  endsAt: string;
  location: 'studio' | 'external';
  externalLocationText: string | null;
  notes: string | null;
}) {
  try {
    const when = new Date(details.startsAt).toLocaleString('en-US', {
      weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
    const endTime = new Date(details.endsAt).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit',
    });
    const locationLabel = details.location === 'studio'
      ? 'Sweet Dreams Studio'
      : details.externalLocationText || 'External (location TBD)';
    const notesSection = details.notes
      ? `
        <p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin:20px 0 8px">Buyer notes</p>
        <div style="background:#111;padding:16px;margin:0 0 16px;border-left:3px solid #F4C430">
          <p style="font-size:14px;color:#ccc;margin:0;white-space:pre-wrap">${details.notes}</p>
        </div>
      `
      : '';
    await resend.emails.send({
      from: FROM,
      to,
      subject: `Media Session Booked — ${details.sessionKindLabel} for ${details.buyerName}`,
      html: wrap(
        h1('MEDIA SESSION BOOKED') +
        p(`Hey ${details.engineerName}, you've been assigned a ${details.sessionKindLabel.toLowerCase()} for <strong>${details.buyerName}</strong>.`) +
        detailTable(
          detail('Buyer', details.buyerName) +
          detail('Order', details.offeringTitle) +
          detail('Type', details.sessionKindLabel) +
          detail('Starts', when) +
          detail('Ends', endTime) +
          detail('Location', locationLabel)
        ) +
        notesSection +
        p('This session is on your calendar. Reach out to the buyer if you need to coordinate logistics — reply to this email goes to the team, not the buyer directly.') +
        btn('OPEN DASHBOARD', `${SITE_URL}/engineer`)
      ),
    });
  } catch (e) { console.error('Email error (media session engineer alert):', e); }
}

/**
 * Media session reminder (1 hour before). Mirrors `sendSessionReminder` for
 * studio bookings but routes through the media-session shape. The cron at
 * /api/cron/session-reminders fans this out alongside studio reminders so
 * every kind of session in the system gets the same hour-before nudge.
 */
export async function sendMediaSessionReminder(to: string, details: {
  buyerName: string;
  sessionKindLabel: string;
  startsAt: string;
  endsAt: string;
  location: 'studio' | 'external';
  externalLocationText: string | null;
  engineerName: string;
  bookingId?: string; // routes mirror into the booking thread when present
}) {
  const start = new Date(details.startsAt);
  const end = new Date(details.endsAt);
  const startLabel = start.toLocaleString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const endLabel = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const locationLabel = details.location === 'studio'
    ? 'Sweet Dreams Studio (Fort Wayne)'
    : details.externalLocationText || 'External — see scheduling notes';
  await mirrorToThread({
    userEmail: to,
    mediaBookingId: details.bookingId,
    kind: 'update',
    subject: 'Session in 1 hour',
    body: `Heads up — your ${details.sessionKindLabel.toLowerCase()} starts in about an hour. ${startLabel} – ${endLabel}, ${locationLabel}, with ${details.engineerName}.`,
  });
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: `Session in 1 Hour — ${details.sessionKindLabel}`,
      html: wrap(
        h1('SESSION REMINDER') +
        p(`Hey ${details.buyerName}, your ${details.sessionKindLabel.toLowerCase()} starts in about 1 hour.`) +
        detailTable(
          detail('Type', details.sessionKindLabel) +
          detail('When', `${startLabel} – ${endLabel}`) +
          detail('Where', locationLabel) +
          detail('Engineer', details.engineerName)
        ) +
        p('Arrive a few minutes early. See you soon!')
      ),
    });
  } catch (e) { console.error('Email error (media session reminder):', e); }
}

/**
 * Media session reminder for the engineer. Same window, different audience —
 * the engineer needs the same heads-up as the buyer.
 */
export async function sendMediaSessionReminderToEngineer(to: string, details: {
  engineerName: string;
  buyerName: string;
  sessionKindLabel: string;
  startsAt: string;
  endsAt: string;
  location: 'studio' | 'external';
  externalLocationText: string | null;
}) {
  try {
    const start = new Date(details.startsAt);
    const end = new Date(details.endsAt);
    const startLabel = start.toLocaleString('en-US', {
      weekday: 'short', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
    const endLabel = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const locationLabel = details.location === 'studio'
      ? 'Sweet Dreams Studio'
      : details.externalLocationText || 'External (see scheduling notes)';
    await resend.emails.send({
      from: FROM,
      to,
      subject: `Heads up — ${details.sessionKindLabel} for ${details.buyerName} in 1 hour`,
      html: wrap(
        h1('UPCOMING MEDIA SESSION') +
        p(`Hey ${details.engineerName}, your ${details.sessionKindLabel.toLowerCase()} with ${details.buyerName} kicks off in about an hour.`) +
        detailTable(
          detail('Buyer', details.buyerName) +
          detail('Type', details.sessionKindLabel) +
          detail('When', `${startLabel} – ${endLabel}`) +
          detail('Where', locationLabel)
        ) +
        p('Reply to the team if anything\'s off — you don\'t need to confirm.')
      ),
    });
  } catch (e) { console.error('Email error (media session engineer reminder):', e); }
}

/**
 * Media deliverables ready — sent to the buyer the FIRST time admin attaches
 * deliverables to a media_bookings row (transition from no deliverables to
 * having deliverables). Subsequent additions don't fire this email, both to
 * avoid spam and because the spec called for a "first deliverable" trigger
 * specifically. Admin who wants to flag a major batch update can email
 * directly.
 *
 * The CTA points back to the order detail page where the items are listed.
 */
export async function sendMediaDeliverablesReady(to: string, details: {
  buyerName: string;
  offeringTitle: string;
  bookingId: string;
  itemCount: number;
}) {
  await mirrorToThread({
    userEmail: to,
    mediaBookingId: details.bookingId,
    kind: 'booking_notification',
    subject: 'Your files are ready',
    body: `The first deliverables for ${details.offeringTitle} are live in your dashboard — ${details.itemCount} item${details.itemCount === 1 ? '' : 's'} ready to download.`,
    attachments: [{ label: 'Open order', url: `${SITE_URL}/dashboard/media/orders/${details.bookingId}`, kind: 'link' as const }],
  });
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: `Your Files Are Ready — ${details.offeringTitle}`,
      html: wrap(
        h1('YOUR FILES ARE READY') +
        p(`Hey ${details.buyerName}, the first deliverables for <strong>${details.offeringTitle}</strong> just landed in your dashboard.`) +
        detailTable(
          detail('Order', details.offeringTitle) +
          detail('Files Ready', `${details.itemCount} item${details.itemCount === 1 ? '' : 's'}`)
        ) +
        p('Open your order to download. We\'ll keep adding items as production wraps — feel free to bookmark the page.') +
        btn('OPEN ORDER', `${SITE_URL}/dashboard/media/orders/${details.bookingId}`) +
        p('<span style="color:#888;font-size:12px">If anything looks off, reply to this email and we\'ll sort it out.</span>')
      ),
    });
  } catch (e) { console.error('Email error (deliverables ready):', e); }
}

/**
 * Media payment link — sent when admin charges a media remainder via
 * the link method (saved card unavailable / admin chose to email
 * instead). Mirrors `sendPaymentLink` for studio sessions but
 * routes to the media order page on completion.
 */
export async function sendMediaPaymentLink(to: string, details: {
  buyerName: string;
  amount: number;
  paymentUrl: string;
  bookingId: string;
}) {
  await mirrorToThread({
    userEmail: to,
    mediaBookingId: details.bookingId,
    kind: 'booking_notification',
    subject: 'Remaining balance',
    body: `Your media order is ready for the next step — please pay the remaining balance of ${formatMoney(details.amount)} to keep production moving.`,
    attachments: [{ label: 'Pay now', url: details.paymentUrl, kind: 'link' as const }],
  });
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: 'Complete Your Media Order Balance — Sweet Dreams Music',
      html: wrap(
        h1('Remaining Balance') +
        p(`Hey ${details.buyerName}, your media order is ready for the next step.`) +
        p('Please pay the remaining balance below to keep production moving.') +
        detailTable(
          detail('Amount Due', formatMoney(details.amount)) +
          detail('Order', `#${details.bookingId.slice(0, 8)}`)
        ) +
        btn('PAY NOW', details.paymentUrl) +
        p('<span style="color:#666;font-size:11px">This is a secure payment link powered by Stripe. If you have any questions, reply to this email.</span>')
      ),
    });
  } catch (e) { console.error('Email error (media payment link):', e); }
}

/**
 * Media component ready — sent when admin marks a single piece of a
 * media order as completed AND attaches a Google Drive link. Sent ONCE
 * per piece (the API tracks notified_at to prevent re-sends).
 *
 * Subject line includes the component name so the buyer can quickly
 * spot which piece dropped — useful for multi-component packages
 * where 4-5 emails arrive over the production timeline.
 */
export async function sendMediaComponentReady(to: string, details: {
  buyerName: string;
  offeringTitle: string;
  componentLabel: string;
  driveUrl: string;
  bookingId: string;
}) {
  // Mirror to the booking thread — context lives with the project.
  await mirrorToThread({
    mediaBookingId: details.bookingId,
    kind: 'booking_notification',
    subject: `${details.componentLabel} ready`,
    body: `${details.componentLabel} for ${details.offeringTitle} is live. Download from Google Drive.`,
    attachments: [
      { label: details.componentLabel, url: details.driveUrl, kind: 'file' as const },
    ],
  });
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: `${details.componentLabel} is ready — ${details.offeringTitle}`,
      html: wrap(
        h1('YOUR FILES ARE READY') +
        p(`Hey ${details.buyerName}, the <strong style="color:#F4C430">${details.componentLabel}</strong> piece of your <strong>${details.offeringTitle}</strong> just landed.`) +
        p('Tap below to download from Google Drive — videos and high-res files are big, so we host the assets directly on Drive instead of email.') +
        btn('DOWNLOAD FROM DRIVE', details.driveUrl) +
        p('<span style="color:#666;font-size:11px">If the link doesn\'t work, paste this URL into your browser:</span>') +
        `<p style="font-size:11px;color:#888;word-break:break-all;margin:0 0 16px">${details.driveUrl}</p>` +
        p(`Other pieces in your order are still in production — you'll get an email like this for each one as it's done. <a href="${SITE_URL}/dashboard/media/orders/${details.bookingId}" style="color:#F4C430">Track everything in your dashboard</a>.`)
      ),
    });
  } catch (e) { console.error('Email error (media component ready):', e); }
}

/**
 * Media inquiry email — sent when a user submits the inquiry form on a
 * range-priced or band-by-request offering. Routes to the same inbox as
 * media purchase alerts (Cole + Jay) so leads get the same eyeballs.
 */
export async function sendMediaInquiry(details: {
  inquirerName: string;
  inquirerEmail: string;
  inquirerPhone?: string | null;
  offeringTitle: string;
  offeringSlug: string;
  bandName: string | null;
  message: string;
}) {
  try {
    const phone = details.inquirerPhone?.trim();
    // Same hot-CTA banner as the purchase admin alert: phone is the
    // primary follow-up channel for inquiries, surface it loud.
    const phoneCallout = phone
      ? `
        <div style="background:#F4C430;color:#000;padding:14px 18px;margin:0 0 20px">
          <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 6px;font-weight:700">📞 Call to plan</p>
          <p style="font-size:18px;margin:0;font-weight:700"><a href="tel:${phone.replace(/[^+\d]/g, '')}" style="color:#000;text-decoration:none">${phone}</a></p>
        </div>
      `
      : '';
    await resend.emails.send({
      from: FROM,
      to: ['jayvalleo@sweetdreams.us', 'cole@sweetdreams.us'],
      replyTo: details.inquirerEmail,
      subject: `Media Inquiry — ${details.offeringTitle}${details.bandName ? ` (${details.bandName})` : ''}`,
      html: wrap(
        h1('MEDIA INQUIRY') +
        phoneCallout +
        p(`<strong style="color:#F4C430">${details.inquirerName}</strong> wants to talk about <strong>${details.offeringTitle}</strong>.`) +
        detailTable(
          detail('Inquirer', details.inquirerName) +
          detail('Email', details.inquirerEmail) +
          (phone ? detail('Phone', phone) : '') +
          (details.bandName ? detail('Band', details.bandName) : '') +
          detail('Offering', details.offeringTitle) +
          detail('Slug', details.offeringSlug)
        ) +
        `
          <p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin:20px 0 8px">Their message</p>
          <div style="background:#111;padding:16px;margin:0 0 16px;border-left:3px solid #F4C430">
            <p style="font-size:14px;color:#ccc;margin:0;white-space:pre-wrap">${details.message}</p>
          </div>
        ` +
        p('<span style="color:#888;font-size:12px">Reply to this email to reach the inquirer directly.</span>')
      ),
    });
  } catch (e) { console.error('Email error (media inquiry):', e); }
}

/**
 * Sweet Spot inquiry email.
 *
 * Sent to Jay + Cole when a band (or a prospective band) fills out the Sweet Spot
 * inquiry form at /bands/sweet-spot/inquire. Distinct from the generic contact
 * form so Jay and Cole can filter these as "Sweet Spot leads" in their inbox
 * instead of wading through all site contact submissions.
 *
 * `replyTo` is set to the inquirer's email so hitting Reply in Gmail goes
 * straight back to them, not to our send-only studio@ address.
 */
export async function sendSweetSpotInquiry(details: {
  name: string;
  bandName: string;
  email: string;
  phone: string;
  preferredTime: string;
  message: string;
}) {
  try {
    await resend.emails.send({
      from: FROM,
      to: ['jayvalleo@sweetdreams.us', 'cole@sweetdreams.us'],
      replyTo: details.email,
      subject: `Sweet Spot Inquiry — ${details.bandName}`,
      html: wrap(`
        ${h1('Sweet Spot Inquiry')}
        ${p(`<strong style="color:#F4C430">${details.bandName}</strong> wants to set up a 30-min call about the Sweet Spot.`)}
        ${detailTable(`
          ${detail('Band', details.bandName)}
          ${detail('Contact', details.name)}
          ${detail('Email', details.email)}
          ${detail('Phone', details.phone)}
          ${detail('Preferred call time', details.preferredTime)}
        `)}
        ${details.message ? `
          <p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin:20px 0 8px">Additional notes</p>
          <div style="background:#111;padding:16px;margin:0 0 16px;border-left:3px solid #F4C430">
            <p style="font-size:14px;color:#ccc;margin:0;white-space:pre-wrap">${details.message}</p>
          </div>
        ` : ''}
        ${p('<span style="color:#888;font-size:12px">Reply directly to this email to reach the band — replies go to their address, not studio@.</span>')}
      `),
    });
  } catch (e) { console.error('Email error (sweet spot inquiry):', e); }
}

/**
 * Round 8b: notification when someone posts a new message to a media
 * booking thread. Recipients depend on who wrote the message:
 *   • buyer or engineer wrote → admins (Cole + Jay) get notified
 *   • admin wrote             → buyer's email gets notified
 *
 * The body is a preview only (240 chars) — full thread lives at the order
 * page. Email exists to bring the other side back to the site.
 *
 * Service-client lookup of buyer email + admin emails happens before this
 * helper is called (POST route does it). We just need the rendered fields.
 */
export async function sendNewMediaMessageNotification(args: {
  bookingId: string;
  authorRole: 'admin' | 'buyer' | 'engineer';
  authorName: string;
  bodyPreview: string;
  hasAttachments: boolean;
}) {
  try {
    // Resolve recipients + the buyer email/order URL via the service
    // client. Lazy import to keep this module client-safe wherever it's
    // included.
    const { createServiceClient } = await import('@/lib/supabase/server');
    const service = createServiceClient();

    const { data: bookingRow } = await service
      .from('media_bookings')
      .select('id, user_id, band_id')
      .eq('id', args.bookingId)
      .maybeSingle();
    if (!bookingRow) return;
    const booking = bookingRow as { id: string; user_id: string; band_id: string | null };

    // Resolve buyer email — auth.users + profiles.
    let buyerEmail: string | null = null;
    try {
      const { data: u } = await service.auth.admin.getUserById(booking.user_id);
      buyerEmail = u?.user?.email ?? null;
    } catch { /* best-effort */ }

    const orderUrl = `${SITE_URL}/dashboard/media/orders/${args.bookingId}`;
    const adminUrl = `${SITE_URL}/admin`;
    // SECURITY: bodyPreview is user-supplied. escapeHtml prevents XSS in
    // admin inboxes (a buyer could otherwise embed <script>/<img onerror>).
    const previewHtml = args.bodyPreview
      ? `<blockquote style="border-left:3px solid #F4C430;padding:8px 12px;margin:0;color:#ccc;font-size:14px">${escapeHtml(args.bodyPreview)}</blockquote>`
      : `<p style="color:#888;font-size:13px;font-style:italic;margin:0">[attachment-only message]</p>`;
    const safeAuthorName = escapeHtml(args.authorName);
    const attachmentNote = args.hasAttachments
      ? p('<span style="color:#F4C430;font-size:12px;font-weight:700">📎 Attachments included</span>')
      : '';

    if (args.authorRole === 'admin') {
      // Notify the buyer.
      if (buyerEmail) {
        await resend.emails.send({
          from: FROM,
          to: buyerEmail,
          subject: `New message about your order from ${safeAuthorName}`,
          html: wrap(
            h1('NEW MESSAGE') +
            p(`<strong style="color:#F4C430">${safeAuthorName}</strong> sent you a message about your media order.`) +
            previewHtml +
            attachmentNote +
            btn('Open conversation', orderUrl)
          ),
        });
      }
    } else {
      // Buyer or engineer wrote — notify admins.
      await resend.emails.send({
        from: FROM,
        to: [...SUPER_ADMINS],
        subject: `New ${args.authorRole} message — order ${args.bookingId.slice(0, 8)}`,
        html: wrap(
          h1('NEW MESSAGE') +
          p(`<strong style="color:#F4C430">${safeAuthorName}</strong> (${args.authorRole}) just posted on a media order.`) +
          previewHtml +
          attachmentNote +
          btn('Open in admin', adminUrl)
        ),
      });
    }
  } catch (e) { console.error('Email error (new media message):', e); }
}

// ── Package quotes ────────────────────────────────────────────────────
//
// Round C: when admin sends a quote, the customer receives a branded
// email with the link to /quotes/[token] where they can view + accept.
// Mirrored into the recipient's Sweet Dreams thread so the in-app
// inbox stays the source of truth.

export interface PackageQuoteEmailLine {
  /** Display label, e.g. "12 studio hours" or "Music Video — Sweet Spot" */
  label: string;
  /** Full retail value of this line in cents, for the "what it's worth" column */
  full_price_cents: number;
}

/**
 * Email + thread mirror for a sent package quote.
 *
 * The HTML body is intentionally lightweight — a customer-facing
 * quote needs to be readable in 5 seconds. The headline is the price,
 * the second line is the savings vs retail, the third is the CTA. The
 * full line breakdown lives on the /quotes/[token] page; we don't
 * try to recreate it inside the email.
 */
export async function sendPackageQuote(to: string, details: {
  recipientName: string;
  templateName: string;
  templateDescription?: string | null;
  isMembership: boolean;
  membershipMonths?: number | null;
  durationDays?: number | null;
  pricePerMonthCents?: number | null; // membership only
  totalPriceCents: number;             // one-off total OR membership total contract value
  retailPriceCents: number;            // sum of full retail line values
  lines: PackageQuoteEmailLine[];
  customerMessage?: string | null;
  expiresAt: string;                   // ISO
  token: string;
  inviterName: string;
}) {
  const reviewUrl = `${SITE_URL}/quotes/${details.token}`;
  const discountCents = Math.max(0, details.retailPriceCents - details.totalPriceCents);
  const discountPct = details.retailPriceCents > 0
    ? Math.round((discountCents / details.retailPriceCents) * 100)
    : 0;

  const expiryFormatted = new Date(details.expiresAt).toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric',
  });

  // Mirror to the recipient's Sweet Dreams thread.
  await mirrorToThread({
    userEmail: to,
    kind: 'booking_notification',
    subject: `New quote: ${details.templateName}`,
    body: details.isMembership
      ? `${details.inviterName} sent you a ${details.membershipMonths}-month membership quote for "${details.templateName}". ${formatMoney(details.pricePerMonthCents ?? 0)}/month × ${details.membershipMonths} months = ${formatMoney(details.totalPriceCents)} total. ${discountCents > 0 ? `${discountPct}% off retail. ` : ''}Review and accept by ${expiryFormatted}.`
      : `${details.inviterName} sent you a quote for "${details.templateName}". ${formatMoney(details.totalPriceCents)} ${discountCents > 0 ? `(${discountPct}% off retail). ` : ''}Review and accept by ${expiryFormatted}.`,
    attachments: [{ label: 'Review quote', url: reviewUrl, kind: 'link' as const }],
  });

  try {
    const linesHtml = details.lines.map((l) =>
      detail(l.label, formatMoney(l.full_price_cents))
    ).join('');

    const priceBlock = details.isMembership
      ? `
        <div style="background:#111;padding:20px;margin:16px 0;border-left:3px solid #F4C430">
          <p style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 6px">Per month</p>
          <p style="font-size:28px;font-weight:700;color:#F4C430;margin:0">${formatMoney(details.pricePerMonthCents ?? 0)}</p>
          <p style="font-size:12px;color:#aaa;margin:8px 0 0">
            × ${details.membershipMonths} months = <strong>${formatMoney(details.totalPriceCents)}</strong> total
          </p>
        </div>
      `
      : `
        <div style="background:#111;padding:20px;margin:16px 0;border-left:3px solid #F4C430">
          <p style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 6px">One-time</p>
          <p style="font-size:28px;font-weight:700;color:#F4C430;margin:0">${formatMoney(details.totalPriceCents)}</p>
          ${details.durationDays ? `<p style="font-size:12px;color:#aaa;margin:8px 0 0">Valid for ${details.durationDays} days after acceptance</p>` : ''}
        </div>
      `;

    const savingsBlock = discountCents > 0
      ? `<p style="font-size:13px;color:#aaa;margin:0 0 12px"><span style="color:#F4C430;font-weight:700">${discountPct}% off retail</span> &mdash; saving ${formatMoney(discountCents)} compared to buying these à la carte.</p>`
      : '';

    const noteBlock = details.customerMessage
      ? `
        <p style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin:24px 0 8px">A note from ${escapeHtml(details.inviterName)}</p>
        <div style="background:#111;padding:16px;margin:0 0 16px;border-left:3px solid #F4C430">
          <p style="font-size:14px;color:#ccc;margin:0;white-space:pre-wrap">${escapeHtml(details.customerMessage)}</p>
        </div>
      `
      : '';

    await resend.emails.send({
      from: FROM,
      to,
      subject: `Quote: ${details.templateName}`,
      html: wrap(
        h1("YOU'VE GOT A QUOTE") +
        p(`Hey ${escapeHtml(details.recipientName)}, ${escapeHtml(details.inviterName)} put together a package for you.`) +
        priceBlock +
        savingsBlock +
        `<p style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.1em;margin:24px 0 8px">What's included</p>` +
        `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:16px">${linesHtml}</table>` +
        noteBlock +
        btn('Review & accept', reviewUrl) +
        p(`<span style="color:#888;font-size:12px">This quote expires on ${expiryFormatted}. Click the button to view the full breakdown and accept.</span>`)
      ),
    });
  } catch (e) { console.error('Email error (package quote):', e); }
}

/**
 * Admin-facing notification when a customer accepts a quote. Goes to
 * SUPER_ADMINS so payment plumbing can pick up the next step.
 */
export async function sendPackageQuoteAccepted(details: {
  templateName: string;
  recipientName: string;
  recipientEmail: string;
  totalPriceCents: number;
  isMembership: boolean;
  quoteId: string;
}) {
  try {
    await resend.emails.send({
      from: FROM,
      to: [...SUPER_ADMINS],
      replyTo: details.recipientEmail,
      subject: `Quote accepted: ${details.templateName} — ${details.recipientName}`,
      html: wrap(
        h1('QUOTE ACCEPTED') +
        p(`<strong style="color:#F4C430">${escapeHtml(details.recipientName)}</strong> accepted the quote for <strong>${escapeHtml(details.templateName)}</strong>.`) +
        `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:16px 0">${
          detail('Customer', escapeHtml(details.recipientName)) +
          detail('Email', escapeHtml(details.recipientEmail)) +
          detail('Package', escapeHtml(details.templateName)) +
          detail('Type', details.isMembership ? 'Membership (monthly billing)' : 'One-time') +
          detail('Total', formatMoney(details.totalPriceCents))
        }</table>` +
        p('Payment plumbing comes in Round D. For now, this notification confirms the customer is committed.') +
        btn('Open admin', `${SITE_URL}/admin`)
      ),
    });
  } catch (e) { console.error('Email error (quote accepted admin):', e); }
}

/**
 * Admin-facing notification when a customer declines.
 */
export async function sendPackageQuoteDeclined(details: {
  templateName: string;
  recipientName: string;
  recipientEmail: string;
  declineReason?: string | null;
}) {
  try {
    await resend.emails.send({
      from: FROM,
      to: [...SUPER_ADMINS],
      replyTo: details.recipientEmail,
      subject: `Quote declined: ${details.templateName} — ${details.recipientName}`,
      html: wrap(
        h1('QUOTE DECLINED') +
        p(`<strong>${escapeHtml(details.recipientName)}</strong> declined the quote for <strong>${escapeHtml(details.templateName)}</strong>.`) +
        (details.declineReason
          ? `<div style="background:#111;padding:16px;margin:16px 0;border-left:3px solid #F4C430"><p style="font-size:14px;color:#ccc;margin:0;white-space:pre-wrap">${escapeHtml(details.declineReason)}</p></div>`
          : '') +
        p('Worth a follow-up — reply to this email to land in the customer\'s inbox.')
      ),
    });
  } catch (e) { console.error('Email error (quote declined admin):', e); }
}
