# The system, aspect by aspect

For each aspect: what it runs on, what it handles, whether it is meant to
evolve, what limits it today and why, and what is already built and switched
off for when that limit is reached. Kept up to date as each part is built.

Capacity figures are design estimates for a single 8 vCPU / 16 GB server (the
pilot setup in ARCHITECTURE.md "Cost"), not measured load tests. The alerts
named here are in `deploy/monitoring/alerts.yml` and say when a limit is near.
How to switch anything on is in `docs/ACTIVATION.md`.

| Aspect | Runs on | Handles | Evolves? | Limit today, and why | Built and switched off |
|---|---|---|---|---|---|
| **Containers** | Docker builds each part as a sealed image (the app's is minimal: no shell, not run as root); Docker Compose runs them together, with optional parts grouped in profiles switched on by one flag | The whole system on one server from one command; the same images on a laptop, Hetzner, Azure, AWS or a client's premises; an upgrade is a new image, a rollback the previous one | Yes: it is what lets the system move to more servers or Kubernetes without rewriting anything | Compose manages one server: it does not move containers to another server when one dies. Chosen because it is the cheapest and simplest to run and to understand at pilot size | Several servers ("Several servers"); Kubernetes manifests, checked on every push |
| **Application** | ASP.NET Core 10, one codebase in two roles: API and worker | Every API request; background work (scanning, stamping, reading files, checks) apart from requests, so a burst of uploads never slows the screens | Yes: modules can leave the monolith one by one if one ever needs to scale alone | One API node and one worker on one server: enough for a pilot; a second server costs money before it is needed | More API nodes behind the load balancer, more workers (alerts `ApiSlow`, `CpuHigh`, `FileQueueGrowing`); Kubernetes manifests |
| **Database** | PostgreSQL 17 | All records of every organization; about 10,000 documents per project and many projects per server; connection count is the first ceiling | Yes | One primary takes every write: simple, consistent, and far from its limits at pilot size | Standby with promotion, read replica for register pages, PgBouncer connection pool (alerts `DatabaseConnectionsHigh`, `RegisterSearchSlow`, `StandbyLagging`) |
| **Organizations kept apart** | Postgres row-level security, forced, on every tenant table; the app's database role cannot bypass it | Any number of organizations in one deployment; a query that forgets its filter still sees only its own organization | No: it is the foundation | None in practice; a client who demands its own server gets a separate deployment of the same build | Separate deployment per client (same Compose or Kubernetes files) |
| **Records kept** | Postgres triggers on every record table (documents, revisions, files, reviews, transmittals, packages, schedule reads, decisions); a package only while it holds a document or went out | No record is ever deleted: not by the application, a bug or a mistaken query. Documents change state (withdrawn, cancelled, archived) instead | No: it is the credibility of the register | Only the server owner can delete, as the database superuser, deliberately (ACTIVATION.md "Deleting a record") | — |
| **Backups** | pgBackRest: full weekly, incremental daily, write-ahead log archived at least every 60 s; monthly restore drill | Restoring the database to any moment, losing at most about a minute | Yes | Kept on the server's own disk until go-live | Repository on object storage in another region, encrypted (go-live step 5); alerts `BackupTooOld`, `BackupFailing`, `WalArchivingFailing`, `RestoreDrillOverdue` |
| **Files** | S3-compatible object storage: SeaweedFS locally, Hetzner Object Storage in production. Browsers upload and download directly through signed links that last minutes | Files up to 2 GB each; unlimited total; never overwritten (each file has its own key) | Yes | Local SeaweedFS until go-live; the API never carries file bytes, so file size does not load it | Hetzner (go-live step 3), Azure Blob Storage (one setting), second copy in another region by rclone (alert `FileBackupTooOld`) |
| **Virus scanning** | ClamAV, every upload streamed through it by the worker before use; SHA-256 and size checked; file type read from its bytes | Every file before anyone can open it | Yes | One scanner (about 1.5 GB of memory) and one worker | More workers (alert `FileQueueGrowing`) |
| **Background work** | RabbitMQ, fed through an outbox in the same transaction as the change; three queues: files, extraction, checks | Nothing lost if a node dies; retried 5 times, then parked for a person (alerts `OutboxStuck`, `FilesParked`) | Yes | One RabbitMQ node: adequate until several servers | Runs unchanged with more workers; a managed or clustered RabbitMQ is a connection string |
| **Cache and sessions** | Valkey (Redis-compatible) for the shared cache; sessions themselves in Postgres | Session checks cached 30 s; signing out ends a session on every node | Little | One Valkey node; losing it only costs speed, never data | — |
| **Sign-in** | Session cookie, password hashing, lockout after 5 failures for 15 minutes, 10 attempts per minute per address | Every organization's people | Yes | Passwords only, by default | Per organization, by its administrator: two-step sign-in (optional or required), single sign-on with its own Microsoft, Google, Okta or Keycloak. Not built: SAML (would go through Keycloak) |
| **Audit** | Append-only, hash-chained log in Postgres; updates and deletes refused by the database | Every act, provably untampered (check `RG-01`) | Little | — | — |
| **Search** | Postgres: every word in the number or title, and inside files where reading is on | Ten thousand documents per project answer in milliseconds | Yes | Exact words only (no misspellings, no ranking): enough until projects grow or people ask for more | OpenSearch: ranked, forgiving, falls back to Postgres if down (alerts `RegisterSearchSlow`, `SearchIndexBehind`, `SearchFallingBack`) |
| **Reading inside files, OCR** | Nothing runs: off by policy (client privacy) | — | On request only | Off until a client asks in writing | Apache Tika with Tesseract, per project: off, on demand, automatic; switching off deletes what was read |
| **Stamping** | PDFsharp in the worker, fonts embedded | Released PDFs stamped (number, revision, status, date); superseded ones watermarked; originals never changed | Little | A PDF that cannot be opened is recorded once and the release stands | — |
| **Numbering** | Schemes the organization builds from fields (project, discipline, type, sender, fixed text, sequence…), routed per deliverable type and per record kind (transmittals, reviews, packages) | Every number allocated by the system, never typed, never reused, never changed | Yes: any scheme, any time, as data | A record kind with no scheme still gets a plain number (P1001-TR-0001) so nothing is ever blocked | — |
| **Revisions** | Revision schemes with series (A, B, C for design; 0, 1, 2 for execution), routed per deliverable type | One current revision per document; corrections Document Control asks for stay under the same revision as numbered submissions | Little | — | — |
| **Reviews and approvals** | Routes the organization defines: steps by function or by outside party, days allowed, who decides, which statuses each step may grant; verdicts, advice, comment classes and return reasons from its own lists | Every review from submission to release; other organizations either in the app or by proxy, with their answer and proof recorded by Document Control | Yes: more step kinds as clients ask | — | — |
| **Document Control's check** | Its own list of outcomes (accept, return to sender or initiator, return for a new revision, release), separate from review verdicts | What arrives from outside, and what reaches the release gate | Little | — | — |
| **Transmittals and issue** | Issue requests, a distribution matrix, transmittal numbering, acknowledgement in the app; for outside parties working in their own systems, dispatch recorded with proof. Both ways: what another organization sends us comes on its own incoming transmittal, numbered in its series | Every issue, who received what and when, and what is still to send; every submission received, with a receipt (PDF, each file's SHA-256) issued the moment it is sent | Yes: e-mail delivery when wanted | Answers are tracked through review steps; a plain transmittal records acknowledgement, not an answer | — |
| **Packages** | Sets of documents, filled by hand or by a rule, assessed against required statuses. Delivery packages go out on transmittals; supply packages hold what one supplier owes (its placeholders, by order), asked of it on a transmittal and seen by its people | Handover and construction sets; vendor data; a shortfall goes only with its acceptance authority's agreement; an empty package that never went out can be deleted | Little | — | — |
| **Checks** | 34 checks in the worker, nightly per project and on request | Integrity and coverage scores, a defect register that closes itself | Yes: more checks as modules are added | Only what the register can answer is checked | — |
| **Schedules** | The schedule as a controlled document; its released Excel or CSV export read into activities by the worker | Activities, what each needs and for what, readiness, waivers, decisions, lateness | Yes: Primavera .xer if a client needs it | Exports only: the file must have an activity code, a name and a start column | — |
| **Reports** | Five reports counted from the register when opened; CSV (ClosedXML for Excel) | Register status, deliveries, reviews waiting, transmittals, readiness | Yes: more reports, scheduled e-mailing | Counted live on every opening: fine to tens of thousands of documents per project | Reports read from the read replica once it is switched on, so they never slow the primary |
| **Load balancing** | Caddy in front of the API nodes, HTTPS by itself once a domain is set | Any number of API nodes on one server | Yes | One server | Several servers behind a Hetzner Load Balancer |
| **Hosting** | Docker Compose on one Hetzner VPS | Everything above | Yes | One server: cheapest, simplest, and enough for a pilot | Several servers; Kubernetes (manifests checked on every push) |
| **Monitoring** | Prometheus, Alertmanager, Grafana; 25 alert rules, each saying what to do | Knowing a limit is near before people notice | Yes | Alerts go nowhere until a channel is set | Email, Telegram, Slack or webhook (go-live step 7) |
| **Quality gate** | GitHub Actions: formatting, build, 112 tests against real Postgres, Redis, RabbitMQ and storage; image build, stack start, backup and restore drill, alert rule tests, Kubernetes validation | Every push | Yes | — | — |

## The libraries, and what each is for

| Library | What it does here |
|---|---|
| ASP.NET Core (Minimal APIs) | Receives HTTP requests and sends answers; each endpoint is a small function mapped to a path |
| Entity Framework Core + Npgsql | Reads and writes Postgres through C# classes; migrations change the database schema step by step |
| EFCore.NamingConventions | Turns C# names (`DocumentId`) into Postgres ones (`document_id`) |
| NodaTime | Dates and times without time-zone mistakes: a day on site is a `LocalDate`, a moment is an `Instant` |
| RabbitMQ.Client | Sends work to the worker and receives it there |
| AWSSDK.S3 / Azure.Storage.Blobs | Files in S3-compatible storage (SeaweedFS, Hetzner) or Azure; signed upload and download links |
| PDFsharp | Stamps released PDFs, watermarks superseded ones, and draws the receipt of an incoming transmittal |
| ClosedXML | Reads schedule exports from Excel; writes report exports to Excel |
| Microsoft.Extensions.Caching (Hybrid, Redis) | The shared cache in Valkey, with a fast copy in each node's memory |
| DataProtection (stored in Postgres) | Encrypts secrets the app keeps: two-step sign-in keys, single sign-on state |
| Microsoft.IdentityModel OpenID Connect | Talks to an organization's own sign-in provider for single sign-on |
| Serilog | Writes logs as structured lines, one per request, readable by tools |
| prometheus-net | Publishes the numbers the alerts watch |
| AspNetCore.HealthChecks | Says whether the database and cache answer, for the load balancer and monitoring |
| Sentry | Reports crashes to a Sentry account; off unless a key is set |
| OpenAPI | Describes every endpoint at `/api/openapi/v1.json`; the frontend's client is generated from it |
| xunit + Testcontainers (tests only) | Runs the tests against real Postgres, Valkey, RabbitMQ and storage started in Docker |

## What the organization decides

Values, numbering, revision schemes, review routes, statuses, verdicts,
reasons for issue, Document Control's outcomes, outside parties and how they
take part, the permission matrix, which checks each project answers to, two-step
sign-in and single sign-on, and reading inside files (per project). The
application ships recommendations; the administrator changes them as data.

## Two kinds of switch

- **Go-live (once, all together):** only after the owner's own testing of the
  finished backend and frontend is positive. The list is ACTIVATION.md "Go-live".
- **Growth (when its alert or a client says so):** everything in the last
  column above, one at a time.
