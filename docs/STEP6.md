# Step 6: the frontend on the new backend

The Next.js screens keep their look; underneath, each one stops reading its own
Prisma database and asks the .NET backend instead. Screens not yet moved are
hidden from the menu and closed (they send you home), so whatever you see works.
The old version stays on the main branch until the end.

## Trying it yourself

1. Backend, from the repository root (only the backend runs in Docker for now):
   `docker compose -f deploy/compose.yaml --profile app up -d --build`, then
   `docker compose -f deploy/compose.yaml --profile app run --rm migrate` and, once,
   `docker compose -f deploy/compose.yaml --profile app run --rm migrate seed-demo`.
2. Frontend, from the repository root: copy `.env.example` to `.env`,
   `npm install` (first time), then `npm run dev`.
3. Open http://localhost:3000. Password `demo1234` for any of
   controller@ · engineer@ · approver@ · viewer@ · admin@demo.local, supplier@acme.local.

## Progress

Each area: the screens, then any backend functions they need that do not exist yet.

- [x] **Sign-in and the frame**: sign-in with email and password (the email
      says which organization: a person belongs to one) and two-step code,
      sign-out, project picker, the menu, home ("waiting on you").
- [x] **Register**: the register (search, every filter, sorting, page numbers,
      saved views, export), a document's page (revisions and files, downloads,
      reviews, transmittals, packages, activities, history), new document,
      uploads straight to storage, starting a revision, sending corrected files,
      Document Control's check on arrival, sending for review.
      Not carried over (old-prototype ideas with no backend yet): phases, purchase
      orders, "on hold", assets, document relationships, legal hold, reader grants.
- [x] **Reviews**: the list (filters, sorting, page numbers, export), a review
      (the route step by step, comments and settling them, advice, verdict,
      another organization's answer recorded by Document Control with proof,
      release, sending back to the author or to a step, sending the route back),
      sending several revisions for review at once.
      Not carried over: delegating a step, review "kinds", automatic late warnings.
- [x] **Transmittals**: the log (what each still waits on, both directions,
      filters, sorting, page numbers, export), a transmittal (what it carried,
      who has it, acknowledging, recording dispatch to an organization outside
      with proof), composing one directly, and on a document's page asking for
      an issue and Document Control sending it.
      **Sent to us** (another organization, or Document Control recording for one
      that works in its own system, with its covering letter): one incoming
      transmittal, numbered in the sender's series, carrying filled placeholders
      (each at the status it is sent for: our register is updated at once and
      Document Control checks it on arrival), corrections, and unplanned items
      (an RFI, an NCR, minutes) that wait until Document Control registers them
      under our numbering. Received the moment it is sent: its receipt is a PDF
      listing every file with its SHA-256. Another organization can no longer
      start a revision any other way.
      Not carried over: drafts, "notify again".
- [x] **Packages**: two kinds.
      *From suppliers*: one supplier (and one order, if it has several), filled
      with its placeholders; its owners ask the supplier for them on one
      transmittal (each with its due date; new placeholders on the next one);
      the supplier's people see the package and send back on their own
      transmittals; it shows, per document, its due date and what was sent.
      *To deliver*: the list, a new package (why, the statuses needed, who it
      goes to, who puts it together and who accepts it, an optional rule it fills
      itself by), adding and taking out, the rule, checking readiness, sending
      what is missing to the acceptance authority and their acceptance,
      delivering on transmittals, accepting, and adding documents ticked in the
      register.
      Both: renaming at any time; deleting only while empty and never sent (the
      database enforces it).
- [ ] **Schedule and activities**: the schedule document, activities, needs, waivers, decisions, lateness.
- [ ] **Assurance**: checks and the defect register.
- [ ] **Reports**
- [ ] **Distribution matrix**
- [ ] **Settings** (backend functions to build): people and access, functions and
      the permission matrix, lists, numbering, revision schemes, review routes,
      Document Control's outcomes, outside parties, projects, security (two-step
      sign-in, single sign-on), reading inside files.
- [ ] **Notifications**
- [ ] **Import and export**
- [ ] **Screens the backend has no counterpart for yet**: assets and tags,
      exposures, the guide, document families, field policies, controlled
      sources, the document management plan. Each is either built in the
      backend or dropped, decided with the owner when its turn comes.
- [ ] **Registering a new organization** (signup and first setup).
- [ ] **The end**: the old Prisma code and database removed; the frontend runs in
      Docker Compose beside the backend, behind the same address, with the proxy
      passing each person's address through (so the sign-in limit counts people,
      not the frontend server).
