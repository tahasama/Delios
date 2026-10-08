# Registering documents, import and exports: what the screens need that the backend lacks

Screens and handlers: `/documents/new` (create or receive a document), `/import` (bulk import and the export list),
`/api/export/{kind}`, `/api/register/export`, `/no-project`; actions `importBulkAction` (`src/lib/actions/bulk.ts`),
`saveRegisterView`/`deleteRegisterView`, `addDocumentReaderAction`/`removeDocumentReaderAction`,
`linkControlledSourceAction`; helpers `src/lib/register.ts`, `numbering.ts`, `numbering-records.ts`,
`matrix-sheet.ts`, `deliverable-workbook.ts`, `sets-workbook.ts`.

## Creating a document (`/documents/new`)

1. **Numbering and review routes for whoever creates.** The form marks the fields a producer's numbering scheme
   needs, and offers "Register & send" with the active review routes. Both are read from `GET /api/admin/numbering`
   and `GET /api/admin/routes`, which only administrators and Document Control may call; an engineer gets no
   required-field hints and no routes (the backend still checks every value on submit).
   Want: a project-level read for anyone holding CREATE: `GET /api/projects/{id}/numbering` →
   `{ routing: { deliverableType, fields: { label, source }[] }[] }` and `GET /api/projects/{id}/routes` (active routes:
   `{ id, name, isDefault, steps: { title, mode }[] }`), the latter like `GET /documents/{id}/routes` but without a document.
2. **A kept file made into a document.** `/documents/new?fromFile={fileId}` (from a received transmittal's kept
   file) shows that file's name and its transmittal. There is no way to read a file's metadata by id, so the page
   shows the ordinary "receive" form. Want: `GET /api/projects/{id}/files/{fileId}` → `{ id, name, size, transmittalId,
   transmittalNumber }`; and `POST /documents` accepting `fromFileId` so the kept file becomes the first revision's file
   and the transmittal lists the new document (today `createDocumentAction` ignores `fromFileId`).
3. **Back-dated registration, asset link and own fields.** `RegisterDocumentRequest` has no `assetCode`, `extras`
   (the organization's own fields) or `createdAt`. Want: `assetCode: string?`, `extras: { [name]: string }?` on
   `POST /documents` (and on `PUT /documents/{id}` changes). Assets are not in the backend at all.

## Bulk import (`/import`, `importBulkAction`)

4. **Deliverable list — asset code.** A correction row's `AssetCode` changes nothing (no assets in the backend).
   Want: as item 3.
5. **Deliverable list — whole register by number.** Corrections look documents up by number; the importer pages
   `GET /documents?limit=200&after=` through the whole register to build the number→id map. Want:
   `GET /documents/by-number?numbers=A,B,...` → `{ number, id }[]`, or `POST /documents/lookup { numbers: string[] }`.
6. **Actions baseline import.** The "baseline" kind (action code, document, required status, required by) cannot be
   written: activities only come from a schedule read (`POST /schedule/import`), and a need requires a purpose
   (a published reason for issue) that the file does not carry. The dry run still checks the rows; the import answers
   "Importing the actions baseline is not supported yet." Want: `POST /activities` `{ code, name, start, finish? }` and
   `POST /activities/{id}/needs` accepting `requiredStatuses` without `purpose` (or a project default purpose).
7. **People import for Document Control.** Works (`POST /api/admin/users`, `PUT /api/admin/projects/{id}/members`), but
   the backend takes no first-sign-in password change: the generated password stays until the person changes it.
   Want: `CreateUserRequest.mustChangePassword: bool`.
8. **Published lists — for Document Control, and their names.** `PUT /api/admin/values` and
   `GET /api/admin/value-sets` are administrator-only, which matches the screen; but a list's title, description and
   version live in the organization settings (`SET:{key}`), which the backend does not bump when values change. The
   workbook import does not bump the version. Want: `GET /api/values/sets` (key, title, description, version) readable
   by everyone, and the version kept by the backend.
9. **Distribution matrix import.** Goes through `src/lib/matrix-read.ts` (not in this area), which still reads the old
   database; it fails until that file is ported onto `GET/PUT /api/admin/functions`.

## Exports (`/api/export/{kind}`, `/api/register/export`)

Passed through from the backend: `documents` (`GET /register/export?view=all&sort=docNumber&dir=asc`),
`reviews` (`GET /reviews/export`), `transmittals` (`GET /transmittals/log/export`), `/api/register/export`
(`GET /register/export`, filters and `ids` passed on). Rebuilt here from backend reads: `packages`, `baseline`,
`review-matrix`, `defects`, `checks`, `audit`, `config-set`, `matrix`, `template-*`.

10. **Register export — the reader's columns.** The old export wrote only the columns the reader kept on screen
    (`cols=Title|Revision|…`) and more columns (previous identifier, legacy scheme, received date, authoring
    application, review route and its state, in schedule, in packages). The backend writes a fixed set. Want:
    `GET /register/export?cols=…` (column names as the register's column menu names them), and the extra columns.
11. **Register export — a large selection.** A selection of thousands of documents goes as `ids=` in the address
    (the screen POSTs it; the handler forwards it as a GET), which can exceed the backend's request-line limit.
    Want: `POST /register/export { ids: Guid[], format }`.
12. **Review/approval matrix (`review-matrix`).** Rebuilt from `GET /register` rows: the route's run and state,
    review cycle number and status, reviewers, blocking comments, approver role and matrix version are empty. Want:
    on `RegisterRow` (or a `GET /register/review-matrix` export) `routeName`, `reviewState`, `reviewNumber`,
    `reviewers: string[]`, `openBlocking: int`, `approverFunction`.
13. **Audit trail export for the project.** Uses `GET /api/admin/audit?projectId=`, administrator-only; Document
    Control and other internal people get 403 where the old export served them. The backend rows also have no
    `field`, `oldValue`, `newValue`. Want: `GET /api/projects/{id}/audit/export?format=csv` for internal readers (the
    last 5,000 events), with field, old and new values.
14. **Defects export.** `GET /defects` caps at 1,000 rows and has no review date. Want: `GET /defects/export`
    (all statuses, no cap) and `DefectView.reviewDate`.
15. **Packages and actions baseline exports.** Built by reading every package / every activity one by one (N+1
    calls). Want: `GET /packages/export` and `GET /activities/export` (with needs, decisions and lateness
    checkpoints), as CSV/XLSX like the register's.
16. **Value-set export and the sets workbook for non-administrators.** A list is found by its values
    (`GET /api/values`), but the workbook of every list (`template-sets`) enumerates lists through
    `GET /api/admin/value-sets`, administrator-only: Document Control gets a workbook with no tabs. Want: item 8.
17. **Distribution matrix sheet for everyone.** `buildSheet` reads the functions and their rules from
    `GET /api/admin/functions` (Document Control and administrators); anybody else gets a matrix with no columns
    (`/distribution`, `/api/export/matrix`). Want: `GET /api/projects/{id}/functions` → `{ id, code, name, rules }[]`
    readable by every internal member. Rules carry no `family`, so a matrix cut by document family shows the
    families the register holds but no rule ever narrows by family.

## Other

18. **Readers of a closed document.** Naming who may read a document above the open confidentiality levels is not in
    the backend; `addDocumentReaderAction`/`removeDocumentReaderAction` answer "Naming the readers of a closed
    document is not supported yet." Want: `GET/POST /documents/{id}/readers { userIds: Guid[], reason }`,
    `DELETE /documents/{id}/readers/{userId}`, allowed to the registrant, authors and uploaders, and administrators,
    with the reader notified; and visibility honouring the list.
19. **Controlled source link.** `linkControlledSourceAction` (a record's approved source → a document revision) has
    no backend relationship; it answers "Linking the controlled source is not supported yet." Want:
    `PUT /api/projects/{id}/control-sources/{sourceType}/{sourceId} { revisionId }`.
20. **No project yet (`/no-project`).** The page names the administrators and Document Control who can add the person;
    someone with no project cannot read `GET /api/admin/users`, so nobody is named. Want: `GET /api/me/admins` →
    `{ name, email }[]` (up to five active administrators / Document Control of the person's organization).
21. **Numbering on its own.** `allocateNumber` (used by `src/lib/controlled/requirements.ts` and the seed scripts) and
    `nextRecordNumber` cannot allocate a number apart from registering: the backend allocates as it registers or
    raises a record. Both now throw "not supported yet". Want, if still needed: `POST /numbering/next
    { deliverableType, fields }` → `{ number }` (reserving the number).
22. **Starting a revision from a script.** `startRevision` (seed scripts) posts `POST /documents/{id}/revisions` with
    `filesLater: true`; the revision's value, status code, phase and planned submission date are the backend's
    choice. Want: `statusCode`, `phase`, `plannedSubmissionDate` on `StartRevisionRequest` if the seeds need them.
