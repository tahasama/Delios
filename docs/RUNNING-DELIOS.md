# Running DELIOS for many organizations

Written 28 Oct 2026 after research. **The owner chose all of it** ("I'd like all of that"), the same day: we run it, our
console, payments, the legal texts as placeholders until a lawyer writes them (marked in red), and the in-app pieces.
What was built is in **Built** at the end; the rules are in CLAUDE.md, "Running DELIOS".

## 1. Who runs it: us, as a service (recommended)

Two ways were weighed:

| | We run it (one DELIOS, every organization in it) | Each organization runs its own copy |
|---|---|---|
| Linking organizations | Works as built: collaborators, guests, claims, merges, one code and name per organization across DELIOS (`reserved_values`) | Breaks: two copies cannot see each other; every link becomes an email |
| Updates and fixes | Once, for everyone | Each customer, each version, on their own clock |
| Law on the software itself | A hosted service sits outside the EU Cyber Resilience Act's product duties | Software handed over is a product: the CRA applies (vulnerability reporting from 11 Sept 2026, everything from 11 Dec 2027), open source or not |
| Who answers for the data | The organization decides (controller); we keep it for them (processor) | The organization alone |
| What customers in this trade buy | Aconex, Thinkproject, Asite are all sold as a hosted service, per user (about £45 / $30–50 a user a month) or per project | Rare, for the largest clients only |

**The way DELIOS is built already assumes one platform**: organizations find each other, link, claim the entries others
made for them, merge duplicates. Handing a copy to each organization would throw that away. So: **we run it**, and later,
for a large client who insists, **a dedicated copy that we still run** (their own database and storage, in the region they
ask), as GitLab does with "Dedicated". Never a copy handed over to run themselves, at least until the CRA work is done.

## 2. Our space (the operators' console)

Today the app owner works through backend commands (`grant-all`, `merge-organizations`, `requests`, `unshare-package`).
Run for many organizations, that becomes a space of its own, outside every organization:

- **Its own sign-in**, for our staff only, two-step always, never an account of any organization; every act in its own
  locked log.
- **Organizations**: each with its plan, its state (trial · active · read only for non-payment · ended), its users,
  projects and storage used.
- **Requests**: readers asked for (`product_requests`), merges to carry out, claims vouched for, support tickets.
- **Support access**: we never read an organization's documents by default. To help, we ask; its administrator grants
  access for a set time, to a set project; every page we open is in their audit trail. This is what customers' security
  questionnaires ask first.
- **The platform**: notices to every administrator (maintenance, a change in the terms), incidents, the list of
  subprocessors.

## 3. Payments

- **Per organization, per user who works in it, monthly or yearly.** People of other organizations invited onto a
  project pay nothing to the host: their own organization pays for them if it has its own DELIOS; a guest account is free.
  That keeps the network growing (every supplier brought in is a future customer), which is how Aconex and Asite sell.
- **A merchant of record** (Paddle, or Stripe acting as merchant): it is the seller in law, collects and pays VAT in each
  country, and issues the invoices. Plain Stripe is cheaper but leaves every country's VAT to us. Large clients on a
  yearly invoice and bank transfer, outside the card flow.
- **Not paid is never deleted**: the organization goes read only (everyone reads and exports, nobody adds), told
  beforehand, as the app's rule says nothing is deleted.
- **Sold to businesses only, said so in the terms.** Germany's cancel button and automatic-renewal rules are for
  consumers. Still, as such apps do: cancelling is one click from the organization's Settings, no harder than signing up;
  a yearly renewal is announced 30 days before; the price is shown before it is paid.

## 4. Legal: what must exist before the first paying customer

1. **A company** that signs the contracts, and insurance (professional and cyber liability).
2. **Terms of service**: business use only, what we do and do not promise, liability capped, the law and court chosen.
3. **Data processing agreement** (GDPR Article 28), signed with every organization: what we keep for them, on their
   instructions only, our security, who works for us on it, help with their people's requests, and **at the end of the
   contract their data handed back as an export and then deleted** after a set time. That last one is the law, and the
   one exception to "nothing is deleted" that has to be built.
4. **List of subprocessors**, kept up to date and announced before a change: hosting, email, payments, Cloudflare (the
   robot check, if switched on).
5. **Privacy notice**, for whoever signs in and for the site: what is kept (names, emails, sign-ins, what was opened
   and downloaded), why, how long, who to ask. Linked from the sign-in page.
6. **Where the data lives**: hosted in the EU, said in the contract.
7. **A security page**: encryption, backups, row-level separation, how a breach is told (72 hours).

These texts come from a lawyer; the app gives them their places (sign-in page link, sign-up acceptance kept with its
date and version, the subprocessor list, the export and the deletion at the end).

## 5. Inside an organization: people's data

- **A person asking to be forgotten**: their name and email replaced ("Former user 123"), their account closed; what
  they did stays in the records, because the register has to prove who did what (GDPR Article 17(3)), and the refusal
  for the records is noted with why. Asked of the organization (the controller), carried out by its administrator.
- **How long activity is kept**: the organization chooses (CLAUDE.md says so, and it is only lawful with it), and
  opened and downloaded records past that time are removed by themselves. They sit outside the locked chain, each sealed
  alone, so removing them breaks nothing.
- **Drafts**: already replaced while a revision is prepared, never piled up (built).

## 6. In what order (proposed)

1. Now, in the app: the fence on the last 8 tables; forgetting a person; how long activity is kept.
2. Before the first customer: the legal texts (lawyer), their places in the app, the export and deletion at contract end.
3. Then: our console, plans and payments through a merchant of record.
4. Later, on demand: a dedicated copy run by us for a large client.

## Built (28 Oct 2026)

- **The console** (`/console`, backend `Operators/`): the DELIOS team's own accounts (`create-operator <email> <name>`,
  password from `DELIOS_OPERATOR_PASSWORD`, always a code from an authenticator app, locked 15 minutes after 5 wrong
  tries, 8 hours at most, cookie `delios_console`), never an organization's. Tabs: Overview (what waits on us), Organizations
  (each with where it stands, plan, paid until, paid users, projects, storage, last active; its page: plan & contract set
  with why, its administrators, what it accepted, support access, what it asked, our log about it; switched off with why),
  Requests (merges carried out here, claims, readers asked), Plans & payments, Legal (every legal matter, must or may, by
  when, with where it stands and notes; the texts, versioned), Support access, Notices (to every administrator), Team, Log.
- **Where an organization stands** (`Subscriptions.Effective`, read when looked at): Trying (no end, or until its trial's
  last day) · Active · Reads only (trial over, 14 days past the period paid, cancelled and past it, or set by us) · Ended.
  Reading only: every change refused (READ_ONLY) but signing in, notifications, the contract; a banner on every page
  (`/api/standing`). Nothing is deleted. Codes provisional: TRIAL, ACTIVE, READ_ONLY, ENDED; CARD, INVOICE; the matter
  states TO_DO, PLACEHOLDER, WITH_LAWYER, IN_FORCE, NOT_NEEDED (owner to confirm).
- **Payments**: per organization per paid user (its own people; guests and linked accounts free), plans named and priced
  in the console. The seller of record (Paddle or Stripe) is **not connected yet**: a payment is recorded by hand (Paid
  until). Cancelling is one click in the organization's Settings → Contract & plan.
- **Plans** (console → Plans & payments): added, changed by their pencil (the code never changes), no longer sold by
  switching off "Sold now" (organizations then cannot choose it; those that have it keep it), removed by their bin only
  while no organization has it or asked for it (PLAN_IN_USE otherwise; PLAN_REMOVED).
- **The free trial** (`Operators/Trials.cs`, owner): every organization that signs up tries DELIOS for the number of days
  set in the console (Plans & payments → Free trial, `TRIAL_DAYS`, 30 unless set, 0 for no end, with why,
  TRIAL_DAYS_SET); one already trying keeps its own end, changed on its page. Its administrators are reminded 7 days
  before the end, the day before and on the day, by notification and email, pointing to Contract & plan. The next
  reminder's moment is written by what sets the end (sign-up, the console: `Subscription.RemindAt`, message
  `trials.moved`), the worker asleep until it (`TrialReminders`), never looking. Organizations that signed up before
  have no end until one is set.
- **Choosing a plan** (owner): on Contract & plan, an administrator picks a plan and how many users, with a note
  (`POST /api/organization/contract/plan`, PLAN_ASKED; allowed while reading only); DELIOS is emailed
  (`DELIOS_CONTACT_EMAIL`), the console lists it (Requests → Plans chosen, and on the organization's page, its form
  filled in with the choice); setting a plan answers it; the first invoice is then issued from the same page.
- **Legal texts** (`Operators/LegalTexts.cs`): terms, data processing agreement, privacy notice, subprocessors, security,
  service levels, acceptable use, cookies, legal notice. Each starts from a written text describing what the app does,
  with `[[LAWYER: …]]` where only a lawyer may write, drawn in red everywhere. Public at `/legal`, linked under the
  sign-in and sign-up pages. Published by new versions only; the terms and the data processing agreement are accepted
  at sign-up (a tick) and again at each new version by an administrator, each acceptance kept (who, which version, when).
- **Support access**: an administrator lets DELIOS in for 1 to 30 days with why, ends it whenever; without it the
  console counts only, and names its administrators; with it, its projects and people, each reading written in its
  audit trail (SUPPORT_READ).
- **Forget a person** (organization's People, administrators): name and email replaced, account closed, sign-in,
  devices and pop-ups gone; their acts stay under the name they were done by (Article 17(3)).
- **How long activity is kept** (Security & privacy, `TRACK_KEEP_DAYS`: 3 months, 6, a year, two, or as long as the
  register): what was opened and downloaded past it is removed by the next reading row (`audit_prune`, once a day per
  organization); the chain is untouched.
- **The last eight tables fenced** (migration FenceSharedTables, `Tenancy/Crossing.cs`).

Still to do, outside the app: the company, the lawyer's texts, insurance, the seller of record's contract, hosting in
the EU said in the contract. The export then deletion at a contract's end is a gap (docs/gaps).

## Sources

- [Oracle Aconex pricing (ERP Research)](https://erpresearch.com/erp-add-ons/construction/oracle-aconex/pricing),
  [Thinkproject G-Cloud 15 pricing](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/700298/753875779994829-pricing-document-2026-01-27-1000.pdf),
  [Asite pricing (SaaSworthy)](https://www.saasworthy.com/product/asite/pricing),
  [Construction software pricing guide 2026](https://softcircles.com/blog/construction-management-software-pricing-guide-2026)
- [GitLab tiers and deployment](https://handbook.gitlab.com/handbook/marketing/brand-and-product-marketing/product-and-solution-marketing/tiers),
  [GitLab self-managed subscriptions](https://compmath.korea.ac.kr/gitlab/help/subscriptions/self_managed/index.md)
- [CRA: the line between SaaS and products (DLA Piper)](https://www.dlapiper.com/en/insights/publications/2026/02/cyber-resilience-act-the-fine-line-between-saas-and-digital-products),
  [CRA scope determination](https://handbook.unicis.tech/pub/trust_center/cra_scope_determination)
- [SaaS DPA guide](https://secureprivacy.ai/blog/data-processing-agreements-dpas-for-saas),
  [Key privacy considerations for SaaS suppliers](https://legalvision.co.uk/data-privacy-it/key-privacy-considerations-for-saas-suppliers/),
  [Subprocessor clauses](https://sprintlaw.co.uk/articles/subprocessor-clauses-saas-contracts/)
- [Paddle vs Stripe (Freemius)](https://freemius.com/blog/paddle-vs-stripe/),
  [Stripe vs Paddle 2026](https://cut-the-saas.com/guides/stripe-vs-paddle)
- [Germany's cancel button (Stripe)](https://stripe.com/resources/more/mandatory-cancellation-button-germany),
  [German consumer contract rules (Osborne Clarke)](https://www.osborneclarke.com/insights/new-consumer-contracts-rules-germany-tighten-regulatory-regime)
- [Right to erasure (ICAEW)](https://icaew.com/-/media/corporate/files/technical/ethics/information-law-and-guidance/gdpr/right-to-erasure.ashx),
  [Retention vs erasure duties (FAST LTA)](https://www.fast-lta.de//en/blog/revisionssicherheit-und-dsgvo-aufbewahrung-vs-löschpflicht)
