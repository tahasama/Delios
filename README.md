# DELIOS · EDMS

An internal **Electronic Document Management System** built directly on the
**Document Management Standard v1** — *Rules · Routes · Checks* — by Taha Maatof.

The system **is** the Standard:

| Layer | In the product |
|---|---|
| **I · Rules** (Parts 0–17, Annexes A–F) | The enforced data model, configuration and permissions. Every "shall" that a system can enforce is enforced — numbering, revision series, forward-only states, approval authority, issue gates, search exclusion of obsolete revisions. |
| **II · Routes** (Annex G) | The seven execution checklists are rendered live beside the workflows they govern (creating a document, revising, issuing, receiving, taking out of use, closing a package). Steps tick themselves as the system records the evidence. |
| **III · Checks** (Annex H) | A conformance engine applies the defect-check catalogue against the register, records every finding with its fixed severity and owner, computes the **integrity figure** (§17.4), and raises the **warrant** when statements need qualifying (§17.7). |

## Stack

- **Next.js 15** (App Router, TypeScript, server components + server actions) — no separate backend
- **SQLite via Prisma** — portable schema; switching to Postgres later is a provider change + `prisma migrate`
- **Tailwind CSS v4** + hand-rolled shadcn-style UI, recharts
- **Credentials auth** (bcrypt + signed JWT session cookie), six roles
- **pdf-lib** — releases are stamped with number / revision / status / date (§10.2); superseded renditions are watermarked (§12.5)
- Files stored under `./uploads`, served only through an authenticated, confidentiality-checked route handler with download logging

## Running it

```bash
npm install
npx prisma migrate dev        # create/update the database
npm run db:seed               # publish the neutral Annex C starter configuration
SEED_DEMO=1 npm run db:seed   # optional: add the full Q6637021 review project
npm run dev -- -p 4173        # http://localhost:4173
```

Demo passwords are all `demo1234`:

| Account | Role |
|---|---|
| `admin@delios.local` | Administrator |
| `controller@delios.local` | Document Controller (the designated control function) |
| `approver@delios.local` | Approver |
| `reviewer@delios.local` | Reviewer |
| `author@delios.local`, `author2@delios.local` | Author / originator |
| `viewer@delios.local` | Viewer |
| `vendor@delios.local` | External party (MADASUD) |

Other scripts:

```bash
npm run checks                # run the Annex H conformance engine from the CLI
npm run defects-report        # open-defect summary by check
npm run db:studio             # browse the database
```

## The demo project

The seed creates a worked example on project **Q6637021** (numbering exactly per
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

## Configuration (Annex C)

Everything the Standard requires to be published lives under **Settings**.
The eight-step **Scope & readiness** guide turns an incomplete or missing Document
Management Plan into working configuration decisions, each read from live data.
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
src/lib/checks/catalog.ts   Annex H — every check with its fixed severity, owner and clause
src/lib/checks/runners.ts   automated evidence queries (Pass / Fail / Not checked / Not executable)
src/lib/checks/engine.ts    runs the catalogue, maintains the defect register, computes integrity
src/lib/routes.tsx          Annex G checklists, live in the UI
src/app/(app)/…             dashboard, register, documents, reviews, transmittals, actions,
                            packages, assets, exposures, conformance, reports, admin
```
