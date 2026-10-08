# Step 6: the frontend on the new backend

The Next.js screens keep their look; underneath, each one stops reading its own
Prisma database and asks the .NET backend instead. Screens not yet moved are
hidden from the menu and closed (they send you home), so whatever you see works.
The old version stays on the main branch until the end.

## Trying it yourself

1. Backend, from `deploy/`: `docker compose --profile app up -d`, then
   `docker compose --profile app run --rm migrate` and, once,
   `docker compose --profile app run --rm migrate seed-demo`.
2. Frontend, from the repository root: copy `.env.example` to `.env`,
   `npm install` (first time), then `npm run dev`.
3. Open http://localhost:3000. Organization `demo`, password `demo1234`, any of
   controller@ · engineer@ · approver@ · viewer@ · admin@demo.local, supplier@acme.local.

## Progress

Each area: the screens, then any backend functions they need that do not exist yet.

- [x] **Sign-in and the frame**: sign-in with organization and two-step code,
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
- [x] **Transmittals**: the log (what each still waits on, filters, sorting,
      page numbers, export), a transmittal (what it carried, who has it,
      acknowledging, recording dispatch to an organization outside with proof),
      composing one directly, and on a document's page asking for an issue and
      Document Control sending it.
      Not carried over: incoming transmittals as a separate record (another
      organization's submissions arrive as revisions, checked on arrival),
      drafts, "notify again".
- [x] **Packages**: the list, a new package (why, the statuses needed, who it
      goes to, who puts it together and who accepts it, an optional rule it fills
      itself by), a package (its documents and whether each is ready, adding and
      taking out, the rule, checking readiness, sending what is missing to the
      acceptance authority and their acceptance, delivering on transmittals,
      accepting), and adding documents ticked in the register.
      Not carried over: supplier packages (what a supplier owes us; their
      submissions arrive as revisions instead), renaming a package, and deleting
      one (records are kept).
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
