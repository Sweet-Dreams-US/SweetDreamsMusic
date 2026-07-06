import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_URL } from '@/lib/constants';
import LegalPage, { LegalSection } from '@/components/legal/LegalPage';

// Required by Meta App Review (valid Terms of Service URL) — always reachable,
// never feature-flag gated.

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms that govern use of Sweet Dreams Music LLC’s website, studio bookings, beat store, and media services.',
  alternates: { canonical: `${SITE_URL}/tos` },
  robots: { index: true, follow: true },
};

const UPDATED = 'July 6, 2026';

export default function TermsOfServicePage() {
  return (
    <LegalPage title="TERMS OF SERVICE" updated={UPDATED}>
      <LegalSection heading="Agreement">
        <p>
          These Terms of Service (&quot;Terms&quot;) are a binding agreement between you and Sweet Dreams
          Music LLC (&quot;Sweet Dreams,&quot; &quot;we,&quot; &quot;us&quot;), an Indiana limited liability company. By
          using sweetdreamsmusic.com or any of our services — studio bookings, the beat store,
          media production, and artist tools (together, the &quot;Service&quot;) — you accept these Terms
          and our <Link className="text-accent underline" href="/privacy-policy">Privacy Policy</Link>. If you do not agree, do not use the Service.
        </p>
      </LegalSection>

      <LegalSection heading="Accounts">
        <p>
          You must be at least 13 years old to use the Service and at least 18 (or have a parent
          or guardian&apos;s consent) to enter paid transactions. You are responsible for your account
          credentials and for activity under your account. Provide accurate information and keep
          it current.
        </p>
      </LegalSection>

      <LegalSection heading="Studio bookings & payments">
        <p>
          Sessions are reserved with a deposit (typically 50% of the session total) charged at
          booking; the remainder is due as stated at checkout or after the session. Time-based
          surcharges (late-night, after-hours, booking rush fees, guest fees) are displayed before
          you pay. All amounts are in USD; payments are processed by Stripe.
        </p>
        <p>
          Rescheduling and cancellation: contact us as early as possible. Deposits for late
          cancellations or no-shows may be retained to compensate for the reserved time. Sessions
          begin and end at their scheduled times; arriving late does not extend the session.
        </p>
      </LegalSection>

      <LegalSection heading="Beat store & licenses">
        <p>
          Beats are sold under the specific license presented at purchase (e.g., lease or
          exclusive). The license delivered with your purchase governs your rights; producers
          retain all rights not expressly granted. You may not resell, redistribute, or claim
          authorship of purchased beats outside the license terms.
        </p>
      </LegalSection>

      <LegalSection heading="Media production">
        <p>
          Media services (video shoots, editing, photo, content packages) are governed by the
          written contract and payment schedule presented for each project, including deposit and
          installment terms. Deliverables, revisions, and usage rights are defined per contract.
        </p>
      </LegalSection>

      <LegalSection heading="Your content">
        <p>
          You retain ownership of the content you create and upload (recordings, artwork, profile
          media). You grant us the limited rights needed to operate the Service — for example,
          storing your files, displaying your public profile, and delivering your sessions. You
          are responsible for having the rights to any material you bring to a session or upload.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>
          Do not misuse the Service: no unlawful activity, infringement, harassment, attempts to
          break or bypass security, scraping, or interference with other users&apos; sessions. We may
          suspend or terminate accounts that violate these Terms. Conduct at the physical studio
          must follow posted studio rules; unsafe or unlawful behavior may end a session without
          refund.
        </p>
      </LegalSection>

      <LegalSection heading="Disclaimers & liability">
        <p>
          The Service is provided &quot;as is&quot; without warranties of any kind, express or implied,
          including fitness for a particular purpose. To the fullest extent permitted by law,
          Sweet Dreams&apos; total liability for any claim arising out of the Service is limited to
          the amount you paid us for the transaction giving rise to the claim. We are not liable
          for indirect, incidental, or consequential damages, or for events beyond our reasonable
          control.
        </p>
      </LegalSection>

      <LegalSection heading="General">
        <p>
          These Terms are governed by the laws of the State of Indiana, USA; disputes will be
          resolved in the state or federal courts located in Allen County, Indiana. We may update
          these Terms; continued use after changes are posted constitutes acceptance. If any
          provision is unenforceable, the rest remain in effect. Contact:{' '}
          <a className="text-accent underline" href="mailto:cole@marcuccilli.com">cole@marcuccilli.com</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
