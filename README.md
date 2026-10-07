# DELIOS · EDMS

An internal **Electronic Document Management System** built directly on the
**Document Management Standard v1** — *Rules · Routes · Checks* — by Taha Maatof.

The Standard is where the rules came from; the application is what enforces
them, in its own words:

| Layer | In the product |
|---|---|
| **Rules** | The enforced data model, configuration and permissions. A document number cannot be typed, a revision cannot be released without its approval, description and fixed copy, information under a legal hold cannot be destroyed. 20 such conditions are listed on **Default rules**, each naming the act that refuses it. |
| **Routes** | Execution checklists rendered live beside the workflows they govern (creating a document, revising, issuing, receiving, taking out of use, closing a package). Steps tick themselves as the system records the evidence. |
| **Checks** | 97 questions the application can answer from its own records, run against the register. Each finding carries its severity, its owner and the document it is on; the result is the share of documents carrying nothing critical or major, measured against the project's own target. |

Nothing is checked that the application prevents, and nothing is listed that no
record could settle: a check that cannot fail, and a check that can only fail,
both teach people to ignore the page.

## Stack

- **Next.js 15** (App Router, TypeScript, server components + server actions) — no separate backend
- **SQLite via Prisma** — portable schema; switching to Postgres later is a provider change + `prisma migrate`
- **Tailwind CSS v4** + hand-rolled shadcn-style UI, recharts
- **Credentials auth** (bcrypt + signed JWT session cookie), six roles
- **pdf-lib** — releases are stamped with number / revision / status / date (§10.2); superseded renditions are watermarked (§12.5)
- Files stored under `./uploads`, served only through an authenticated, confidentiality-checked route handler with download logging

## Backend (in progress)

The production backend is being built in `backend/` (ASP.NET Core 10, PostgreSQL,
Redis, RabbitMQ, S3-compatible storage, ClamAV). The decisions and the build
plan are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The Next.js app below
moves onto its API area by area.

Everything runs in Docker; the .NET 10 SDK is needed only to work on the code.

```bash
docker compose -f deploy/compose.yaml --profile app up -d --build             # whole stack, API on :8080
docker compose -f deploy/compose.yaml --profile app run --rm migrate seed-demo # demo tenant "demo", password demo1234
```

Sign in with `POST /api/auth/sign-in` and `{"tenant":"demo","email":"engineer@demo.local","password":"demo1234"}`.
The demo people are admin, controller, engineer, approver, viewer (`@demo.local`)
and `supplier@acme.local`. The endpoints are listed at
http://localhost:8080/api/openapi/v1.json.

To work on the code, run only the dependencies in Docker and the API from the SDK:

```bash
docker compose -f deploy/compose.yaml up -d
dotnet run --project backend/src/Delios.Host -- migrate
dotnet run --project backend/src/Delios.Host -- seed-demo
dotnet run --project backend/src/Delios.Host                # API on http://localhost:5000
dotnet test backend                                         # tests start their own containers
```

After pulling changes that touch `deploy/postgres`, recreate the database volume:
`docker compose -f deploy/compose.yaml down -v`.

Health: `/health/live` and `/health/ready`. Metrics: port 9091 (`/metrics`).
Set `Delios__Role=worker` to run the same build as a queue worker.

## Running it

The same commands work in PowerShell, cmd and bash.

```bash
npm install                   # also generates the Prisma client
```

Copy the settings file once — `.env` is not in git:

```bash
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```

```bash
npx prisma migrate deploy     # create or update the database
npm run db:seed               # the neutral Annex C starter configuration
npm run demo                  # optional: the full P1001 demo project, upgraded, with the checks run
npm run dev                   # http://localhost:3000 (add -- -p 4173 for another port)
```

After pulling new changes, run `npx prisma migrate deploy` and `npm run upgrade`.
If the app reports "@prisma/client did not initialize yet", run `npx prisma generate`
with the dev server stopped.

Demo passwords are all `demo1234`:

| Account | Role |
|---|---|
| `admin@delios.local` | Administrator |
| `controller@delios.local` | Document Controller (the designated control function) |
| `approver@delios.local` | Approver |
| `reviewer@delios.local` | Reviewer |
| `author@delios.local`, `author2@delios.local` | Author / originator |
| `viewer@delios.local` | Viewer |
| `vendor@delios.local` | External party (Acme Pumps) |

Other scripts:

```bash
npm run checks                # run the checks from the CLI, per project
npm run defects-report        # open-finding summary by check
npm run db:studio             # browse the database
npx tsx scripts/restate-actions.ts   # rewrite what each activity is waiting for
```

## The demo project

The seed creates a worked example on project **P1001** (numbering exactly per
`Standard-Numbering-Config.xlsx`): 20 documents across every state — released,
superseded, in review, in preparation, planned placeholders, a void, a withdrawal —
plus live review cycles, transmittals TR-0001…0005 (incoming awaiting acceptance
check included), authenticated receipt evidence, registered copies, actions
A0007/A0031/A0044, two controlled corporate-schedule versions, and package PK-001.

It also plants **deliberate defects** (released without approval, blocking comment
on a released revision, void without reassessment, withdrawn item still required by
an action, unnotified supersession, stale registered copy, placeholder holding a
revision, generic title, a bad execution issue…). Run **Conformance → Run the
checks** to watch the engine find them, then use the defect workflow — correct and
re-run, or accept with reason/authority/review date — and watch the integrity
figure respond. The warrant banner appears while integrity is below the published
threshold (95%) or a Critical defect is open.

## Configuration

Everything an organization publishes lives under **`/settings`**, in five groups:

| Group | Screens |
|---|---|
| **Organization** | Projects · Organizations · **The plan** |
| **Classification** | Disciplines, types & sets · Document families · **Forms & fields** · Numbering |
| **How work flows** | Control room (the flow, who carries each act, the project's policies, state names) · Review routes |
| **Access** | Functions & permissions · People & access |
| **Change & evidence** | Uploaded lists to decide · The log |

**The plan** is this project's Document Management Plan, generated from the
configuration itself — scope, numbering, classification, review and approval,
release and issue, formats, retention, what is checked, and what is still to
settle. Nothing on it is typed, so the plan and the behaviour cannot drift. An
organization's own plan — cover page, client clauses, local conventions — is
registered as a document and named on it.

**Forms & fields** decides, for each of ten forms (document, revision,
transmittal, review, readiness, package, project, organization, person,
equipment), what each field is called, whether it is required, optional or not
asked at all — and lets an organization add fields of its own, in the shape it
likes. What the application computes with (the number is built from the type,
the matrix answers by discipline, retention follows criticality) says so and
stays as it is.
Starting configuration is data, not code: `src/lib/profiles/reference.json` plus a
starter profile per project type (industrial, energy, construction). See
[docs/ROLLOUT.md](docs/ROLLOUT.md) for upgrading an installation and adding profiles.
Configuration covers:
value sets (document types, disciplines, statuses with execution flags, review
outcomes with proceed/resubmission consequences, criticality, confidentiality,
retention classes, reasons for issue with acceptance/response periods, issue-code
mapping, comment classifications), the numbering schemes and routing, the
versioned approval authority matrix, users and roles, the asset breakdown, the
scope statement, and the exceptions register. Values are versioned and never
deleted while in use — retiring keeps them on existing documents and bars new
ones (§4.7). Sets support safe rename, ordering, code/label/property editing,
unused-value deletion, and CSV export/import with dry-run validation.

## Built around the work, not the Standard's table of contents

- **My work is guided**: it states the objective, what is missing, why it matters and the single best next action; schedule readiness and control health remain visible without becoming the task list.
- **Explore DELIOS** explains every daily, project-control and organization-setup area in the language of the job.
- **Workflow schemas are visual**: ordered review/approval steps, serial/parallel/consolidator decisions, document-class applicability, bound outcome sets and participants grouped by party. The chosen schema updates the send form immediately.
- **Access follows the relationship**: internal contributors create and update; external parties never create register entries, but can update an assigned placeholder and review when requested. Approval remains authority-controlled.
- **Every important point has history**: metadata, revisions, files, review/approval evidence, schedule context, distribution evidence, relationships and packages can be reconstructed at a captured revision or event.
- **The corporate schedule is controlled**: import a scheduler extract as a draft, compare date movement, publish it, and update action dates without silent changes. Action codes link planned work to the documents required for readiness.
- **Transmittal receipt is evidence**: notified, first opened, latest view, view count and formal acknowledgement are visible to document control.
- **Create document** uses plain organization-defined choices and system numbering, including the document-vs-record question (§2.2).
- **Bulk in, bulk out**: import a whole deliverable list as placeholder entries, load a baseline, correct metadata in bulk — CSV templates, a dry-run mode, and a line-by-line report. Every register view exports to Excel-friendly CSV with a generation timestamp (§16.6).
- **Everything configurable by the organization**: value sets with their behavior properties (execution flags, outcome consequences, periods, comment classifications, defaults) editable in the admin, plus custom sets, the type-to-field matrix (C.3.3), format lists (C.7), distribution rules (C.8.1), number ranges issued to parties (§3.7), and lead times (C.9.3).

## Records, obsolescence and conformance extras

- **Records** (§2.2–2.4): fixed evidence, never revised; corrections are new records referencing the original.
- **Approval withdrawal** (§8.7): recorded with reason and authority; original retained; document withdrawn until a replacement is released.
- **Comment reclassification** (§9.6): the executing party can force it, with a trail.
- **Disposal & legal hold** (§13.5): disposal gated by hold, entry retained and marked.
- **Superseded/void renditions are re-stamped** "SUPERSEDED — NOT FOR USE" and watermarked at download (§12.5).
- **Assessment statement** (§1.6): a printable conformance statement with integrity, severity counts, coverage (qualified when below 100%) and the exceptions register.
- **Distribution rules** (§11.8): recipients defined by classification before issue; off-distribution issues are detectable.
- **Containment** (§17.3): release is blocked while a progression-preventing comment or missing approval affects the item; the engine refuses defect closure the check still returns.

## Switching to Postgres

1. `provider = "postgresql"` in `prisma/schema.prisma`, set `DATABASE_URL`
2. `npx prisma migrate dev`
No application code changes.

## Layout

```
prisma/schema.prisma        the register — seven linked record types (§16.3) + configuration + conformance
src/lib/standard.ts         fixed sets from the Standard (states, reasons, outcomes, exposures…)
src/lib/lifecycle.ts        state machine: review custody points, approval, release, supersession, void
src/lib/numbering.ts        scheme routing, validation, system allocation (§3.7)
src/lib/checks/catalog.ts   the 97 checks: condition, how it is detected, severity, owner, moment
src/lib/checks/runners.ts   one query per check, returning the items that fail
src/lib/checks/engine.ts    runs the catalogue, maintains the findings, computes the result
src/lib/checks/prevented.ts the 20 conditions the application refuses outright
src/lib/field-policy.ts     what every form asks for, insists on, and calls it
src/lib/action-readiness.ts what each activity is waiting for, written on the activity
src/lib/routes.tsx          the execution checklists, live in the UI
src/app/(app)/…             home, register, documents, reviews, transmittals, actions,
                            packages, assets, distribution, conformance, reports, settings
```
