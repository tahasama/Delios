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
| **Checks** | 34 checks in the worker, nightly per project and on request | Integrity and coverage scores, a defect register that closes itself | Yes: more checks as modules are added | Only what the register can answer is checked | — |
| **Schedules** | The schedule as a controlled document; its released Excel or CSV export read into activities by the worker | Activities, what each needs and for what, readiness, waivers, decisions, lateness | Yes: Primavera .xer if a client needs it | Exports only: the file must have an activity code, a name and a start column | — |
| **Reports** | Five reports counted from the register when opened; CSV (ClosedXML for Excel) | Register status, deliveries, reviews waiting, transmittals, readiness | Yes: more reports, scheduled e-mailing | Counted live on every opening: fine to tens of thousands of documents per project | Reports read from the read replica once it is switched on, so they never slow the primary |
| **Load balancing** | Caddy in front of the API nodes, HTTPS by itself once a domain is set | Any number of API nodes on one server | Yes | One server | Several servers behind a Hetzner Load Balancer |
| **Hosting** | Docker Compose on one Hetzner VPS | Everything above | Yes | One server: cheapest, simplest, and enough for a pilot | Several servers; Kubernetes (manifests checked on every push) |
| **Monitoring** | Prometheus, Alertmanager, Grafana; 25 alert rules, each saying what to do | Knowing a limit is near before people notice | Yes | Alerts go nowhere until a channel is set | Email, Telegram, Slack or webhook (go-live step 7) |
| **Quality gate** | GitHub Actions: formatting, build, 93 tests against real Postgres, Redis, RabbitMQ and storage; image build, stack start, backup and restore drill, alert rule tests, Kubernetes validation | Every push | Yes | — | — |

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
