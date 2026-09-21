# Rollout and upgrade runbook

How to bring an installation onto the rebuilt EDMS, how new organizations and
projects start, and how to back out. Commands assume the repository root.

## 1. Before you start

1. **Back up the database.** With SQLite this is the file named in `DATABASE_URL`
   (`prisma/review.db` in development). Copy it somewhere safe.
2. **Stop the app.** On Windows the running server holds the Prisma engine
   open and `prisma generate` fails until it is stopped.
3. Note the commit you are on, so you can return to it.

## 2. Upgrade

```bash
npm install
npx prisma migrate deploy    # applies every migration not yet applied
npx prisma generate
npm run upgrade              # adds new default functions and the reference Traceability Spine where missing
npm run verify               # eight suites; all must pass
```

What the recent migrations do, and what they need from you:

| Migration | Effect | Your action |
|---|---|---|
| `supplier_packages` | Packages gain a category and a supplier party code. | Create one supplier package per supplier under Packages → From suppliers. |
| `schedule_requirements` | Requirements gain department, sender, approver and a needed-by rule; existing dates are kept as fixed dates. | None. Re-issue the requirements list when convenient so dates follow the 5-working-day rule. |
| `requirements_process` | Department calls, sender issues, readiness confirmations; people gain a department. | Set each person's **department** on Settings → People. Without it nobody receives the department's call or can confirm its readiness. |
| `traceability_spine` | The spine is rebuilt per relationship; the old per-check rows are removed. | Run `npm run upgrade`, then review what it flags on Conformance → Traceability. |

The schedule upload no longer carries departments. Departments come only from
the project manager's **Departments per activity** list (Schedule & actions →
Requirements, step 1). Departments already on activities are kept.

## 3. After the upgrade

1. Sign in as an administrator and open **Settings → Scope & readiness**. It
   lists, in order, the decisions still missing, each read from live data.
2. Run the checks once (**Conformance → Run the checks**) so the dashboard and
   the statement carry a current measurement.
3. On **Conformance → Traceability**, review the links in *Review required*
   and record a decision for each. A synchronized baseline can be released
   only when no Gap or Review required remains (Annex F.5).

## 4. New organizations and projects

* **Signup** creates the organization with the reference configuration
  (`src/lib/profiles/reference.json`). If a first project is opened at
  signup, its type's starter profile is added straight away.
* **First project opened from setup** — the same: the organization is still
  being set up, so the profile is published directly.
* **Any later project of a type the organization has not run** — the
  profile's missing values are **drafted** as controlled changes, one per value
  set. An administrator submits them and a second administrator approves
  them. Opening a project never publishes configuration by itself. Scope &
  readiness shows any profile still unpublished, with *Prepare drafts*.

## 5. Changing the starting configuration

Starting configuration is data, not code:

| File | Holds |
|---|---|
| `src/lib/profiles/reference.json` | Annex D reference sets every organization starts from |
| `src/lib/profiles/industrial.json` | Industrial / process plant additions |
| `src/lib/profiles/energy.json` | Energy / power additions |
| `src/lib/profiles/construction.json` | Construction / buildings additions |

A profile only **adds** values; it never removes or relabels what an
organization has published. To add a project type, add a JSON file with a
unique `projectKind` and list it in `src/lib/profiles/index.ts` and
`src/lib/profiles/kinds.ts`. `npm run verify:rollout` checks that profiles
do not clash with the reference.

Changes to these files affect **new** organizations only. Existing
organizations change their published sets through Settings → Controlled
changes, like any other configuration.

## 6. When the Standard changes

1. Regenerate the check catalogue (`src/lib/checks/catalog.ts`) and the rule
   register (`src/lib/checks/rules.ts`) from the published document. Never edit
   them by hand.
2. Deploy. Every spine link whose Rule or Check changed moves to *Review
   required* automatically (DEF-CF-22).
3. Review them on Conformance → Traceability, then release a new synchronized
   baseline.

## 7. Backing out

1. Stop the app.
2. Restore the database file saved in step 1.
3. Check out the commit noted in step 1, then `npm install` and
   `npx prisma generate`.

Migrations are not reversed in place. Restoring the backup is the rollback.
