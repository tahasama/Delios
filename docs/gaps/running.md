# Running DELIOS: known gaps

What the console, payments and legal pieces (docs/RUNNING-DELIOS.md, "Built") do not do yet.

- **The end of a contract**: an organization set to Ended reads only; its data is not yet exported for it as one
  package, nor deleted after the agreed time. Both are owed by the data processing agreement; the number of days is
  the lawyer's to write.
- **The seller of record** (Paddle or Stripe) is not connected: no checkout, no invoices, no webhook setting Paid until.
  Payments are recorded by hand on the organization's page in the console.
- **Renewal notice 30 days before**: the Overview counts the yearly renewals in the next 30 days; telling the
  organization is done by hand (Notices, or email), not by itself.
- **A trial's end** is not announced beforehand: it reads only the day after its last day.
- **Support access** shows us an organization's projects and people only; opening its register or documents as support
  is not built (and would be written in its audit trail the same way).
- **Operators** are added and reset by the backend command only; there is no page to switch one off.
