# Reviews: what the screens need that the backend lacks

Screens: `/reviews` (list), `/reviews/[id]` (one review), `/reviews/send` (start a review).
A review cycle on the old screens is a backend review (same id); the review page shows the step the
review stands at (the open one, or once answered the deciding one) as "the cycle".

## Reviews list (`GET /api/projects/{id}/reviews`, ReviewList.cs)

1. **Purchase order filter.** The list's "PO" filter (`?po=`) is ignored: `ReviewFilter` has no `Po`.
   Want: `GET /reviews?po={contractRef}` (and on `/reviews/export`), matching `Document.ContractRef`, as the register's `Po`.
2. **Sort by document number.** `?sort=document` falls back to the opening date. `?sort=number` also maps to it
   (numbers follow opening order). Want: `Sort` values `document` (Document.Number) and `number` (Review.Number).
3. **Reviewers of every step.** `reviewers` lists only the open step's people, so a closed review shows nobody and
   "n of m answered" is 0 of 0. Want: on `ReviewRow`, `reviewers: { name, done, step }[]` for all steps (or `allReviewers`).
4. **Who a late review waits on.** The "Notify" link needs the waiting people's ids and the revision id; the row
   has names only, so the screen reads `GET /reviews/{id}` for each late row. Want on `ReviewRow`:
   `revisionId: Guid` and `reviewers[].userId: Guid`.
5. **Route length in working days.** The "Review due" column shows the route's working days; the screen counts
   weekdays from `startedAt` to `routeDueDate` (no holidays). Want on `ReviewRow`: `routeDays: int?` as the route gave it.
6. **Automatic late-review warning.** The old app warned the people on a step (and Document Control) once, the day
   before it fell due, and showed "warned {date}". The backend sends no such warning: `warnLateReviews` does nothing
   and `warnedAt` is always empty. Want: a backend job that warns once per step, and `ReviewRow.warnedAt: DateTimeOffset?`.
7. **Advice and client reviews.** Every backend review is a whole route ending in a decision, so every row reads
   "decision"; the "Advice" kind filter answers an empty list, and a review started after release ("client review")
   cannot be told apart. Want: `ReviewRow.afterRelease: bool` (review started after the revision's release) and a
   `kind` filter (`DECISION`/`CLIENT`) if the screen keeps it.
8. **Received from.** `receivedFrom` falls back to the originator only; the old row named who recorded the
   submission. Want: `ReviewRow.receivedBy: string?` (the first submission's `SubmittedBy`), and `receivedAt` for
   our own revisions (`Document.ReceivedDate`).
9. **Values in use.** The discipline and type filters offer only the values the project's documents hold; the screen
   reads them from `GET /register?per=25` (`lists.usedDisciplines`, `lists.usedDocTypes`). Want: the same two lists on
   the reviews page answer (or a light `GET /register/lists`).

## One review (`GET /reviews/{id}`)

10. **Who opened it.** `startedBy` is a name; the "send to reviewers" rule compared the opener's id. Want:
    `ReviewView.startedById: Guid`.
11. **Proof file names.** A proxied step's proof shows by name; the backend gives `evidenceFileId` only, so the
    screen reads the name from the download's `Content-Disposition` (downloading the file). Want on each step:
    `evidence: { id, name, kind } | null` (and the dispatch proof the same way).

## Delegation (hand a step to somebody else)

12. **Not in the backend at all.** `delegateReviewAction`, `grantDelegationAction`, `refuseDelegationAction` and
    `endDelegationAction` answer "Delegation is not supported yet."; nobody is offered as a candidate and no
    hand-over is listed. Want:
    - `GET /reviews/{id}/delegations` → `{ id, fromUserId, fromName, toUserId, toName, verb, status (OPEN|ACTIVE|REFUSED|WITHDRAWN), endDate, reason, refusedReason, askedBy, grantedBy, flag }[]`
    - `GET /reviews/{id}/delegation-candidates` → `{ id, name, functionName, inMatrix }[]` (matrix holders of the step's verb, then everybody else on the project unless the matrix binds; never the caller, never CONTROL/CONFIGURE holders)
    - `POST /reviews/{id}/delegations` body `{ toUserIds: Guid[], endDate: DateOnly, reason?: string }` (in force at once, or OPEN where Document Control carries out DELEGATE)
    - `POST /delegations/{id}/grant`, `POST /delegations/{id}/refuse` body `{ reason }`, `POST /delegations/{id}/end`
    - answering a step (`POST /reviews/{id}/answer`) accepting a delegate in force, recording "on behalf of".

## Start a review (`/reviews/send`)

13. **Revisions ready to send.** The page lists every revision being prepared with its file attached; the backend
    has no such list, so the screen reads the register (`rev=IN_PREPARATION`, up to 250) and then each document to
    see the files of its current submission. Want: `GET /revisions?state=IN_PREPARATION` →
    `{ id, documentId, documentNumber, title, value, statusCode, hasFile }[]`, newest first.
