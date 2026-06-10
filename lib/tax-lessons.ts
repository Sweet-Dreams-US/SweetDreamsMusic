// lib/tax-lessons.ts — admin-facing Tax Center lessons (Plan 5 Phase 6).
// Plain instructional copy, client-safe constant (mirrors the artist roadmap).
// ⚠ HELD for CPA review before launch — educational, never advice.

export interface TaxLesson {
  id: string;
  title: string;
  body: string[];        // paragraphs
  linksTo?: { label: string; tab: string };  // deep-link to the feature it explains
}

export const TAX_LESSONS: TaxLesson[] = [
  {
    id: 'contractors-1099',
    title: '1099 vs W-2: why your engineers are contractors',
    body: [
      'Your engineers and producers are independent contractors, not employees. They set their own approach, work session-to-session, and are paid per job — so they get a 1099-NEC, not a W-2, and you do not withhold their taxes.',
      'The trade-off: anyone you pay $600 or more in a year needs a 1099-NEC filed by January 31, and you need their W-9 on file to do it. Collect the W-9 the first time you pay someone — chasing it down in January is the classic studio scramble.',
      'The Contractors tab tracks each person\'s year-to-date pay and flags who crosses $600 and who is missing a W-9, all year long.',
    ],
    linksTo: { label: 'Open Contractors', tab: 'contractors' },
  },
  {
    id: 'cash-payouts',
    title: 'Why every cash payout gets recorded',
    body: [
      'Paying an engineer in cash is fine — not recording it is the problem. Undocumented cash payroll can\'t be deducted, and if it\'s ever questioned you have no trail.',
      'When you record a cash payout in the Payroll tab, it counts toward that person\'s 1099 total and becomes a deductible contract-labor expense on your P&L. The cash is working FOR you on paper, exactly like a check would.',
      'The Contractors tab shows cash as its own column so you can see at a glance how much of each person\'s pay was cash — and that all of it is documented.',
    ],
    linksTo: { label: 'Open Contractors', tab: 'contractors' },
  },
  {
    id: 'deposits-vs-revenue',
    title: 'Deposits vs earned revenue: what the numbers mean',
    body: [
      'A deposit is money you\'ve collected but haven\'t fully earned until the session happens. Earned revenue is the full value of work delivered. Your accounting panel tracks both, and they are not the same number.',
      'When a client cancels and you keep their deposit, that kept deposit IS revenue — you earned it for holding the slot. The Tax Center counts kept deposits as a separate revenue line so nothing is missed and nothing is double-counted.',
      'This matters at tax time because the IRS cares about what you actually earned and collected, not what you booked.',
    ],
  },
  {
    id: 'quarterly-taxes',
    title: 'Quarterly taxes: why the IRS wants money four times a year',
    body: [
      'Employees have taxes withheld from every paycheck. As a business owner, no one withholds for you — so the IRS expects you to pay estimated taxes four times a year (mid-April, June, September, and January).',
      'Miss them and you can owe penalties even if you pay in full at year-end. The fix is simple: set aside a percentage of every dollar as it comes in.',
      'The Tax Center home estimates each quarter\'s set-aside from your real year-to-date profit and counts down to each due date, so you\'re never surprised.',
    ],
    linksTo: { label: 'Open Tax Center home', tab: 'home' },
  },
  {
    id: 'cpa-packet',
    title: 'What your CPA actually needs from you',
    body: [
      'Accountants are faster and cheaper when you hand them organized numbers instead of a shoebox. They want: your profit-and-loss by category, your expense detail with receipts, your contractor totals with W-9 status, and your equipment purchases.',
      'The Tax Center assembles all of that into one spreadsheet — the CPA packet — with each expense already mapped to its IRS Schedule C line.',
      'Generate it from the home tab at year-end and email your accountant one file. That is the whole handoff.',
    ],
    linksTo: { label: 'Open Tax Center home', tab: 'home' },
  },
  {
    id: 'sales-tax',
    title: 'Sales tax: ask your CPA (we deliberately don\'t compute it)',
    body: [
      'Whether studio time, beats, or media are subject to sales tax depends entirely on your state, and the rules change. Some states tax digital goods, some tax services, most treat them differently.',
      'Because getting this wrong creates real liability, the Tax Center does NOT calculate or collect sales tax. This is a deliberate choice, not a missing feature.',
      'Ask your accountant whether you need to register for and collect sales tax in your state. If you do, they\'ll tell you how — and you can record what you collect as a separate line.',
    ],
  },
];
