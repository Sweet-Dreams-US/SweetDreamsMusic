import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_URL } from '@/lib/constants';
import LegalPage, { LegalSection } from '@/components/legal/LegalPage';

// Meta App Review "User data deletion" instructions URL — always reachable,
// never feature-flag gated.

export const metadata: Metadata = {
  title: 'User Data Deletion',
  description: 'How to request deletion of your Sweet Dreams Music account and personal data.',
  alternates: { canonical: `${SITE_URL}/user-data-deletion` },
  robots: { index: true, follow: true },
};

const UPDATED = 'July 6, 2026';

export default function UserDataDeletionPage() {
  return (
    <LegalPage title="USER DATA DELETION" updated={UPDATED}>
      <LegalSection heading="How to request deletion">
        <p>
          To delete your Sweet Dreams Music account and the personal data associated with it,
          email <a className="text-accent underline" href="mailto:cole@marcuccilli.com">cole@marcuccilli.com</a> from
          the email address on your account with the subject line{' '}
          <strong>&quot;Data Deletion Request&quot;</strong>. No account? Include the email address or
          phone number you used with us so we can locate your records.
        </p>
      </LegalSection>

      <LegalSection heading="What we delete">
        <p>
          Within 30 days of a verified request we delete your account, profile (photos, bio,
          genres, social/streaming links), platform connections, messages, and marketing records.
        </p>
        <p>
          Some records are exempt from deletion where the law requires us to keep them: completed
          booking, purchase, and payment records are retained for accounting and tax purposes, and
          delivered beat-license records are retained to document the license grant. These are
          kept only as long as legally required and are no longer linked to an active account.
        </p>
      </LegalSection>

      <LegalSection heading="Data received from Meta">
        <p>
          If any of your data reached us through a Meta product (for example, ad interaction data
          via the Meta Pixel, or lead information you submitted through a Meta ad), a verified
          deletion request also removes that data from our systems. Business administrators who
          connected Meta business tools can disconnect them at any time, which stops further
          access and triggers deletion of stored Meta platform data for that connection.
        </p>
      </LegalSection>

      <LegalSection heading="Confirmation">
        <p>
          We confirm every deletion request by email when it is received and again when deletion
          is complete. See our <Link className="text-accent underline" href="/privacy-policy">Privacy Policy</Link>{' '}
          for the full picture of what we collect and how it is used.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
