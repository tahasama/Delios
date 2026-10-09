# Session handoff: where DELIOS stands, and how to carry on

The backup of the working session that rebuilt DELIOS on its own backend (October 2026). A new session reads this
first. It says:
- what the product is now;
- the rules agreed with the owner;
- the decisions taken;
- how to run and test it;
- what is still open.

Last state: `main` at the merge of [PR #2](https://github.com/tahasama/Delios/pull/2). Working branch
`claude/clever-edison-36ou77`. Backend tests: 148/148.

---

## 1. The product

- **DELIOS EDMS:** electronic document management for engineering and construction projects. It covers the
  register, revisions, reviews, release, transmittals, packages, schedule readiness, suppliers and checks.
- **Backend:** `backend/`, ASP.NET Core 10.
  - PostgreSQL with row-level security per organization.
  - RabbitMQ through an outbox.
  - A worker that scans, stamps and reads schedules and requirements lists, and runs the late-review warnings.
  - SeaweedFS (S3) for files, ClamAV for scanning.
  - Everything runs from `deploy/compose.yaml`.
- **Frontend:** the repository root, Next.js 16. The screens are the owner's. It reads and writes only through
  the backend (`DELIOS_API_URL`).
- **Docs worth reading next:**
  - [BEHAVIOUR-CHANGES.md](BEHAVIOUR-CHANGES.md): everything that behaves differently from the old app, and why.
  - [FRONTEND-GAPS.md](FRONTEND-GAPS.md): what was added while connecting the screens (nothing is missing now).
  - [LAUNCH-AND-SECURITY.md](LAUNCH-AND-SECURITY.md): legal documents, Cloudflare, email, security, AI
    assistant, secrets.
  - [ACTIVATION.md](ACTIVATION.md): going live, backups, restore drill, standby, scaling.
  - [DOTNET-GUIDE.md](DOTNET-GUIDE.md): the backend explained for someone new to .NET.
  - [ARCHITECTURE.md](ARCHITECTURE.md), [SYSTEM.md](SYSTEM.md), [REVIEW-MODEL.md](REVIEW-MODEL.md), [ROLLOUT.md](ROLLOUT.md).

---

## 2. Standing rules from the owner

**Screens**
- **Don't change the design.** Missing pieces may be *added* to the frontend in its existing style; nothing is
  removed or restyled.
- **No screenshots.** Check the app with scripts, and report in words.

**How to work with the owner**
- Keep replies short and plain. The owner is new to .NET and works on **Windows, PowerShell**, in
  `C:\Users\Taha\Desktop\delios-edms`. Give commands for that.
- Ask before choosing anything the owner will live with, especially **codes**: a value's code never changes
  once documents use it. Show the proposed codes and wait for an OK.

**Data**
- Statuses, lists and names are the organization's own, never hard-coded.
- **Nothing is deleted** except by the app owner: retire, mark or supersede instead.
- **No document number before registering:** a number is given only when a document is registered.

**Repository**
- Never commit credentials. Secrets live in `deploy/.env`, which git ignores.
- Never put the owner's email in anything pushed.
- No model names in commits, pull requests or code.
- Work on `claude/clever-edison-36ou77`. Open a pull request only when asked, and merge only when asked; the
  owner has said yes each time so far.
- After a merge, restart the branch from `main` before new work.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019FCETtuFmuk6XnjgydThU5
  ```

---

## 3. Decisions taken

| Topic | Decision |
|---|---|
| Distribution | Who receives what comes from the **Receive** permission in the matrix (Functions & permissions). The old separate "distribution rules" table had no screen and is not used. |
| Review needed or not | The switch is on **document types** ("Reviewed before release"). It stays there. |
| Correspondence | Deliverable type **COR**, numbered like Engineering. Its document types are not reviewed: MOM, LET, SRP, PHO, TCR, DLN, PMT, VCM, RFI. |
| Release without review | "Release as [status]" sends a not-reviewed type on and releases it; a reviewed type is refused. |
| Requirements list | A controlled document: type **RQL**, or any type marked "Is a document requirements list". It is reviewed as a PDF, and its spreadsheet is **read automatically on release**, all or nothing. A wrong line applies nothing and tells Document Control. The old "upload for a decision" stays as the manual way. |
| Needed documents | Listed whatever their state, with a flag in the organization's own words (placeholder, in review, released & issued…). They count as ready only when released at the required status. |
| Schedule source | Comes from the released schedule document automatically; no manual linking. |
| Clearance | A function may be limited to a confidentiality level. Above it, only people named on the document, its registrant, and people it was sent to can read it. This applies to Document Control too. No clearance means no limit. |
| Two-step sign-in | Asked on the sign-in page, with first-time setup and recovery codes shown once. |
| Comments | The review page has a Comments card: write, change and take back your own until you answer. Document Control or the revision's author reclassifies. |
| Opening files | Only PDFs and plain images open in the browser; everything else downloads. |
| Matrix by family | A family row is kept as one rule per document type, each labelled with the family. |
| Administrators | An administrator opening a project they are not on joins it with the administrator function. |
| Project kind | Stored on the project. |
| Renaming steps | **No change.** Route step titles are already editable; flow steps stay as they are. |
| Email | Sent through SMTP, switched off by default. Recommended provider: Amazon SES, EU region. |
| Video teaser | latent-spaces/brag can make a 15–25 s launch video; not for tutorials. |

---

## 4. Running it locally (owner's machine, PowerShell, from `delios-edms`)

```powershell
git checkout main
git pull
docker compose -f deploy/compose.yaml --profile app up -d --build
docker compose -f deploy/compose.yaml --profile app run --rm migrate seed-demo
npm install
npm run dev
```

- Open http://localhost:3000.
- Run the commands from the project folder itself, not from `deploy\`.
- If `git pull` complains about `tsconfig.json`, run `git stash` first. Next.js rewrites that file.
- `seed-demo` only adds what is missing.

**Demo accounts** (password `demo1234`):

| Account | Role |
|---|---|
| `admin@demo.local` | Administrator |
| `controller@demo.local` | Document Control |
| `engineer@demo.local` | Engineer |
| `approver@demo.local` | Approver |
| `viewer@demo.local` | Viewer |
| `supplier@acme.local` | Supplier (Acme Pumps) |

**A real organization:** register at `/signup`, or use the command line (password of 12 characters or more):
```powershell
$env:DELIOS_ADMIN_PASSWORD = "a-long-password"
docker compose -f deploy/compose.yaml --profile app run --rm -e DELIOS_ADMIN_PASSWORD migrate create-tenant myorg "My Organization" you@company.com "Your Name"
```

**Vercel on its own:** the sign-in page shows, but sign-in fails. The backend must be reachable from the
internet: use a small server, or briefly a Cloudflare Tunnel, and set `DELIOS_API_URL` in Vercel. Files also need
`STORAGE_PUBLIC_ENDPOINT`.

---

## 5. Working on the code (for the next session)

**Backend**
- Build: `cd backend; dotnet build src/Delios.Host`.
- Tests: `dotnet test` from `backend/`. They need Docker (Testcontainers), and a full run takes about 5 minutes.
- Format: `dotnet format`.

**Database migrations**
1. Run `dotnet ef migrations add Name -p src/Delios.Host -s src/Delios.Host -o Platform/Migrations`.
2. For each new table, add `using Delios.Host.Tenancy;` and `RowLevelSecurity.Enable(migrationBuilder, "<table>")`.
3. A data backfill that must see every organization loops over `tenants` and calls
   `set_config('app.tenant_id', …)` for each. Row-level security is forced, even for the table owner.

**Limits that bit before**
- An outbox routing key is at most **16 characters**.
- `ControlledVersion.VersionLabel` is at most 16 characters.

**Frontend**
- Type check: `npx tsc --noEmit`.
- Data code lives in `src/lib/api/*` and `src/lib/actions/*`. Pages change only to add missing pieces in their
  existing style.

**Patterns**
- One transaction per request (`TransactionFilter`).
- Project access comes from `ProjectAccessFilter`, plus `access.Allows(verb, facts)`. Visibility goes through
  `DocumentQueries.Visible`.
- Errors come from `Problems.*` (422, 409, 403, 404).
- Every act is written with `AuditLog.WriteAsync`. People are told with `Notifier.NotifyAsync`.
- Organization defaults are added through `DemoSeed.Ensure*SetupAsync`, which adds only what is missing.

**CI on GitHub:** test, image and kubernetes jobs, plus Vercel and GitGuardian checks. All are green on `main`.

---

## 6. Still open

**Before a server goes on the internet** (the owner said leave for now; details in LAUNCH-AND-SECURITY.md):
1. Put the frontend in the Docker setup. Today it runs with `npm run dev`.
2. Close the internal ports `deploy/compose.yaml` publishes: Postgres, PgBouncer, Valkey, RabbitMQ and its
   console, SeaweedFS, ClamAV. Docker gets past `ufw`.
3. Add security headers on every page: `frame-ancestors 'self'`, HSTS, `nosniff`, a referrer policy.
4. Password reset ("forgot password").
5. Set `STORAGE_PUBLIC_ENDPOINT` for a deployed site.
6. Production settings: Amazon SES, secrets in a secret manager, a maximum session age, and a record of refused
   access attempts.
7. Cloudflare in front: Pro plan, WAF, a rate limit on `/api/auth/*`, Turnstile, Tunnel.

**Not code**
8. Legal documents: terms, privacy policy, data processing agreement with the list of sub-processors, MSA,
   refund clause.
9. Cyber and professional indemnity insurance.

**Small things**
10. The import page still offers "Actions & deliverable baseline", which answers "not supported". Proposal:
    point it to the RQL requirements list. Waiting on the owner.
11. A backend test failed once in one full run and passed on reruns; it was never identified. Watch for it.
12. Later, if wanted: an in-app assistant. Start with an EU-hosted model API, or Qwen3.8-27B on a serverless GPU
    if nothing may leave your control.

---

## 7. DMS (not EDMS): to fill in

The owner mentioned "what would need updating in a DMS that is not an EDMS, which we had before". None of this
exists in this repository, the blueprint document, this session or the owner's other repositories. The earlier
notes came from a conversation not available here.

**Next step:** ask the owner for those notes, or for what the DMS is: a lighter, general edition of DELIOS, or a
separate product. Then fill in this section.
