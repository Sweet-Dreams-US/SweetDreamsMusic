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
      'The threshold changed: for payments made in 2025 it was $600; for payments made in 2026 and later it\'s $2,000 (One Big Beautiful Bill Act), indexed for inflation from 2027. The Contractors tab applies the right threshold for the year you\'re viewing.',
      'Important: the TAX didn\'t change when the form requirement did. Pay someone $1,500 in 2026 and no 1099 is required — but the income is still taxable to them and the expense is still deductible to you. Some STATES still use $600 for their own forms until they amend; this platform tracks the federal threshold and says so.',
      'Collect the W-9 the first time you pay someone — chasing it down in January is the classic studio scramble. And if you prefer complete paper trails, the Voluntary 1099 toggle lets you issue below the threshold anyway.',
      'One more form you may see: your card processor sends a 1099-K at $20,000 AND 200+ transactions (the planned $600 version was repealed). That\'s their report of money they processed for you — it\'s not extra income, just a cross-check.',
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
    title: 'Quarterly taxes — and the QBI deduction that shrinks them',
    body: [
      'Employees have taxes withheld from every paycheck. As a business owner, no one withholds for you — so the IRS expects you to pay estimated taxes four times a year (mid-April, June, September, and January). Miss them and you can owe penalties even if you pay in full at year-end.',
      'Here\'s the good news baked into your estimate: the Qualified Business Income (QBI) deduction. As a pass-through business you generally deduct 20% of your business profit before income tax — and it\'s now PERMANENT (One Big Beautiful Bill Act). From 2026 there\'s also a $400 minimum deduction once you have $1,000+ of business income.',
      'What it does to your set-aside: income tax is estimated on 80% of your profit instead of 100%. Self-employment tax is unchanged (QBI doesn\'t reduce it). The phase-out ranges start around $400K joint income — far above typical studio income — and your assumptions sheet states this.',
      'The Tax Center home estimates each quarter\'s set-aside from your real year-to-date profit with QBI applied (toggle it in your Tax Profile if your accountant says otherwise) and counts down to each due date.',
    ],
    linksTo: { label: 'Open Tax Center home', tab: 'home' },
  },
  {
    id: 'buy-gear',
    title: 'Buy gear, write it off: first-year expensing',
    body: [
      'Cameras, drones, interfaces, monitors, computers, edit rigs — equipment you buy and put to work is a YEAR-ONE deduction, not something you drip out over five years. 100% bonus depreciation is now permanent (for property acquired and placed in service after January 19, 2025), with Section 179 as the alternative election; your CPA decides which to use.',
      '"Placed in service" is the date that matters — the day the gear is set up and ready to use in the business, not the day you ordered it. A December interface that\'s racked and running in December deducts THIS year; the same box still sealed until January deducts NEXT year.',
      'Because bonus depreciation is permanent, the old December-vs-January panic matters less than it used to — but DOCUMENTATION matters more. Log every equipment purchase with its date and keep the receipt attached. The Tax Center flags purchases over $2,500 as equipment automatically and shows your year-to-date equipment investment next to its full write-off value on the home tab.',
    ],
    linksTo: { label: 'Open Expenses', tab: 'expenses' },
  },
  {
    id: 'meals-entertainment',
    title: 'Meals and entertainment: the 2026 rules',
    body: [
      'Three different rules, three different categories — and the expense picker teaches them as you log:',
      'CLIENT MEALS — 50% deductible. Taking a client or collaborator to a meal to talk business. Keep the receipt and note who/why.',
      'STAFF MEALS — 0% from 2026. Food and snacks you provide to your team at the studio were 50% deductible through 2025; the deduction is gone starting with 2026 expenses. Still log them — complete books matter — the P&L shows them in the non-deductible column.',
      'ENTERTAINMENT — 0%, and it has been for years. Game tickets, concerts, golf — even with clients, it\'s entertainment and not deductible. One useful wrinkle: food bought SEPARATELY at the venue (itemized, not bundled into the ticket) can still be a 50% client meal.',
    ],
    linksTo: { label: 'Open Expenses', tab: 'expenses' },
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
    id: 'not-tracked',
    title: 'What this system does NOT track — bring these to your CPA',
    body: [
      'DreamSuite organizes what flows through the studio: revenue, expenses, contractor pay. Several classic deductions live outside it, and your CPA will ask about them — bring them separately.',
      'Vehicle mileage (trips for gear, sessions, events — keep a mileage log app), home office (if you run studio business from home), your own health insurance premiums (deductible for self-employed owners), and retirement contributions (SEP-IRA / Solo 401k).',
      'Also: owner draws — money you pay YOURSELF as a sole proprietor or LLC owner — are NOT a business expense and are deliberately not deductible anywhere in this system. If you operate as an S corp, your own pay is W-2 wages through a payroll provider, never a 1099 (mark yourself as "Owner" on your contractor card so the system excludes you).',
      'And merchant processing fees: card payments arrive net of Stripe\'s cut, but revenue here is recorded gross. Log your processing fees as a Merchant / Processing Fees expense (your Stripe dashboard totals them by month) or your profit will look higher than it is.',
      'If you ever hire W-2 EMPLOYEES (not contractors): new federal rules require reporting tips and overtime separately on W-2s — that\'s payroll-provider territory, not something DreamSuite handles. Your payroll service and CPA own it.',
    ],
    linksTo: { label: 'Open Expenses', tab: 'expenses' },
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
