# Conformance, reports and the smaller screens: what the screens need that the backend lacks

Screens: `/conformance/checks` (catalogue, one-kind drill-down), `/conformance/statement`, `/conformance/rules`, `/exposures`, `/reports`, `/distribution`, `/guide`, `/notifications`, `/assets`, `/assets/[id]`. Actions: `src/lib/actions/conformance.ts`; `src/lib/matrix-read.ts` (the distribution-matrix import, used by `src/lib/actions/bulk.ts`). Route: `/api/reports/[id]`.

The check catalogue on the screens (`src/lib/checks/catalog.ts`) now mirrors the backend's 35 checks (`Checks/Catalog.cs`: ids, moments, wording, severity, owner). The old frontend list of ~100 checks is gone: the backend asks none of the others, so they would only ever read "never run". The frontend runners (`src/lib/checks/runners.ts`) are deleted; the backend runs the checks.

Kept in the project's settings store, because the backend has no table for them:
- `CHECK_OFF:<checkId>` → `{"by": name, "at": ISO date}`: who switched a check off and when (written by `retireCheckAction`, cleared by `restoreCheckAction`).
- The scope statement and integrity target are read through `scopeConfig()` (`src/lib/api/admin.ts`): the organization's `SCOPE` setting, with the project's `PROJECT_INFO.scopeStatement` winning.

1. **Who switched a check off, and when.** The checks page says "Switched off by X, date — reason"; the statement says "decided by X, date". `CheckView` has only `offBecause`. Today read from the `CHECK_OFF:` setting when this application switched it off, "—" otherwise.
   Want: `GET /checks` → `CheckView.offBy: string | null`, `offAt: DateTimeOffset | null` (from `CheckOptOut.ByName` / `At`).

2. **The project's scope statement and integrity target.** The figure ("target 95%") and the statement (organization, scope, in force since) read a scope record; the backend has none. Today from the `SCOPE` / `PROJECT_INFO` settings, else nothing ("—", target 95%).
   Want: `GET /api/projects/{id}/scope` → `{ organizationName, scopeStatement, effectiveDate, integrityThreshold, measurementIntervalDays }` and `PUT` of the same (Document Control / administrator).

3. **Review date on an accepted defect.** The accept form asks "Look at it again on" (CF-13); `POST /defects/{id}/accept` takes only `reason`. The date is not kept and no longer required.
   Want: `ReasonRequest.ReviewDate: DateOnly?` on accept, returned as `DefectView.reviewDate`.

4. **Re-checking one defect.** "I fixed it — check again" used to re-ask that one check. There is no single-check run; the action runs every check (`POST /checks/run`, then polls `GET /checks/runs/{id}` for up to 25 s) and then looks whether the defect is still open. A run already queued answers 409 and the action shows that refusal.
   Want: `POST /checks/{checkId}/run` (or `POST /defects/{id}/recheck`) answering the defect's new status; and `GET /checks` returning the queued/running run (`currentRun`) so the page can say a run is under way.

5. **Exceptions granted against the rules.** The statement lists exceptions (item, reason, authority, from, review point). The backend has no exceptions register. Today none are listed.
   Want: `GET /api/projects/{id}/exceptions` → `[{ id, item, reason, authority, startDate, reviewPoint }]`.

6. **Who still holds a replaced revision without being told (out-of-date risk 1).** `/exposures` and the figure's "out-of-date risks" count list, per superseded revision, the recipients of the transmittals that carried it who were not sent the current one since. No endpoint answers it project-wide (it would take every transmittal and every document read one by one). Today none are listed.
   Want: `GET /api/projects/{id}/exposures/untold` → `[{ document: { id, number, title }, old: { id, value, supersededAt }, current: { id, value, statusCode } | null, recipients: [{ key, name, organization, userId, via: transmittalNumber }], reason, draft: { id, number } | null }]`.

7. **Void revisions and their reassessment (out-of-date risk 4).** The "Unresolved void" list shows void revisions nobody has reassessed, with a "Record reassessment" form. The backend keeps no reassessment (and the register has no void-revision filter). Today none are listed.
   Want: `GET /api/projects/{id}/exposures/void` → `[{ revisionId, documentId, number, value, voidReason, voidedAt }]` (void and not reassessed) and `POST /revisions/{id}/reassessment { note }`.

8. **Blocked work (out-of-date risk 2) is read from the register.** Released revisions whose newest binding verdict does not let work proceed are found with `GET /register?released=true&verdict=<code>&per=250`, one call per halting verdict (`REVIEW_OUTCOMES` with `proceed: false`), keeping rows whose current revision is the newest. Beyond 250 per verdict rows are missed.
   Want: `GET /api/projects/{id}/exposures/blocked` → `[{ documentId, number, revisionId, value, verdict, decidedBy, decidedAt }]`.

9. **Orphaned withdrawal (out-of-date risk 3) is read from the register.** Withdrawn documents still needed by a schedule activity come from `GET /register?view=all&state=WITHDRAWN&per=250` and each row's `activities`. Beyond 250 rows are missed. Want: the same as a list endpoint, or `state` + `hasActivities` filters with no page limit.

10. **The register as it stood on a past date.** `/reports` has "What was current on a date" (§16.4 Q8). Nothing answers it. Today the table is always empty.
    Want: `GET /api/projects/{id}/register/as-of?date=YYYY-MM-DD` → `[{ documentId, number, title, state, revisionId, value, statusCode, releasedAt }]` (released by then, not superseded or voided by then).

11. **Notifications.** `/notifications` lists the person's notifications and marks them read. The backend sends none. Today the page shows "Nothing yet".
    Want: `GET /api/me/notifications?take=60` → `[{ id, title, body, link, read, createdAt }]` and `POST /api/me/notifications/read`.

12. **Assets and tags.** `/assets` and `/assets/[id]` list equipment, systems and areas and the documents linked to each; the actions (add, change, remove, link) are in `src/lib/actions/admin.ts`. The backend has no assets. Today the list is empty and an asset page is not found.
    Want: `GET|POST /api/projects/{id}/assets` (`{ id, code, name, area, system, unit, description }`), `PUT|DELETE /assets/{id}`, `GET /assets/{id}` with its documents (`[{ id, number, title, docType, discipline, state, current: { value, statusCode } }]`), and `POST|DELETE /documents/{id}/assets/{assetId}`.

13. **Distribution matrix: holders per function on this project.** The matrix heads each function column with how many people hold it on this project. `AdminFunction.holders` counts across projects; the page counts memberships from `GET /api/admin/users` instead (Document Control and administrators only; anybody else sees 0). Want: `GET /api/projects/{id}/holders` without `verb` returning every holder with `functionId`, or `AdminFunction.holdersByProject`.

14. **Distribution matrix import: rows cut by document family.** A filled-in matrix may carry a family column; backend rules (`RuleRequest`) have no family. Such lines are refused ("a row cut by document family is not supported yet"). Want: `RuleRequest.Family: string?`. Rules are also written back as the function's whole list (`PUT /api/admin/functions/{id} { rules }`), so the rule note ("Read from a filled-in distribution matrix") is not kept: want `RuleRequest.Note`.

