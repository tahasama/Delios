# Handing DELIOS over for real use

For whoever puts DELIOS into production: DELIOS's own team, a company installing it for itself, or a partner running it
for others. **No code is changed.** Every paid service is a subscription and a few lines in `.env`. Any developer used
to Docker can do it in a day.

The detailed runbook, with every option, is `docs/ACTIVATION.md`. This page is the short path.

---

## First: who runs it

One line in `.env` decides it:

| | `HOSTED=true` (the default) | `HOSTED=false` |
|---|---|---|
| Who | DELIOS runs it for many organizations | One company (or a partner) runs its own copy |
| Trials, plans, invoices, renewals | Yes, managed in the console | None: every organization simply works |
| "Reads only" when not paid | Yes | Never |
| The console | Everything | Organizations, legal texts, support, notices, team, log |
| The organization's "Contract & plan" | Plan, invoices, cancelling, terms, support access | "Terms & support": terms and support access only |

Everything else is the same app. Switching later is only that line and a restart.

---

## The services to subscribe to

| What | Needed? | Suggested (cheapest reliable) | Goes in `.env` |
|---|---|---|---|
| Server | Yes | A VPS with 4 cores, 16 GB (e.g. Hetzner) | — |
| Domain | Yes | Any registrar | `SITE_ADDRESS`, `PUBLIC_URL` |
| File storage | Yes | Hetzner Object Storage, AWS S3, or Azure Blob | `STORAGE_ENDPOINT`, `STORAGE_PUBLIC_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` (Azure: `STORAGE_PROVIDER=azure`, `AZURE_STORAGE_*`) |
| Email | Yes | Amazon SES (EU), Brevo, Postmark | `EMAIL_ENABLED=true`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` |
| Backups off the server | Yes | Another bucket, another provider or region (Backblaze B2, Wasabi…) | `BACKUP_REPO_TYPE=s3`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_KEY`, `BACKUP_S3_SECRET`, `BACKUP_CIPHER_PASS` |
| Second copy of the files | Yes | Same as backups, another bucket | `FILE_BACKUP_TARGET_TYPE=s3`, `FILE_BACKUP_TARGET_PATH`, `RCLONE_CONFIG_TARGET_ENDPOINT`, `RCLONE_CONFIG_TARGET_REGION`, `RCLONE_CONFIG_TARGET_ACCESS_KEY_ID`, `RCLONE_CONFIG_TARGET_SECRET_ACCESS_KEY` |
| Front door and bot check | Yes, if sign-up is open | Cloudflare (free; Pro for the full firewall) | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` |
| Alerts to a person | Yes | Email, Telegram, Slack or a webhook | `ALERT_CHANNEL` (see `docs/ACTIVATION.md`, "Alert notifications") |
| Error tracking | Recommended | Sentry | `SENTRY_DSN` |
| Card payments | Only with `HOSTED=true`, if wanted | Not connected yet: invoices and bank transfers work by hand | — |

---

## The steps, in order

1. **Server:** Docker installed, the repository cloned, then `sh deploy/init-env.sh` (new passwords, never a test
   machine's). Keep a copy of `.env` off the server.
2. **Mode:** `APP_ENVIRONMENT=Production`, `SANDBOX=false`, `HOSTED=` as decided above, `SIGN_UP_ENABLED=` true or
   false (false: organizations are created by the team, below).
3. **Files:** the bucket, with versioning on and CORS allowing `GET, HEAD, PUT` from the site's address.
4. **Domain and HTTPS:** `SITE_ADDRESS`, `PUBLIC_URL`, `SECURE_COOKIE=true`, `HTTP_PORT=80`, `HTTPS_PORT=443`;
   ports 80 and 443 open. The certificate is made by itself.
5. **Email**, **backups**, **second copy**, **alerts**, **errors**: the lines in the table.
6. **Start:** `docker compose --profile app up -d --build`.
7. **The team's console account:**
   `docker compose --profile app run --rm -e DELIOS_OPERATOR_PASSWORD='<14 characters or more>' migrate create-operator <email> "<name>"`,
   then sign in at `/console` and set up the authenticator.
8. **In the console:** the legal texts (Legal: the parts in red are a lawyer's to write), how organizations reach
   support (Support), and with `HOSTED=true` the plans, the free trial's length and the company's own details for
   invoices (Plans & payments).
9. **The first organization:** by sign-up, or
   `docker compose --profile app run --rm -e DELIOS_ADMIN_PASSWORD='<12 characters or more>' migrate create-tenant <short-name> "<Organization name>" <admin-email> "<Admin name>"`
   (never `seed-demo` in production).
10. **Check:** the site opens; an upload and a download work; an email arrives; the first backup shows in the log;
    run the restore drill once (`docker compose --profile drill run --rm restore-drill`).

---

## Three secrets to keep off the server, in a password manager

- `.env` as a whole.
- `FILES_KEY` (inside `.env`): every file is stored encrypted with it. **Lost, no file can ever be read again**, backups
  included.
- `BACKUP_CIPHER_PASS`: without it, the database backups cannot be read.

---

## What stays the owner's to decide (not technical)

- The legal texts: terms of service, privacy policy, data processing agreement (drafts in the console; a lawyer
  finishes them). With `HOSTED=false`, the company running it writes its own.
- Who deletes an organization's data once its contract ends, and after how long (DELIOS's rule: the app owner or whoever
  of their team they delegate, never the app by itself).
- Support: who answers, when, and how organizations reach them (set in the console).
