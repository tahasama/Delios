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
- [ ] **Register**: documents list and search, a document's page, new document,
      uploads, revisions, Document Control's check on arrival.
- [ ] **Reviews**: list, a review (answer, comments, verdict, release, return), send for review.
- [ ] **Transmittals**: log, a transmittal, issue requests, sending, acknowledging, dispatch by proxy.
- [ ] **Packages**
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
      Docker Compose beside the backend, behind the same address.
