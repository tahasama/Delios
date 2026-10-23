# Where things are

One rule: **everything is filed by area, under the same name everywhere.** Something about transmittals lives
in a folder called `transmittals` (or `Transmittals`) in every part of the app. To debug or add a feature, open
that area's folder in each part, and nowhere else.

The areas: documents, reviews, transmittals, packages, actions (the schedule and its actions), records (assets,
number ranges), conformance (checks, the plan, reports), notifications, account (your sign-in), organization (working with
other organizations, the organization's admin page), settings.

## The whole repository

```
delios/
├── compose.yaml          every service the app runs with (see "Services" below)
├── .env                  passwords and addresses (made from .env.example; never committed)
├── CLAUDE.md             how we work, and the rules that must never break
├── PRODUCT.md            what the product is, and for whom
├── README.md             how to start it
│
├── backend/              the API and the worker: one program
├── frontend/             the screens
├── deploy/               settings for the services, and for running on servers
├── docs/                 what we agreed, and the runbooks
└── .github/workflows/    the checks GitHub runs on every push
```

## backend/

```
backend/
├── app/                  the program (API and worker)
│   ├── Program.cs        start-up: what runs, in which order
│   ├── Documents/        documents, revisions, files, the register; their numbers with other organizations (Equivalents.cs); the lists, numbering (NumberingEndpoints: the organization's and a project's copy) and revision
│   │                     schemes (CatalogAdminEndpoints, RevisionSchemeEndpoints); Reviews/ also VerdictListEndpoints (the sets of Review outcomes, read by routes)
│   │                     ProjectLists: the project's lists (own copy on first change, where each value is used, who changes them)
│   │                     ListRules: groups, the app's lists, which set of a list serves a deliverable type; Catalog.IsOfferedFor checks it
│   │                     SheetGuard: every spreadsheet checked before it is read (type, size unpacked, macros, viruses)
│   ├── Reviews/          routes, steps, advice, verdicts, release
│   ├── Transmittals/     sending, receiving, the check on arrival, replies by email (EmailReplies.cs); what a request asks and where it is decided (Asks.cs); matching what arrived
│   │                     to one of ours and packages taking documents as they come (IncomingService.Taking.cs)
│   ├── Packages/         delivery packages and supplier packages; how other organizations' documents come in (Intake.cs: by placeholder or as they come)
│   ├── Actions/          the schedule, its actions, what each needs, notices
│   ├── Records/          assets, number ranges, readiness answers
│   ├── Checks/           conformance checks
│   ├── Reports/          reports
│   ├── Search/           full-text search
│   ├── Identity/         people, sign-in, functions, organizations, who may do what (StandIns.cs: who acts where there is no control function); ProjectFunctions (what each function may do on a project, its own copy)
│   ├── Organizations/    organizations working together: links, linked accounts, switching; Registry (what is
│   │                     unique across DELIOS: codes, names, identifiers, contract numbers; changed once;
│   │                     look-alikes, claims, merges), RegistryEndpoints (on DELIOS, our identity and domain,
│   │                     claims, merges; command merge-organizations)
│   ├── Settings/         the organization's and the project's settings and lists; KeptCopies (a project's own copy kept when reset, put back from the organization's card); FormRules (Forms & fields: what each form asks, checked on save); Liberty (what projects may change: Fixed or Free per setting, and the projects a fixed one leaves free); ProjectDifferences (what one project changed, for the organization's Settings)
│   ├── Notifications/    notifications, email, pop-ups
│   ├── Audit/            the audit trail
│   ├── Extraction/       reading text out of files
│   ├── Messaging/        the queue between the API and the worker
│   ├── Tenancy/          keeping each organization's data apart
│   ├── Seeding/          the demo data
│   ├── Platform/         the database, Migrations/, shared plumbing
│   ├── Resources/        files built into the program (fonts for stamped PDFs)
│   └── appsettings.json  default settings (.env overrides them)
├── tests/                the automated tests, one file per area (DocumentTests.cs…)
├── Delios.slnx           ties app/ and tests/ together
├── Directory.Build.props settings shared by both
└── Dockerfile            builds the program into an image
```

Inside an area folder, the same names every time:

```
Transmittals/
├── Entities.cs               what is stored (the tables)
├── Configurations.cs         how it is stored (columns, lengths, indexes)
├── TransmittalEndpoints.cs   the web addresses the screens call
├── TransmittalService.cs     the work itself
└── TransmittalService.*.cs   a big service split by what it does (…Composing.cs, …Reading.cs)
```

The program's internal name is still `Delios.Host` (in the code and the built file). Only the folder is `app`.

## frontend/

```
frontend/
├── app/                  the pages: a folder's name is its web address
│   ├── layout.tsx        the outer frame of every page
│   ├── (public)/         pages for someone not signed in
│   │   ├── login/  signup/  confirm-email/  forgot-password/  reset-password/
│   │   └── bot-check.tsx, form-validation.ts   pieces only these pages use
│   ├── (start)/          signed in, outside any project
│   │   ├── setup/        after registering an organization: add people, open the first project
│   │   ├── no-project/   on no project yet (lists other organizations' projects they work on)
│   │   └── organization/ the organization's space (layout.tsx: its band, the waiting banner; org-tabs.tsx: Projects · People · Organizations · Settings) and admin page: projects (ours and joined), people,
│   │                     organizations we work with, invitations; + defaults/ (defaults for new projects), settings/ (the organization's Settings: the same cards as a project's, each with its switch and the projects with their own copy; numbering/ built, [slug] for cards not moved yet)
│   ├── (app)/            inside a project
│   │   ├── layout.tsx    the frame: menu, project switcher, theme
│   │   ├── page.tsx      Home (with home-parts.tsx, tally.tsx)
│   │   ├── documents/    + import/
│   │   ├── reviews/
│   │   ├── transmittals/ + exposures/
│   │   ├── packages/
│   │   ├── schedule/     the schedule list (/schedule), the same page for everyone
│   │   ├── actions/      each action's page (/actions/<code>); /actions and needed/ are old addresses, redirect
│   │   ├── assets/
│   │   ├── conformance/  + reports/
│   │   ├── notifications/
│   │   ├── account/
│   │   ├── guide/
│   │   └── settings/     + distribution/, people/; flow/ (the Control room: the flows, read only, linking
│   │                     to every card), control/ (only redirects to the Control room), flow/ (the Control room; project-wide.tsx: who acts as the control function, back to the defaults; role-work.ts: what our role makes of the flows, and their words; stages.ts and step-panel.tsx: its steps, flows and panels, shared with the organization's Control room at organization/settings/flow), stamp/ (The stamp: its card, the same as the organization's at organization/settings/stamp; lib/settings/stamp.ts holds its keys and defaults)
│   └── api/              file downloads (exports, delivery lists, templates)
│
├── lib/                  the code behind the pages, by area
│   ├── client.ts         the one door to the backend: every call goes through it
│   ├── types.ts          the shapes the backend answers with
│   ├── core/             shared by every area: sign-in, scope, permissions, preferences, words for states,
│   │                     tones.ts (state chips), rails.ts (the side colour of each state: the key on Help),
│   │                     days.ts (a day said from today: "3 days ago", "In 5 days")
│   ├── documents/        (copies.ts: which copy of a PDF opens; sheet-check.ts: a spreadsheet checked before it is read)
│   ├── reviews/
│   ├── transmittals/     (kinds.ts: the kinds of transmittal and how each names its types)
│   ├── packages/
│   ├── actions/
│   ├── records/          assets & tags (api.ts reads; forms.ts links a tag's documents)
│   ├── conformance/      (checks/prevented.ts: what the app refuses, listed by area under Default rules)
│   ├── account/
│   ├── organization/      organizations working together, the admin page, defaults for new projects
│   └── settings/         (forms-revisions.ts: Settings → Revisions; verdicts are the list Review outcomes, kept in Types & sets)
│
├── components/           only the pieces several areas use
│                         (ui.tsx: buttons and fields; form, data-table, timeline, search-pick, select (every dropdown),
│                          send-for-review, notify-panel, preflight, how-it-works: the form How this
                         project works and the organization's defaults share)
├── public/               files served as they are (sw.js, for pop-up notifications)
├── scripts/              demo-schedule.mjs (fills a demo), gen-theme.mjs
└── Dockerfile            builds the screens into an image
```

`+ import/`, `+ exposures/`, `+ needed/`, `+ reports/`, `+ distribution/`, `+ people/`, `+ directory/` (the project directory, Identity: `ProjectDirectory.cs`): pages whose web
address must stay as it is. They sit beside their area, and belong to it.

Inside a `lib/` area folder, the same names every time:

```
lib/transmittals/
├── api.ts                    reading from the backend
├── api-<topic>.ts            more reading, when there is a lot (documents/api-register.ts)
├── forms.ts                  what the area's forms send to the backend
├── forms-<topic>.ts          more forms, by topic (documents/forms-revisions.ts)
└── <anything else>.ts        what the screens need beyond that: words, small calculations
```

## Services (compose.yaml)

These are ready-made programs Docker downloads and runs. We don't write them; their settings live in `deploy/`.

```
Always running:
  postgres        the database                       settings: deploy/postgres/
  valkey          Redis: sessions, cache
  rabbitmq        the queue between the API and the worker
  seaweedfs       file storage (PDFs, native files)
  clamav          virus scan of uploads
  caddy           the front door (https)             settings: deploy/caddy/
  migrate         updates the database at start-up
  api, worker     our backend                        code: backend/
  web             our screens (profile "app")        code: frontend/

Turned on only when needed (profiles):
  pgbouncer, postgres-standby, file-backup, restore-drill    database extras
  opensearch, tika                                           full-text search
  prometheus, grafana, alertmanager, *-exporter              monitoring   settings: deploy/monitoring/
```

```
deploy/
├── postgres/             the database image, backups, restore drill
├── caddy/                the front door
├── monitoring/           Prometheus, Grafana, alerts
├── file-backup/          copies of stored files
├── kubernetes/           the same services, for a cluster later
└── init-env.sh / .ps1    makes .env with fresh passwords
```

## docs/

```
docs/
├── STRUCTURE.md          this file
├── ORGANIZATIONS.md      organizations working together, and the organization's admin page
├── STANDARD-CHANGES.md   what the Document Management Standard must change to match the app
├── REVIEW-MODEL.md       the review model
├── BEHAVIOUR-CHANGES.md  what behaves differently since the screens moved onto the backend
├── DETAIL-STYLE.md       the reference look (Schedule & actions, the action page)
├── DOTNET-GUIDE.md       a guide to the backend for a newcomer
├── ACTIVATION.md, LAUNCH-AND-SECURITY.md, SYSTEM.md, ARCHITECTURE.md   running and securing it
└── gaps/                 known gaps, one file per area
```

## Where to look

```
A page shows something wrong ........ frontend/app/(app)/<area>/  then  frontend/lib/<area>/
A rule is wrong (what something is) . backend/app/<Area>/            (rules live there, once)
A form does not save ................ frontend/lib/<area>/forms*.ts  then  backend/app/<Area>/*Endpoints.cs
A new table or column ............... backend/app/<Area>/Entities.cs, then a migration (Platform/Migrations/)
A service will not start ............ compose.yaml  then  deploy/<service>/  and  .env
A new feature ....................... its area's folder in each part; a new area gets the same name in all of them
```

## Rules for adding things

- **A rule goes in the backend, once.** Where something stands (an action's state, a revision waiting for the
  check, a transmittal's status, a package's readiness) is worked out there and read by every screen. A page
  only words it.
- **A file goes in its area.** A piece only one area uses lives in that area: beside its page (`app/(app)/<area>/`)
  or in `lib/<area>/`. Only pieces several areas use go in `components/` or `lib/core/`.
- **A new area gets one name**, the same in `backend/app/`, `frontend/app/(app)/` and `frontend/lib/`, and is
  added to this file.
- **Only `lib/client.ts` calls the backend.** Pages read through their area's `api.ts`; forms send through
  its `forms*.ts`.
