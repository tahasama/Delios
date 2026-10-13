# DELIOS · EDMS

An internal **Electronic Document Management System** built directly on the
**Document Management Standard v2** — *Rules · Routes · Checks* — by Taha Maatof.

The Standard is where the rules came from; the application is what enforces
them, in its own words:

| Layer | In the product |
|---|---|
| **Rules** | The enforced data model, configuration and permissions. A document number cannot be typed, a revision cannot be released without its approval, description and fixed copy, information under a legal hold cannot be destroyed. 20 such conditions are listed on **Default rules**, each naming the act that refuses it. |
| **Routes** | Execution checklists rendered live beside the workflows they govern (creating a document, revising, issuing, receiving, taking out of use, closing a package). Steps tick themselves as the system records the evidence. |
| **Checks** | 35 questions the application can answer from its own records, run against the register. Each finding carries its severity, its owner and the document it is on; the result is the share of documents carrying nothing critical or major, measured against the project's own target. |

Nothing is checked that the application prevents, and nothing is listed that no
record could settle: a check that cannot fail, and a check that can only fail,
both teach people to ignore the page.

## Layout

```
backend/    ASP.NET Core 10 API and worker (PostgreSQL, RabbitMQ, S3 storage, ClamAV)
frontend/   Next.js 16 screens; they read and write only through the backend
deploy/     Docker Compose, Kubernetes, monitoring, backups
docs/       what was agreed: start with CLAUDE.md, then docs/STANDARD-CHANGES.md
```

## Running it

Everything but the screens runs in Docker; the .NET 10 SDK is needed only to work on the backend code.

On Windows (PowerShell), from the repository folder:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\init-env.ps1                 # once: random passwords into deploy\.env (never committed)
docker compose -f deploy/compose.yaml --profile app up -d --build
docker compose -f deploy/compose.yaml --profile app run --rm migrate seed-demo
cd frontend
Copy-Item .env.example .env                                                  # once
npm install
npm run dev                                                                  # http://localhost:3000
```

On macOS or Linux the same, with `sh deploy/init-env.sh` and `cp .env.example .env`.

Demo passwords are all `demo1234`:

| Account | Role |
|---|---|
| `admin@demo.local` | Administrator |
| `controller@demo.local` | Document Control |
| `engineer@demo.local` | Engineer |
| `approver@demo.local` | Approver |
| `viewer@demo.local` | Viewer |
| `supplier@acme.local` | Supplier (Acme Pumps) |

`npm run demo:schedule` (in `frontend/`) fills a fresh demo through the API. The API
endpoints are listed at http://localhost:8080/api/openapi/v1.json.

To work on the backend, run only the dependencies in Docker and the API from the SDK
(`init-env` also stored the credentials as .NET user-secrets, outside the repository):

```bash
docker compose -f deploy/compose.yaml up -d
dotnet run --project backend/src/Delios.Host -- migrate
dotnet run --project backend/src/Delios.Host -- seed-demo
dotnet run --project backend/src/Delios.Host                # API on http://localhost:5000
dotnet test backend                                         # tests start their own containers
```

After pulling changes that touch `deploy/postgres`, rebuild and recreate the
database volume: `docker compose -f deploy/compose.yaml down -v`, then `up --build`.

Add `--profile monitoring` for Grafana (http://localhost:3301, user `admin`, password
`GRAFANA_ADMIN_PASSWORD` in `deploy/.env`),
Prometheus (:9090) and Alertmanager (:9093). Backups run from the start; the
monthly restore drill is
`docker compose -f deploy/compose.yaml --profile drill run --rm restore-drill`.
Everything switched off until needed (standby, read replica, PgBouncer, more
nodes, alert notifications) is in [docs/ACTIVATION.md](docs/ACTIVATION.md).

Health: `/health/live` and `/health/ready` on each node (internal). Metrics: port 9091.
Set `Delios__Role=worker` to run the same build as a queue worker.

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
Starting configuration is data, not code: `frontend/lib/profiles/reference.json` plus a
starter profile per project type (industrial, energy, construction).
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
