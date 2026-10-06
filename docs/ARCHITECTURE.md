# Architecture

The production architecture for DELIOS. The current Next.js application is the
prototype: it settled the logic (the rules, routes and checks, numbering,
workflows, the permission matrix) and the screens. The production system is
built fresh on the stack below and carries that logic over.

The deciding requirements are performance, stability and cost. The app runs
document control on projects worth millions; it must not crash, must not need
constant debugging, and must not slow down or freeze as users grow. Every
component below earns its place on those terms, and every component that is
not needed yet is deferred until a measured trigger says so.

## The decision

| Layer | Day 1 | Added later, on a trigger |
|---|---|---|
| Frontend | React + TypeScript, Vite single-page app, typed client generated from OpenAPI | — |
| Backend | ASP.NET Core 10 (LTS), one modular monolith | A module becomes its own service only with a measured reason to scale it alone |
| API | REST + OpenAPI | No GraphQL |
| Database | PostgreSQL 17, EF Core, PgBouncer | Read replica when reports compete with writes |
| Search | Postgres full-text search (`tsvector`) on metadata | Content search with Tika; OpenSearch only if Postgres search becomes slow |
| Cache, locks, real-time | Redis (Valkey): HybridCache second level, distributed locks, rate limits, SignalR backplane | — |
| Async work | RabbitMQ + MassTransit, retries and dead-letter queues | Kafka is not planned |
| File storage | S3-compatible object storage (Hetzner Object Storage), presigned URLs | AWS S3 / Azure Blob if a client requires it; Garage or SeaweedFS on premises |
| Virus scan | ClamAV | — |
| PDF | PdfSharp (MIT): release stamps, superseded watermarks | — |
| OCR | Text-layer detection on upload only | OCR worker, started on demand (see below) |
| Authentication | OIDC/OAuth 2.0: ASP.NET Core Identity first (MFA, lockout, password policy) | Entra ID / Keycloak per client; SAML through Keycloak |
| Audit | Append-only, hash-chained table | — |
| Time | UTC everywhere, NodaTime, per-project time zone and working calendar | — |
| Languages | i18n by message codes, RTL from day 1 | — |
| Monitoring | Prometheus + Grafana, Serilog + Seq, health endpoints | Sentry if needed |
| Infrastructure | Docker Compose on one VPS | Load balancer and a second node (stage 2); Kubernetes (stage 3) |
| Hosting | Hetzner VPS | AWS / Azure / client premises only when a contract requires it |

### Why ASP.NET Core

- **Performance.** Among the fastest mainstream web frameworks, multi-threaded,
  typically several times the throughput per core of Python frameworks. One
  modest server carries thousands of active users; the database runs out first.
- **Stability.** Compiled, strictly typed with enforced nullability, so most
  errors that crash dynamic-language apps at runtime are caught at build. LTS
  releases are supported for three years. The web server, ORM, authentication,
  dependency injection and background services all come from one maintainer,
  so the dependency surface is small.
- **Cost.** Low memory per instance means fewer and smaller servers. Everything
  in the stack is free and open source; there are no licences.

Java and Spring Boot was the close alternative and would also be correct. .NET
was chosen for lower memory use and faster start-up on a VPS. Django was
rejected on throughput per server and dynamic typing; Node on single-threaded
runtime and erased types; Go on how much a business-heavy domain would have to
hand-build.

### What was deliberately left out

- **Microservices.** One deployable with strict modules gives one deploy, one
  log and one database transaction across modules: a release that writes the
  revision, the audit entry and the transmittal commits completely or not at
  all.
- **GraphQL.** It costs caching and per-field permission complexity for no gain
  in a register-and-workflow application.
- **Kafka.** Built for very high-volume event streaming, which an EDMS does not
  have. RabbitMQ covers the job queues.
- **Self-hosted MinIO.** In 2025 MinIO removed features from its free community
  edition and stopped publishing official builds. Any S3-compatible store works
  without code changes.
- **OpenSearch, Tika and OCR on day 1.** Not needed at the planned volume; each
  has a trigger below.

## Shape of the backend

One ASP.NET Core solution, one deployable, with these modules. Each owns its
folder and its tables and talks to the others only through interfaces:

- Organizations, users, roles, functions and the permission matrix
- Document management: numbering, documents, revisions, files, lifecycle
- Workflow
- Review and approval
- Transmittals and correspondence
- Packages
- Records and retention, including legal hold
- Checks (the conformance engine)
- Schedules and requirements
- Reporting
- Audit

The same build runs in two roles:

- **api** serves HTTP requests.
- **worker** consumes the queues: virus scan, stamping, issue, email,
  scheduled checks, and later text extraction and OCR.

Each role scales on its own, so a burst of background work never slows the UI.

## The upload pipeline

```
browser ──presigned PUT──► object storage
   │
   └─ confirm ─► api ─► "file.uploaded" ─► RabbitMQ
                                              │
         ┌────────────────────────────────────┼─────────────────────┐
         ▼                                    ▼                     ▼
     virus scan                     text-layer detection      thumbnail
   (ClamAV; a file is            (flags scanned files as      (preview)
    not released until             "not searchable")
    it passes)                                                      │
                                                                    ▼
                                                              notifications
```

Each step is its own consumer with retries and a dead-letter queue, so one bad
file never blocks the others. File bytes never pass through the API: the
browser uploads and downloads with presigned URLs. Every file carries its
SHA-256 checksum.

## OCR on demand

OCR turns scanned images into searchable text. Most engineering documents are
born digital and do not need it; scanned archives do. It is therefore a feature
switched on from the front end, not an always-running part of the system.

1. **Detection, always on.** On every upload the worker checks whether the PDF
   has a text layer and marks files without one as *scanned, not searchable*.
2. **Visible in the UI.** A register filter shows scanned documents, and the
   project shows how many cannot be searched.
3. **Started by people, not by default.** The document controller or an
   administrator chooses "Make searchable" on one document, on a selection or
   filter (with the page count and an estimated duration), or turns on
   "OCR scanned uploads automatically" for the project. Each request is
   audited.
4. **Background, low priority.** Jobs go to a separate `ocr` queue with live
   progress, cancel and per-page retry.
5. **Result.** The extracted text feeds Postgres full-text search.

**The controlled original is never changed.** OCR text is stored separately,
linked to the revision. A searchable PDF may be generated as a derived
rendition, labelled as one; the released file and its checksum stay exactly as
issued.

Engine: OCRmyPDF (Tesseract) in its own container, with Arabic, English and
French language packs. Handwriting and poor scans can be routed per job to a
cloud OCR service (about $1.50 per 1,000 pages). Idle cost is nothing; a large
archive can run on a large server rented by the hour and deleted afterwards.

## Running on more than one server

The application is stateless from day 1, so adding a node is running another
container:

- No local files: everything goes to object storage; workers use scratch space
  only.
- No in-memory sessions: access tokens are validated on any node; refresh
  tokens and revocations live in Postgres.
- ASP.NET Core Data Protection keys are stored in Postgres or Redis, not on the
  node's disk. Without this, a cookie issued by one node is rejected by another
  and users are logged out at random.
- Scheduled jobs run exactly once across nodes (MassTransit scheduler or a
  Postgres advisory lock).
- SignalR uses the Redis backplane.

```
users ─► load balancer (TLS) ─► api-1, api-2, … ─► PgBouncer ─► Postgres primary (+ replica)
                                     │
                                     └─► RabbitMQ ─► worker-1, worker-2, …
```

- **Load balancer:** Hetzner Load Balancer, or HAProxy/Caddy on a small VPS.
  No sticky sessions.
- **Health:** `/health/live` (process up) and `/health/ready` (database, Redis
  and RabbitMQ reachable). Only ready nodes receive traffic.
- **Zero-downtime deploys:** rolling, one node at a time. Migrations are
  backward compatible: add a column, use it in the next release, drop the old
  one after that.

### When to scale

Nothing scales by itself. Monitoring runs from day 1, and these alerts mean the
next step is due:

- CPU above 70% for 15 minutes
- 95th-percentile response time above 500 ms
- Database connections above 80% of the pool
- A queue backlog still growing after 10 minutes

When an alert keeps repeating, add a second API node and the load balancer.
Because the app is stateless, that is a configuration change, not code work.

## Caching

HybridCache: an in-memory first level on each node, Redis as the shared second
level, with invalidation across nodes. Only configuration, permissions and
lookup data are cached. Document state is never cached; it is always read from
Postgres. If Redis is down the application is slower but still correct,
because Postgres is the source of truth.

## Languages

- The API returns codes, not sentences:
  `{ "code": "REVISION_NOT_APPROVED", "params": { … } }`. The React app
  translates them with i18next. A new language is a new translation file, with
  no backend change.
- Text the server renders (email, PDF stamps, transmittal covers, reports) uses
  .NET resource files in the recipient's language.
- Right-to-left (Arabic) is supported from day 1: `dir="rtl"` and CSS logical
  properties throughout.
- User-entered content stays as entered. Optional bilingual fields (title,
  description) are stored as JSON per language; the project decides which
  languages are required.
- Numbers, dates and the first day of the week follow the user's locale.

## Time zones

- Every instant is stored in UTC as `timestamptz`. Audit times come from the
  database server, never from a client.
- Every project has a time zone and a working calendar: its weekend days and
  public holidays. Weekends differ by country (Saturday–Sunday in most,
  Friday–Saturday in the Gulf). Working-day rules and due dates are calculated
  in the project's calendar, not the server's.
- A due date is a calendar date in the project's zone, not an instant: "due
  12 October" means the end of 12 October at the site.
- Each user sees times in their own zone; approvals and the audit log also show
  UTC.
- NodaTime handles zones and daylight saving in .NET.
- Every server keeps its clock synchronised with NTP.

## Audit

The audit table only accepts inserts: the application's database role has no
update or delete rights on it. Each row stores a hash of its content together
with the previous row's hash, so any alteration breaks the chain and is
detectable.

## Reliability rules

The framework is a minority of what keeps the system up. These apply
everywhere:

- Business rules are enforced as Postgres constraints as well as in code
  (unique document numbers, foreign keys, check constraints).
- Every multi-step change runs in one transaction.
- Concurrency tokens on revisions and other contested records, so two people
  cannot silently overwrite each other.
- Write endpoints are idempotent, so a retried request is not applied twice.
- Every list is paginated and every filter is indexed.
- Tests run in CI on every change, against a real Postgres.
- Backups are taken nightly with continuous WAL archiving, stored off site, and
  restored on a schedule to prove they work.

## Storage estimate

Per project: up to 10,000 documents at a median of 3.5 MB is 35 GB. With about
3.5 revisions per document and about 1.5× for renditions, stamped copies and
thumbnails, a project reaches roughly 150–200 GB. An off-site backup doubles
it. Ten projects come to about 2–4 TB, around €15–25 a month on S3-compatible
storage.

## Hosting

Hetzner (or a similar VPS provider) is the default: cheapest, reliable, ISO
27001 certified. AWS or Azure are used only when a client's contract requires
it, for example in-country data residency in the UAE or Saudi Arabia, the
client's own Azure tenant, or a specific certification. Some clients will
require their own premises. Everything runs in Docker, so the same build
deploys to any of these without code changes.

## Cost

Approximate monthly cost on Hetzner. AWS or Azure cost roughly 3–5× more for
the same setup.

| Stage | Setup | About €/month |
|---|---|---|
| 1. Pilot: one project, under 100 users | One 8 vCPU / 16 GB VPS running everything in Docker Compose, off-site backups | 40–60 |
| 2. Production: several projects, hundreds of users | Load balancer, two API nodes, one worker, a separate database server with a replica, Redis, object storage, backups | 150–300 |
| 3. Multi-client: thousands of users, high availability | More API and worker nodes, Postgres high availability, OpenSearch if needed, Kubernetes optional | 600–1,500 |

What raises cost, in order: high availability (everything doubled), managed
cloud services, file storage and backups, OCR on large archives, OpenSearch,
and download traffic on providers that charge for it. What keeps it down:
staying on VPS hosting until a contract says otherwise, moving old revisions to
cold storage, running OCR only where there is no text layer, adding each
component only on its trigger, and serving every client from one deployment
with tenant isolation in the database.

## Build plan

1. **Skeleton.** Solution layout, Docker Compose (Postgres, Redis, RabbitMQ,
   object storage, ClamAV), CI, health endpoints, logging, monitoring.
2. **Core.** Tenancy, authentication, roles, functions and the permission
   matrix, audit.
3. **Documents.** Numbering, revisions, files and the upload pipeline,
   lifecycle, release stamping.
4. **Reviews and workflows, transmittals, packages.**
5. **Checks engine, schedules, reports.**
6. **React application**, built against the generated API client.
