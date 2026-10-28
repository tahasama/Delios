# Running DELIOS: known gaps

What the console, payments and legal pieces (docs/RUNNING-DELIOS.md, "Built") do not do yet.

- **The end of a contract**: an organization set to Ended reads only; its data is not yet exported for it as one
  package, nor deleted after the agreed time. Both are owed by the data processing agreement; the number of days is
  the lawyer's to write.
- **CMI and Paddle** are not connected: invoices, their PDFs and payments recorded by hand are built; a card payment
  through either is recorded on its invoice by hand until its merchant contract and keys exist.
- **Renewal notice 30 days before**: the Overview counts the yearly renewals in the next 30 days; telling the
  organization is done by hand (Notices, or email), not by itself.
- **Operators** are added and reset by the backend command only; there is no page to switch one off.
- **A support request is answered once, in the console**: no thread back and forth inside the app; a reply by email to
  the support address is not taken in. A second message is a new request.
- **Choosing a plan** sends the choice to DELIOS; the invoice is still issued by hand from the console, and there is no
  price worked out for the organization on the page (users × price) before it sends.
- **Organizations that signed up before the free trial existed** have no end date until one is set on their page in
  the console.
- **Codes provisional** (the owner confirms them): the kinds of support request (SIGN_IN, OPEN_FILE, UPLOAD, ACCESS,
  ERROR, SETUP, BILLING, OTHER), with the subscription, billing and legal codes already listed in RUNNING-DELIOS.md.
