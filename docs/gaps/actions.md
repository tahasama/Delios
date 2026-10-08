# Schedule & actions: what the screens need that the backend lacks

Screens: `/actions` (plan and table), `/actions/[code]` (an activity and what it needs), `/actions/requirements`, `/actions/schedules`, `/actions/schedules/[id]`, the plan's upload cards. Actions: `src/lib/actions/requirements.ts`, `src/lib/actions/action-notes.ts`. Shared adapter: `src/lib/api/schedule.ts`.

How the screens map today: an activity is an action (its start is the action's date), a need is an entry on the action's list, a decision is a note (CARRIED / STOPPED), a read of the schedule document is a schedule version. A need counts as delivered when the backend says it is MET; a WAIVED need still counts as a missing document on these screens (they have no place for a waiver).

1. **Needs inline in the activity list.** `/actions` filters, counts and pages on facts the list does not carry: the documents each activity needs, their discipline, type and originator, when the last one arrived, and what was decided. `GET /activities` gives counts only, so the page reads `GET /activities/{id}` for every activity and `GET /documents/{id}` for every document they name (N+1 reads; batched 8 at a time).
   Want: `GET /activities?expand=needs` (or a separate `GET /needs`) returning per activity `needs[]` (as `NeedView`) plus `decisions[]` (or at least `decisionCodes: string[]`), and on `NeedView`: `documentDiscipline`, `documentType`, `originator`, `isPlaceholder`. Better still, server-side filters `discipline` (activity or document), `docType`, `originator`, `q` over document numbers and titles, `happened` (WITHOUT/CARRIED/NONE/STOPPED), sort and paging with a total.

2. **When the last document arrived (`lastMetAt`).** "Done" vs "Late receipt" and "happened short on the day" need the day the last need was met. Today it is worked out from `NeedView.metAt` of every need.
   Want: `ActivitySummary.lastMetAt` (max `metAt` once every need is met).

3. **Schedule reads: dates and change dates come out unreadable.** `GET /schedule` returns the stored `ScheduleImport` entities: `importedAt` serializes as `{}` and `changes[].oldStart/newStart/oldFinish/newFinish` as NodaTime objects (`{year, month, day, calendar…}`); `source.columns.dateOrder` came back `null`. The screens use the released date of the schedule revision as the version's date and parse the date objects.
   Want: `GET /schedule` → `imports[]` with `importedAt` (ISO instant), `importedByName` (or "system"), `documentId`/`documentNumber` of the schedule read, and ISO days in `changes[]`; `changes[]` also carrying `oldResponsible/newResponsible` (the comparison table has a "Responsible party" column, shown "—" today).

4. **The schedule document from the schedule-version page.** `/actions/schedules/[id]` offers "Change linked revision" through `ControlledSource` (controlled sources of the old app). The backend names the schedule with `PUT /schedule { documentId }`; no screen in this area sends it (the component's action is not in this area). The option list is empty, so the link control is hidden.
   Want: nothing new in the backend — a screen action that calls `PUT /schedule` (and `POST /schedule/import`).

5. **Departments confirming their documents are available (step 4 of requirements; the "Confirm" form on the activity page).** No record for it. `confirmReadinessAction` answers "Confirming readiness is not supported yet."; every activity shows "Not confirmed" / "0 of N".
   Want: `POST /activities/{id}/confirmations { department, available: bool, note }` (department member or Document Control; note required when not available, or when available while needs are missing), returned on `GET /activities/{id}` as `confirmations[] { department, available, note, confirmedByName, confirmedAt }`; when not available, Document Control notified.

6. **Calls to departments (step 2 of requirements).** Asking a department for its documents, with an answer-by date, reminders and "nothing needed" answers. No record for it. `issueCallsAction`, `remindCallAction`, `closeCallAction` answer "Calls to departments are not supported yet."; every department shows "Not asked yet".
   Want: `GET /requirement-calls`, `POST /requirement-calls { departments[], dueAt }` (covers the department's activities no earlier call covered; notifies its members), `POST /requirement-calls/{id}/remind`, `POST /requirement-calls/{id}/answer { note }`; view `{ id, department, activityCodes[], dueAt, issuedAt, issuedByName, reminders, lastRemindedAt, answeredAt, answerNote }`.

7. **Issuing the requirements to senders (step 3).** Recording that a sender (a supplier, or our own department) was given its list, and warning when the list changed since. `issueToSendersAction` answers "Issuing the requirements to senders is not supported yet."; every sender shows "not issued".
   Want: `GET /sender-issues`, `POST /sender-issues { senders[] }` → `{ sender, issuedAt, issuedByName, needCount }` (and notification of the sender's people / opening the supplier's SUPPLY package); needs carrying `createdAt`/`updatedAt` so "N changed since" can be counted.

8. **Automatic first warning when an activity turns at risk.** The old app told the departments concerned once, by notification, and stamped `riskNotifiedAt` on the activity ("Everyone concerned was warned automatically on …"). No notification endpoint, no stamp. `warnOnceAtRisk` does nothing.
   Want: the backend sending it when `Readiness` first labels an activity AT_RISK (or overdue), and `ActivitySummary.riskNotifiedAt`.

9. **"Notify" the departments from an activity.** `notifyDepartmentsAction` answers "Notifying departments is not supported yet." (The activity page's "Notify" link goes to a new transmittal, which works.)
   Want: `POST /activities/{id}/notify` → notifications to the members of the activity's departments, naming what each still owes.

10. **Fields a need does not carry.** The activity's table shows "From" (who submits it: a supplier, or "Us"), "Approved by" (the function that approves it) and the requirement's creation date (Progress: "Documents listed"); the activity has no description and no creation date ("Disciplines tagged"). Shown "Us", "—" and "not yet" today.
    Want: `NeedView.submittedBy` (party code or null), `NeedView.approvedBy` (function code), `NeedView.createdAt`; `ActivitySummary.description`, `ActivitySummary.createdAt` (or first read).

11. **Requirements and department lists as controlled uploads.** The plan's cards and the requirements page link to uploading "disciplines per action" and "action requirements" lists (controlled sets with approval). The backend reads departments from the schedule file and takes needs one at a time (`POST /activities/{id}/needs`); there is no list upload and no approval. The cards say "Upload"; step 1 shows nothing pending.
    Want: `POST /activities/needs/import` (a sheet in the requirements template: Department, Action Code, Document, Date of delivery, Required Status, Approved By…) with a dry run, and optionally `PUT /activities/{id}/departments` for a single correction.

12. **Who is in a department.** "A department is a discipline": members are found from `GET /holders?verb=READ` by `department`. Works, but the supplier side needs the party: `Holder` has no `partyCode`, so a supplier sender's people are read from `GET /api/admin/users` (administrators only; empty for anyone else, so "nobody to notify" shows for others).
    Want: `Holder.partyCode` (or `GET /holders?party=ACME`).

13. **Not used by any screen in this area.** `POST /activities/{id}/needs`, `DELETE …/needs/{needId}`, `POST|DELETE …/needs/{needId}/waive` have no control on these screens (the old app added needs through the requirements upload, item 11), and waivers have nowhere to show (item 5 is the closest). Nothing missing in the backend; noted so the screens can grow into them.
