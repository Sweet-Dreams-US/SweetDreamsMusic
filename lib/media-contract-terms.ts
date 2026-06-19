// lib/media-contract-terms.ts
//
// Default authorization / agreement boilerplate for the media CONTRACT BUILDER
// (components/media-team/ContractBuilder.tsx). The builder prefills its
// contract-terms textarea with this text when the field is empty — it is fully
// EDITABLE so the manager can tailor it before sending the contract for
// signature. It is NOT locked or read-only.
//
// Keep this isomorphic (no server-only imports) so the client builder can call
// buildDefaultContractTerms() to seed the textarea.

import { formatCents } from './utils';

export interface ContractTermsContext {
  /** Offering / project title, e.g. "Music Video Campaign". */
  projectTitle?: string | null;
  /** Artist display name, when known. */
  artistName?: string | null;
  /** Grand total in cents (sum of deliverables), when known. */
  totalCents?: number | null;
  /** Whether the manager built an installment plan (vs. a single payment). */
  hasInstallments?: boolean;
}

/**
 * Build sensible, editable authorization boilerplate, optionally weaving in the
 * project title, artist, and total. Everything is plain text (no markdown) so
 * it reads cleanly inside the textarea and on the artist's review-&-sign page.
 */
export function buildDefaultContractTerms(ctx: ContractTermsContext = {}): string {
  const project = (ctx.projectTitle || '').trim() || 'this media campaign';
  const artist = (ctx.artistName || '').trim();
  const artistParty = artist ? `${artist} (the "Artist")` : 'the Artist';
  const total =
    typeof ctx.totalCents === 'number' && ctx.totalCents > 0
      ? formatCents(ctx.totalCents)
      : null;

  const paymentLine = total
    ? ctx.hasInstallments
      ? `The total investment for this campaign is ${total}, payable per the installment schedule set out in this contract. Each installment is due on the date listed; payment links are issued by Sweet Dreams for each installment.`
      : `The total investment for this campaign is ${total}, payable to Sweet Dreams per the schedule set out in this contract.`
    : `The total investment is the sum of the deliverables listed in this contract, payable to Sweet Dreams per the payment schedule set out herein.`;

  return [
    `AUTHORIZATION & AGREEMENT — SWEET DREAMS US LLC`,
    ``,
    `This agreement is entered into between Sweet Dreams US LLC ("Sweet Dreams") and ${artistParty} for ${project}.`,
    ``,
    `1. SCOPE OF WORK`,
    `Sweet Dreams will produce and deliver the specific deliverables itemized in this contract. The scope of this agreement is limited to those listed deliverables. Any work not listed — additional shoots, edits, revisions, or assets — is out of scope and will be quoted separately before it begins.`,
    ``,
    `2. PAYMENT`,
    paymentLine,
    `All payments are processed by Sweet Dreams. Production work begins once the agreed deposit or first installment is received, and final deliverables are released once the balance is paid in full.`,
    ``,
    `3. PRODUCTION THROUGH SWEET DREAMS`,
    `All production for this campaign — recording, filming, photography, editing, and post-production — runs through Sweet Dreams and its assigned team. The Artist agrees not to engage outside vendors for the listed deliverables without Sweet Dreams' written consent.`,
    ``,
    `4. SCHEDULING, CANCELLATION & RESCHEDULING`,
    `Shoot dates are confirmed once both parties sign and land on the Sweet Dreams calendar. Reschedule requests must be made at least 48 hours before a scheduled shoot; later changes or no-shows may forfeit that shoot's reserved time and any associated deposit. Sweet Dreams will make reasonable efforts to accommodate weather or availability changes for on-location shoots.`,
    ``,
    `5. OWNERSHIP & USAGE`,
    `Upon receipt of full payment, the Artist receives the rights to use the final delivered assets for the Artist's own promotional and commercial purposes. Sweet Dreams retains the right to display the work in its portfolio and to use it in Sweet Dreams marketing and social media unless the parties agree otherwise in writing. Raw footage, project files, and stems remain the property of Sweet Dreams unless expressly purchased.`,
    ``,
    `6. FREE ADD-ONS`,
    `Any deliverable marked as a free add-on is provided at no charge and is subject to a Sweet Dreams socials collaboration — the Artist agrees to feature, tag, or co-post the add-on content with Sweet Dreams on social media as part of the consideration for that free deliverable.`,
    ``,
    `7. AGREEMENT`,
    `By signing, both parties agree to the deliverables, payment schedule, and terms set out in this contract.`,
  ].join('\n');
}

/**
 * A plain default with no project context woven in — handy when a caller wants
 * a constant string and doesn't have project/artist/total at hand.
 */
export const DEFAULT_CONTRACT_TERMS = buildDefaultContractTerms();
