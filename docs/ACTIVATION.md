# Activation runbook

Everything the architecture defers is already built, tested and switched off.
When an alert says it is needed, this page says how to switch it on, and how to
check it worked. Nothing here needs code changes.

Commands assume the repository root. `C` below stands for
`docker compose -f deploy/compose.yaml`. Settings go in `deploy/.env` (never
committed), which Compose reads automatically. `sh deploy/init-env.sh` creates
it once with a random password for every service; Compose refuses to start
without it. In production, keep a copy of it, and of `BACKUP_CIPHER_PASS`,
somewhere other than the server.

## How you find out

Monitoring runs with the `monitoring` profile:

```bash
C --profile app --profile monitoring up -d
```

| Where | What |
|---|---|
| Grafana, http://localhost:3301 (`admin`, password `GRAFANA_ADMIN_PASSWORD` in `deploy/.env`) | The **DELIOS overview** dashboard: firing alerts at the top, then API, files and messages, database, backups and server |
| Alertmanager, http://localhost:9093 | Every alert currently firing |
| Prometheus, http://localhost:9090 | The raw measurements and the alert rules |

Alerts come in two kinds (rules in `deploy/monitoring/alerts.yml`):

- **critical / warning**: something is broken or about to break. Act now.
- **plan**: a threshold from ARCHITECTURE.md "When to scale" has been crossed.
  Nothing is broken; the alert's `switch` label names the section below to follow.

Every alert carries a summary and an action line.

## Alert notifications

By default alerts show in Grafana and Alertmanager but reach nobody. To be told:

1. Pick a channel: `email`, `telegram`, `slack` or `webhook`.
2. Open `deploy/monitoring/alertmanager/<channel>.yml` and fill in the values
   marked `CHANGE`.
3. Put the secret (SMTP password, bot token, webhook URL) in
   `deploy/monitoring/alertmanager/secrets/`, under the file name the config
   names. That folder is never committed.
4. In `deploy/.env`: `ALERT_CHANNEL=telegram` (for example).
5. `C --profile monitoring up -d alertmanager`

**Check:** stop the worker for three minutes (`C stop worker`). A WorkerDown
message arrives, then a resolved message once you start it again (`C start worker`).

## Backups

**Already on.** The database image archives the write-ahead log continuously and
the backup loop takes a full backup weekly and an incremental daily. Stored
files are copied to a second location every 6 hours.

In development the backup repository and the file copy are Docker volumes. For
production, both must leave the server. In `deploy/.env`:

```bash
BACKUP_REPO_TYPE=s3
BACKUP_S3_ENDPOINT=fsn1.your-objectstorage.com   # another provider or region than the files
BACKUP_S3_BUCKET=delios-backups
BACKUP_S3_REGION=fsn1
BACKUP_S3_KEY=...
BACKUP_S3_SECRET=...
BACKUP_CIPHER_PASS=...      # long and random; keep it outside the server too. Without it the backups cannot be read.

FILE_BACKUP_TARGET_TYPE=s3  # plus RCLONE_CONFIG_TARGET_* keys for the second location
FILE_BACKUP_TARGET_PATH=delios-files-copy
```

Then `C --profile app up -d postgres file-backup`. Change the repository only
on a new database or right after a full backup.

**Alerts:** BackupTooOld, BackupFailing, WalArchivingFailing, FileBackupTooOld.

**Check:** the dashboard's "Backup age" panel stays under 24 hours.

## Restore drill (monthly)

```bash
C --profile drill run --rm restore-drill
```

It restores the latest backup and every archived log since then into a scratch
directory, starts it, and checks the tenants, the documents and every tenant's
audit chain. It prints `PASSED` and records the time it took: that is the
recovery time to expect. Schedule it on the host, for example in cron:

```
0 3 1 * * cd /srv/delios && docker compose -f deploy/compose.yaml --profile drill run --rm restore-drill
```

**Alert:** RestoreDrillOverdue (no passing drill for 35 days).

## Restore after losing the database

1. Stop the app: `C stop api worker`.
2. Move the broken data volume aside: `docker volume create delios_postgres_new`,
   and point the `postgres` service at it (or remove the old volume once copied off).
3. Restore into the empty volume:
   ```bash
   C run --rm --entrypoint sh postgres -c 'pgbackrest-conf.sh && chown postgres:postgres "$PGDATA" && chmod 700 "$PGDATA" && gosu postgres pgbackrest --stanza=delios restore'
   ```
   Add `--type=time --target="2026-10-07 09:30:00+00"` after `restore` to stop at
   a moment before a mistake. The log is archived at least every minute, so at
   most about a minute of work is lost.
4. `C up -d postgres`, wait until healthy, then `C up -d api worker`.
5. Run the restore drill once the next backup has finished.

## Standby

**When:** before the first contract depends on the system.

```bash
C --profile app --profile standby up -d
```

On first start it copies the primary, then follows it read-only. It falls back
to the backup repository if streaming falls behind.

**Alert:** StandbyLagging.

**Check:** `C exec postgres psql -U postgres -c "select state from pg_stat_replication"` shows `streaming`.

### Promote the standby

When the primary is lost:

1. `C exec -u postgres postgres-standby pg_ctl promote -D /var/lib/postgresql/data`
2. In `deploy/.env`: `DB_HOST=postgres-standby`, then `C up -d api worker`.
3. The old primary must not come back as a primary. Rebuild it as the new
   standby once the incident is over.

## Read replica

**Alert:** RegisterSearchSlow or ApiSlow while the database is the busy part.

1. Run the standby (above).
2. In `deploy/.env`:
   `DB_READ_CONNECTION=Host=postgres-standby;Database=delios;Username=delios;Password=...`
3. `C up -d api`

Register pages are read from the replica; anything a request has just written is
read back from the primary. If the replica stops answering, reads fall back to
the primary on their own.

## PgBouncer

**Alert:** DatabaseConnectionsHigh.

1. In `deploy/.env`: `DB_HOST=pgbouncer` and `DB_OPTIONS=No Reset On Close=true`
2. `C --profile app --profile pgbouncer up -d`

Migrations keep connecting to Postgres directly. Transaction pooling is safe
because the tenant is set per transaction; a test proves it with 200
interleaved transactions of two tenants over three connections.

**Check:** the "Database connections" panel drops and stays flat as load grows.

## Second API node, more workers

**Alerts:** CpuHigh, ApiSlow (second API node); FileQueueGrowing (more workers).

```bash
C --profile app up -d --scale api=2 --scale worker=2
```

Caddy and Prometheus find the new nodes by themselves. Sessions, cookies and
locks are shared through Postgres and Redis, so a person signed in on one node is
signed in on all of them.

**Check:** responses carry `X-Delios-Node`; it alternates between nodes.

## Several servers

When one server is not enough: put the database on its own server (with its
standby on a third), run the app's compose stack on two or more servers, and
put a Hetzner Load Balancer (or HAProxy) in front of their Caddy. Point
`DB_HOST`, `ConnectionStrings__Redis`, `ConnectionStrings__RabbitMq` and the
storage settings of every app server at the shared services.

## Domain and HTTPS

In `deploy/.env`: `SITE_ADDRESS=app.example.com`, publish ports 80 and 443 in
the `caddy` service, and set `Auth__SecureCookie` back to `true` (remove the
override). Caddy obtains and renews the certificate itself.

## Two-step sign-in (MFA)

Built and on for anyone who wants it; required only when the organization says so.

- **A person turns it on** for themselves: `POST /api/me/mfa/setup` gives the
  secret and an `otpauth://` link to show as a QR code; `POST /api/me/mfa/confirm`
  with a code from the app puts it in force and returns ten recovery codes, shown once.
- **The organization requires it:** an administrator sends
  `PUT /api/admin/security {"mfaRequired": true}`. Everyone without it enrols at
  their next sign-in; nobody can turn it off while it is required.
- **Lost phone, no recovery codes left:** an administrator calls
  `POST /api/admin/users/{id}/mfa/reset`; the person enrols again next time.
- **Watch:** `GET /api/admin/security` reports how many people have enrolled.
  Wrong codes count towards the same lockout as wrong passwords, and appear in
  the audit log as `MFA_FAILED`.

## Single sign-on

For an organization that wants its people to sign in with their company
account (Microsoft Entra ID, Google Workspace, Okta, Keycloak; anything that
speaks OpenID Connect). Nothing to install; it is configured per organization.

1. In the identity provider, register an application (a "web" app, confidential
   client) with the redirect address `https://<your domain>/api/auth/sso/callback`.
   Note its issuer address, client id and client secret.
2. In `deploy/.env` set `PUBLIC_URL=https://<your domain>`, then
   `docker compose ... up -d` so the API knows its own address.
3. An administrator sends:
   ```
   PUT /api/admin/security/sso
   {"name": "Sign in with Contoso", "authority": "https://login.microsoftonline.com/<tenant-id>/v2.0",
    "clientId": "...", "clientSecret": "...", "allowedDomains": ["contoso.com"]}
   ```
   The secret is stored encrypted and never shown again.
4. The sign-in page asks `GET /api/auth/sso?tenant=<slug>` whether to show the
   button, which leads to `/api/auth/sso/start?tenant=<slug>&returnUrl=/`.
5. Once it works, optionally `PUT /api/admin/security {"passwordSignIn": false}`:
   everyone then signs in through the provider. Administrators keep their
   password (and two-step sign-in), so a broken provider never locks the
   organization out; switching the provider off turns passwords back on.

People are matched by email to accounts that already exist here; signing in
creates nobody. Refusals land on `/sign-in?sso_error=<CODE>` (`SSO_NO_ACCOUNT`,
`SSO_DOMAIN_NOT_ALLOWED`, `SSO_TOKEN_INVALID`…) and the reason is in the API log.

## OpenSearch

**When:** `RegisterSearchSlow` fires and the read replica did not cure it, or
people want ranked, forgiving search (misspellings, best match first).

Until then searches are answered by Postgres: every word must appear in the
number or the title. With OpenSearch on, the same `GET /api/projects/{id}/search?q=`
answers from the index; which documents a person may see is still decided by
Postgres, so the index never widens anyone's view. It holds register entries only,
never file content (that waits for content extraction, which is off).

1. Give the server 2 GB more memory (the index uses `SEARCH_HEAP`, 1g by default).
2. In `deploy/.env`: `SEARCH_PROVIDER=opensearch`.
3. `docker compose -f deploy/compose.yaml --profile app --profile search up -d`
4. The worker fills the index from the register by itself; `docker compose logs worker`
   shows "Sent N document(s) to the search index". 10,000 documents take a minute or two.
5. The search answer says `"provider": "opensearch"`.

**If it breaks:** searches fall back to Postgres on their own; `SearchFallingBack`
and `SearchIndexBehind` say so. To rebuild the index from scratch (after an
upgrade, or if in doubt): `docker compose ... run --rm migrate reindex`.
**To switch off:** `SEARCH_PROVIDER=postgres`, `up -d`; stop the `opensearch` container.
The index is not backed up: it is rebuilt from the database.

## Still to build

These follow the product steps (see ARCHITECTURE.md "Build plan") and will get
their own sections here: content extraction and OCR, Azure Blob storage,
Kubernetes.
