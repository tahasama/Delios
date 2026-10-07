# Architecture

The production architecture for DELIOS. The current Next.js application
settled the logic (the rules, routes and checks, numbering, workflows, the
permission matrix) and the screens. It stays as the frontend: its server
actions and Prisma access are replaced, area by area, by calls to a new
ASP.NET Core backend in `backend/`, which carries that logic over.

The deciding requirements, in order, are performance, stability and cost. The
app runs document control on projects worth millions; it must not crash, must
not need constant debugging, and must not slow down or freeze as users grow.
It must also start cheaply. This is a cost-efficient enterprise architecture:
infrastructure is kept simple, every component earns its place, and anything
not needed yet is deferred until a measured trigger says so, without closing
the path to serious scale.

## The decision

| Layer | Day 1 | Added later, on a trigger |
|---|---|---|
| Frontend | Next.js (React + TypeScript), UI only, typed client generated from OpenAPI | — |
| Backend | ASP.NET Core 10 (LTS), one modular monolith | A module becomes its own service only with a measured reason to scale it alone |
| API | REST + OpenAPI | No GraphQL |
| Database | PostgreSQL 17, EF Core, row-level security | PgBouncer with the second API node; standby replica (see High availability) |
| Search | Postgres search on register entries; OpenSearch built and switched off (ranked, forgiving; visibility still decided by Postgres; falls back to Postgres if unreachable) | Switch OpenSearch on when RegisterSearchSlow fires |
| Content extraction | Built and switched off: Tika with Tesseract, per-project switch, own queue (see Client content) | Activated per project at a client's written request |
| Cache, locks, rate limits | Redis (Valkey) | — |
| Async work | RabbitMQ (official client), a transactional outbox table, retry and dead-letter queues | Kafka is not planned |
| File storage | S3-compatible object storage, versioning and object lock, presigned URLs (SeaweedFS in development); Azure Blob Storage built in, chosen by one setting | AWS S3 or Azure Blob if a client requires it |
| Virus scan | ClamAV | — |
| PDF | PdfSharp (MIT): release stamps, superseded watermarks | — |
| Renditions | None generated: authors submit the PDF with the native file | — |
| Authentication | Sessions in Postgres behind an httpOnly cookie; ASP.NET Core Identity's password hasher; lockout and rate limit; two-step sign-in (authenticator codes, recovery codes), optional or required per organization; single sign-on over OpenID Connect per organization (built, switched on by its administrator) | SAML through Keycloak |
| Audit | Append-only, hash-chained table | — |
| Time | UTC everywhere, NodaTime, per-project time zone and working calendar | — |
| Languages | i18n by message codes, RTL from day 1 | — |
| Observability | Serilog logs, Prometheus + Grafana metrics, health checks, error tracking (Sentry hosted or GlitchTip) | — |
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
- **A messaging framework (MassTransit, Wolverine).** MassTransit 9 requires a
  paid licence for business use, and its free version 8 receives security
  patches only until the end of 2026. Wolverine runs its own transactions, which
  conflicts with how row-level security is applied (`SET LOCAL` at the start of
  every transaction we open). What we need is small and kept in plain view
  instead: an outbox table written in the same transaction as the change, a
  relay that publishes with broker confirms, and a consumer that retries through
  a delay queue and parks repeated failures in a dead queue.
- **ASP.NET Core Identity's user store.** Logins are per tenant (the same email
  may exist in two organizations) and access comes from project memberships,
  which Identity's global user table does not model. Its password hasher is
  used; sessions, lockout and the matrix are ours.
- **Self-hosted MinIO.** In 2025 MinIO removed features from its free community
  edition and stopped publishing official builds. Any S3-compatible store works
  without code changes.
- **Rendition conversion.** Converting DWG to PDF reliably needs a paid
  licence, and conversion is a source of errors and load. Authors submit the
  PDF alongside the native file; stamping and watermarks apply to that PDF.
- **Thumbnails and previews.**
- **Reading file contents.** See Client content.

## What drives performance

At this scale the language matters less than these rules, which apply
throughout:

1. Files live in object storage, never as database BLOBs.
2. The browser transfers files directly to and from object storage.
3. Processing is asynchronous; no request waits for it.
4. The PostgreSQL data model is indexed for every filter the screens offer.
5. API nodes are stateless.
6. Configuration, permissions and lookup data are cached.
7. Search runs on indexed metadata.
8. Nothing heavy is generated during a request.
9. Large lists are never loaded into the browser.
10. Every list is paginated.

## Frontend and backend together

- Next.js renders the UI. It holds no business logic and no database access:
  server actions and Prisma are removed as each area moves to the API.
- Server components call the API on the server, forwarding the user's cookie,
  so pages arrive rendered. Client components call it from the browser.
- One domain behind Caddy: `/api` goes to ASP.NET Core, everything else to
  Next.js. No CORS.
- ASP.NET Core issues the session as an httpOnly, secure, same-site cookie.
  No token is readable by JavaScript.
- The Next.js server is stateless like the API nodes and scales the same way.

## What each organization configures

The application ships recommendations, never fixed choices, wherever the
choice belongs to the organization. Each is data its administrator changes:

- **Revision schemes:** one or more series per scheme, each letters or numbers,
  with a prefix, a start, zero padding, lowercase and excluded letters; routed
  by deliverable type, with a default. A, B, C… then 0, 1, 2… is the
  recommendation; 1, 2, 3 throughout, or P01 for phases, a, b for design and
  CA, CB for the client, are equally possible.
- **Numbering schemes:** fields, order, delimiter and sequence width, routed by
  deliverable type.
- **Value lists:** disciplines, document and deliverable types, subprojects,
  purchase orders, criticality, confidentiality (and which levels are
  restricted to named readers), retention classes and which criticality maps
  to which, and the words that make a title generic.
- **What each deliverable type requires** before it can be registered.
- **Functions and the permission matrix.**
- **Review routes:** steps in order, each answered by a function's holders on
  the project (the first answer, or all of them) or by an outside party (with
  the reason for issue on the transmittal that carries it), working days per
  step, which documents the route serves, and which statuses its deciding step
  may grant.
- **Outside parties:** whether each answers here with its own accounts or by
  proxy (one of ours sends it and records the answer), which of our functions
  carries the exchange (Document Control when none is named), their own system,
  and whether an answer recorded for them must carry proof.
- **Reasons for issue,** and for each whether a response is wanted and in how
  many working days.
- **Distribution:** who receives which documents is the permission matrix's
  RECEIVE verb, not a second list. Sending outside it is allowed with a reason.
- **Review vocabulary:** the statuses a released revision may carry, the
  deciding step's verdicts and which of them let a revision proceed, what an
  adviser's comments amount to, comment classes and which block the release,
  and the reasons a route may be sent back to a step.
- **Document Control's outcomes**, apart from review verdicts: what each is for
  (accepting on arrival, returning, releasing), who a return goes back to, and
  whether it needs a new revision. The recommendation: a fault in the submission
  comes back corrected under the same revision; a verdict asking for changes
  needs a new one.
- **Which checks each project answers to:** any check can be switched off for
  a project, with the reason on the record.
- **Each project's working week**, which due dates are counted in.
- **Review, transmittal and package numbers**, through the same numbering
  schemes as documents; a transmittal number may carry who sends and who
  receives it. Without a scheme a record is numbered P1001-TR-0001 (RV, PK…),
  from the same counter, so numbers never repeat.
- **Each package:** what it is for, the statuses its documents must reach, who
  puts it together and who accepts it (never the same people), who it goes to,
  and whether it fills itself by a rule (deliverable type, discipline, document
  type, originator).

What the Standard itself requires is enforced for everyone: a number is
allocated by the system and never reused, a revision value is never reused on
a document, one revision of a document is in progress at a time, and a record
is never revised.

## Shape of the backend

One ASP.NET Core solution, one deployable, with these modules. Each owns its
folder and its tables and talks to the others only through interfaces. The
exact boundaries follow how the domain is built:

- Identity and tenancy
- Projects
- Documents and revisions: numbering, files, lifecycle, release stamping
- Workflows
- Reviews and approvals, with comments
- Transmittals and correspondence
- Packages
- Records and retention, including legal hold
- Checks (the conformance engine)
- Schedules and requirements
- Reporting
- Audit

The same build runs in two roles:

- **api** serves HTTP requests.
- **worker** consumes the queues: virus scan, file identification, stamping,
  issue, email and scheduled checks.

Each role scales on its own, so a burst of background work never slows the UI.
If one area later needs to scale independently, it leaves the monolith along
the lines it already has: document processing to a worker cluster, search to
OpenSearch, notifications to their own worker.

## Identity and tenancy

```
Tenant ── Users
   └── Projects ── Membership (User × Project × Function/Role) ── Permissions
```

A user belongs to one tenant. Users are not under a project: a project
membership grants them a function, and the function carries the permissions on
that project. People from other organizations (contractor, supplier, client)
take part in a project through their party, without becoming members of the
tenant.

Tenant isolation has two layers:

- **Application:** EF Core applies a tenant filter to every query.
- **Database:** PostgreSQL row-level security rejects any row of another
  tenant, so a missed filter cannot leak data. The tenant is set with
  `SET LOCAL` inside each transaction. This is required because PgBouncer
  reuses connections across requests; a session-level setting could carry one
  tenant's identity into another's request.

## Document core

Project, Document, Document Revision, File, Transmittal, Package, Workflow,
Review, Approval, Comment, Audit Event.

**A revision is never overwritten.** A change is a new revision. The same holds
for files: the bucket has versioning and object lock, so not even a bug or an
administrator can overwrite or delete a released file. Every file carries its
SHA-256 checksum.

## The upload pipeline

```
browser ──presigned PUT──► object storage
   │
   └─ confirm ─► api: verify checksum, create revision (PROCESSING)
                      and write the job to the outbox, in one transaction
                          │
                          ▼
                      RabbitMQ ─► worker
                                    ├── virus scan (ClamAV)
                                    ├── file identification
                                    ├── technical metadata
                                    └── notifications
                          │
                          ▼
                 revision READY
```

- Processing is not triggered by object-storage notifications: they differ by
  provider and can be lost. The API writes the job in the same transaction as
  the revision (the outbox pattern), so a job cannot be lost.
- A revision in `PROCESSING` cannot be released or transmitted. It becomes
  `READY` only when every step has passed; a file that fails the virus scan is
  quarantined.
- **Technical metadata** means file facts only: type, size, page count, sheet
  size, PDF version, whether a text layer exists. Embedded properties such as
  author names are not stored.
- Each step is its own consumer with retries and a dead-letter queue, so one bad
  file never blocks the others.
- File bytes never pass through the API.

Downloads: the browser asks the API, the API checks the user's permission and
the document's confidentiality, logs the download, and returns a short-lived
signed URL to object storage.

## Client content

**The system does not read what is inside clients' files.** By policy, no text
is extracted from file contents and nothing from inside a file is indexed.
Search covers the register's metadata only.

Content extraction and OCR are nevertheless written, tested and shipped, but
switched off. They are activated per project only when a client asks for them
in writing, and the activation is recorded in the audit log. When active:

- **Text extraction and OCR** (Apache Tika with Tesseract, one container of its
  own) read the text layer of PDFs and Office files and OCR the pages that are
  only images, in the languages the server is set for (`OCR_LANGUAGES`). The
  text feeds the project's search (Postgres, or OpenSearch when on) and stays
  inside that tenant's data, under row-level security. *Built.*
- **Per project, three positions:** off; on demand (a revision, or Document
  Control's "the whole project" for a scanned archive); automatic (every file
  once it passes scanning). *Built.*
- Jobs run on a queue of their own, one at a time, so they never hold up the
  scanning of new uploads. *Built.* Live progress, cancel, page counts and
  duration estimates are not built yet.
- **The controlled original is never changed.** Extracted text is stored
  separately, linked to the file and revision. *Built.* A searchable-PDF derived
  copy is not built yet.
- Switching it off deletes the project's extracted text, and the search index
  drops it on its next pass. *Built.*

When inactive, these containers do not run and cost nothing.

## Running on more than one server

API nodes are completely interchangeable:

- No local uploaded files: everything goes to object storage; workers use
  scratch space only.
- No local session state: access tokens are validated on any node; refresh
  tokens and revocations live in Postgres.
- No local application state. ASP.NET Core Data Protection keys are stored in
  Postgres, not on the node's disk. Without this, a cookie issued by one node is
  rejected by another and users are logged out at random.
- Scheduled jobs run exactly once across nodes (a Postgres advisory lock).

```
users ─► load balancer (TLS) ─► api-1, api-2, … ─► PgBouncer ─► Postgres primary ─► standby
                                     │
                                     └─► RabbitMQ ─► worker-1, worker-2, …
```

- **Load balancer:** Hetzner Load Balancer, or HAProxy/Caddy on a small VPS.
  No sticky sessions.
- **PgBouncer** joins with the second node, so many nodes share a bounded set of
  database connections. With one node, the Npgsql pool is enough.
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

Every deferred component is built, tested and switched off. Each alert in
`deploy/monitoring/alerts.yml` names the component it calls for, and
[ACTIVATION.md](ACTIVATION.md) gives the steps to switch it on and check it:
alert notifications, backups to off-site storage, the standby and its
promotion, the read replica, PgBouncer, more API nodes and workers, several
servers, the domain and HTTPS.

## Redis

- Cache: HybridCache, with an in-memory first level on each node and Redis as
  the shared second level, invalidated across nodes. Only configuration,
  permissions and lookup data are cached. Document state is never cached.
- Rate limiting shared across nodes.
- Short-lived locks for operations that must not run twice at once. Document
  numbering is also guarded by a unique constraint in Postgres.

**Redis is never the source of truth.** Postgres is authoritative. If Redis is
down the application is slower but still correct.

## High availability and backups

- **Postgres standby.** A streaming-replication standby is added as soon as the
  first contract depends on the system, before the user count forces it.
- **Database backups.** pgBackRest, inside the database image: a full backup
  weekly, an incremental daily, and continuous WAL archiving, forced at least
  every minute, for point-in-time recovery: a restore loses at most about a
  minute. Backups are encrypted and go to storage at another provider or
  region; four full backups are kept (about four weeks).
- **File backups.** Every stored file is copied to a second location every six
  hours, copy only: nothing deleted or changed at the source changes the copy.
  The database alone cannot restore files.
- **Restore drill.** Monthly, one command: restores the latest backup and every
  archived log, then checks the tenants, the documents and every audit chain,
  and records how long it took as the recovery time to expect. A backup that
  has never been restored does not count; an alert fires after 35 days without
  a passing drill.

Each of these reports a metric, and an alert fires when it stops (backup too
old, backup failed, archiving failing, file copy too old, standby lagging).

## Observability

Application logs, metrics, health checks and error tracking, from day 1.

Watched: CPU, RAM, disk, Postgres connections, RabbitMQ queue depth, worker
failures, API response time, 5xx rate, upload processing time, the outbox
backlog, register search time, backup age, standby lag.

Prometheus collects, Alertmanager notifies (email, Telegram, Slack or any
webhook, chosen with one setting), Grafana shows the "DELIOS overview"
dashboard. The alert rules have their own tests (`promtool test rules`), run
in CI.

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

- Business rules are enforced as Postgres constraints as well as in code
  (unique document numbers, foreign keys, check constraints).
- Every multi-step change runs in one transaction.
- Concurrency tokens on revisions and other contested records, so two people
  cannot silently overwrite each other.
- Write endpoints are idempotent, so a retried request is not applied twice.
- Tests run in CI on every change, against a real Postgres.

## Storage estimate

Per project: up to 10,000 documents at a median of 3.5 MB is 35 GB. With about
3.5 revisions per document and the PDF submitted beside each native file, a
project reaches roughly 150–200 GB. The replicated copy doubles it. Ten
projects come to about 2–4 TB, around €15–25 a month on S3-compatible storage.

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
| 0. Development and testing | Free tiers (see below) | 0 |
| 1. Pilot: one project, under 100 users | One 8 vCPU / 16 GB VPS running everything in Docker Compose, object storage, off-site backups | 40–60 |
| 2. Production: several projects, hundreds of users | Load balancer, two API nodes, one worker, a separate database server with a standby, Redis, object storage, backups | 150–300 |
| 3. Multi-client: thousands of users | More API and worker nodes, Postgres high availability, OpenSearch if needed, Kubernetes optional | 600–1,500 |

What raises cost, in order: high availability (everything doubled), managed
cloud services, file storage and its replica, OpenSearch, and download traffic
on providers that charge for it. What keeps it down: staying on VPS hosting
until a contract says otherwise, moving old revisions to cold storage, adding
each component only on its trigger, and serving every client from one
deployment with tenant isolation in the database.

## Testing for free

- **Development:** the whole stack runs locally with Docker Compose, at no
  cost. It needs about 8 GB of free RAM.
- **An online test environment:** Oracle Cloud Always Free gives an ARM server
  with 4 cores and 24 GB RAM, 200 GB of disk and S3-compatible object storage,
  enough to run the full stack. Every image in the stack is published for ARM.
  It needs a card for verification, free capacity is not always available in
  every region, and an idle free server can be reclaimed, so it is for testing,
  not for clients.
- **Object storage alternative:** Cloudflare R2, 10 GB free with no download
  charges.
- **CI:** GitHub Actions free minutes.
- **Error tracking and dashboards:** Sentry and Grafana Cloud free tiers.
- **Load testing:** free servers do not show real performance. Before the
  first client, rent a production-sized Hetzner server by the hour for a day of
  load tests (a few euros) and delete it afterwards.

## Build plan

1. **Platform foundation.** Done. Solution layout, Docker Compose (Postgres,
   Redis, RabbitMQ, object storage, ClamAV), CI, logging, health checks, metrics.
2. **Identity and tenancy.** Done. Tenants, parties, users, projects,
   memberships, functions and the permission matrix, sessions and lockout,
   row-level security, hash-chained audit.
3. **Document core.** Done. Value lists, numbering schemes and counters,
   registration with the prototype's rules, confidentiality, keyset paging,
   revisions, presigned upload, outbox, scanning and checksum verification,
   download, idempotent writes.
4. **Workflows, reviews and approvals, release and stamping, transmittals,
   packages.** Release moved here from step 3: a revision is released only
   with its approval.
   - Done: review routes (internal steps), advice read off comments, the
     deciding step's verdict and granted status, reservations settled by a
     later step, Document Control's release or return, rewinding a route to an
     earlier step, supersession, stamped and SUPERSEDED-watermarked copies made
     by the worker, the work queue.
   - Done: issue requests (anyone with standing asks, with a reason for issue;
     the deciding step may ask with its verdict; the release carries them out;
     where nobody holds Document Control, whoever asked sends it), recipients
     proposed by the matrix with a reason required outside it, numbered
     transmittals with read and acknowledgement evidence, the "released, never
     sent" list, steps answered by outside parties either in the app (sent to
     them on a transmittal, which is what lets them read it) or by proxy
     (dispatch with channel and their reference, then their answer recorded
     with their own wording and proof filed against the revision).
   - Done: packages, put together by hand or by a rule that keeps admitting
     new documents (one taken out stays out), assessed against the statuses
     they need, a shortfall the acceptance authority accepts or not, delivery on
     one transmittal per organization carrying only what is ready, then
     acceptance. Delivering fixes the contents.
   - Done: Document Control's check, apart from review verdicts: acceptance of
     what other organizations send in before review, returns for correction
     under the same revision (on arrival or at the gate, whatever the verdict),
     submissions kept in order within a revision, and its own outcome list.
5. **Checks engine, schedules, reports.**
   - Done: the checks engine. 34 checks the register can answer from its own
     records (setup, running, handover), each counting failing items; a defect
     register that opens, closes by itself when the register is put right, and
     reopens if the fault comes back; acceptance with a reason (still counted);
     checks switched off per project with a reason; integrity (documents free of
     Critical and Major defects) and coverage (checks answered of those asked).
     Runs nightly per project on a queue of its own, and on Document Control's request.
   - Done: schedules and requirements. The schedule is a controlled document:
     only a released revision is read, from its Excel (.xlsx) or CSV export,
     columns found by heading (or named per project); each revision's changes are
     kept (new, moved, changed, removed). Activities have a start and an optional
     finish. Each need names a document and what it serves (a reason for issue;
     one marked "executes" is met only at a status marked "executes"), counted
     from the start or the finish (a test result needed after the work), or on a
     fixed day. Readiness: ready, ready with waivers (green, still followed up),
     at risk, pending. A waiver is the concerned department's or Document
     Control's, on their responsibility, always with a reason. Decisions about an
     activity whose documents were missing come from the organization's own list
     (each says whether it "proceeds"). Lateness: the chain each document went
     through, and the first checkpoint that slipped. Four checks (SC-01..04).
   - Next: reports.
   - Then, before step 6: a guided read of the backend for its owner, new to
     .NET: docs/SYSTEM.md completed for every aspect and tool; a beginner's
     guide (docs/DOTNET-GUIDE.md: endpoints, services, entities, migrations, a
     request followed end to end, running, logs, debugging); and a plain-language
     comment on every class and method saying what it is for and where it is called from.
6. **Next.js moves onto the API**, area by area, through the generated client.
7. **Content extraction and OCR**, switched off, ready for activation.
