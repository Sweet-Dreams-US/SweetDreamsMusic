import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_URL } from '@/lib/constants';
import LegalPage, { LegalSection } from '@/components/legal/LegalPage';

// Required by Meta App Review (valid Privacy Policy URL) — always reachable,
// never feature-flag gated.

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Sweet Dreams Music LLC collects, uses, and protects your information.',
  alternates: { canonical: `${SITE_URL}/privacy-policy` },
  robots: { index: true, follow: true },
};

const UPDATED = 'July 6, 2026';

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="PRIVACY POLICY" updated={UPDATED}>
      <LegalSection heading="Who we are">
        <p>
          Sweet Dreams Music LLC (&quot;Sweet Dreams,&quot; &quot;we,&quot; &quot;us&quot;) operates a recording
          studio, beat marketplace, and media-production business in Fort Wayne, Indiana, and the
          website sweetdreamsmusic.com (the &quot;Service&quot;). This policy explains what information we
          collect, how we use it, and the choices you have. Questions: <a className="text-accent underline" href="mailto:cole@marcuccilli.com">cole@marcuccilli.com</a>.
        </p>
      </LegalSection>

      <LegalSection heading="Information we collect">
        <p><strong>Account &amp; profile.</strong> Name, email address, phone number, artist/display name, profile photos, bio, genres, and social/streaming platform links you choose to connect.</p>
        <p><strong>Bookings &amp; purchases.</strong> Session details (date, time, room, engineer), beat purchases and license records, media-production orders and contracts, and payment records. Card payments are processed by Stripe — we never see or store your full card number.</p>
        <p><strong>Communications.</strong> Messages you send through the site (chat, inquiries, contact forms) and emails we exchange with you.</p>
        <p><strong>Usage &amp; analytics.</strong> Pages visited and actions taken on the site, collected via cookies and similar technologies through Meta Pixel, Google Analytics, and Vercel Analytics. This may include IP address, device/browser type, and referral source.</p>
      </LegalSection>

      <LegalSection heading="How we use information">
        <p>To provide the Service: schedule and manage sessions, deliver purchased beats and licenses, fulfill media-production contracts, process payments and deposits, and send transactional emails (confirmations, reminders, receipts).</p>
        <p>To improve and market the Service: understand how the site is used, measure the performance of our advertising (including Meta ads), and — where permitted — show you relevant ads. To administer rewards and referral programs. To prevent fraud and enforce our <Link className="text-accent underline" href="/tos">Terms of Service</Link>.</p>
      </LegalSection>

      <LegalSection heading="Who we share it with">
        <p>We do not sell your personal information. We share it only with service providers who help us run the Service, under their own privacy commitments:</p>
        <p>Supabase (database &amp; authentication) · Stripe (payments) · Resend (email delivery) · Vercel (hosting &amp; analytics) · Meta Platforms (advertising measurement via Meta Pixel and, for business-tool features, the Marketing API) · Google (analytics). We may also disclose information when required by law.</p>
      </LegalSection>

      <LegalSection heading="Meta platform data">
        <p>
          If a business administrator connects Meta business tools (ad accounts, Facebook Pages, or
          Instagram accounts) to the Service, we access that data solely to display advertising
          performance, audience, lead, and content insights to that business inside its own
          dashboard, and to perform actions the administrator explicitly requests. We do not sell
          or share Meta platform data with third parties, and we retain it only as long as the
          connection remains active or as required for those features.
        </p>
      </LegalSection>

      <LegalSection heading="Cookies & tracking">
        <p>
          We use cookies and pixels (Meta Pixel, Google Analytics, Vercel Analytics) to keep you
          signed in, remember preferences, and measure site usage and ad performance. You can
          control cookies through your browser settings; ad-measurement opt-outs are available
          through <a className="text-accent underline" href="https://www.facebook.com/adpreferences" target="_blank" rel="noopener noreferrer">Meta ad preferences</a> and
          the <a className="text-accent underline" href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">Google Analytics opt-out</a>.
        </p>
      </LegalSection>

      <LegalSection heading="Retention & security">
        <p>
          We keep account and profile data while your account is active. Booking, purchase, and
          payment records are retained as long as needed for accounting, tax, and legal
          obligations. Data is stored with access controls (including row-level security) and
          encrypted in transit.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights & choices">
        <p>
          You can view and edit your profile from your dashboard at any time. You may request a
          copy of your data, correction, or deletion — see{' '}
          <Link className="text-accent underline" href="/user-data-deletion">User Data Deletion</Link>{' '}
          for how deletion works. Depending on where you live, you may have additional rights
          under laws such as GDPR or CCPA; we honor verified requests accordingly.
        </p>
      </LegalSection>

      <LegalSection heading="Children">
        <p>The Service is not directed to children under 13, and we do not knowingly collect their information. If you believe a child under 13 has provided us data, contact us and we will delete it.</p>
      </LegalSection>

      <LegalSection heading="Changes & contact">
        <p>
          We may update this policy; the &quot;Last updated&quot; date above reflects the current
          version, and material changes will be posted on this page. Contact:{' '}
          <a className="text-accent underline" href="mailto:cole@marcuccilli.com">cole@marcuccilli.com</a> — Sweet Dreams Music LLC, Fort Wayne, Indiana, USA.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
