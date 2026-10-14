# What behaves differently now that the screens run on the backend

Your screens are unchanged. What changed is where the data lives: every screen
now reads and writes through the backend instead of the old in-app database.
Most things work exactly as before. This page lists every place where the
result is **not** the same as in the old app, so nothing surprises you.

Each item says: what you did before, what happens now, and why.

---

## 1. Suppliers

**A supplier's "Attach" sends the file at once.**
- Before: a supplier attached a file to a placeholder, and sent it later with "Send".
- Now: attaching it sends it straight away, on its own incoming transmittal ("Sent on TR-…").
  Document Control sees it to check at once.
- Why: the backend keeps nothing a supplier has not sent. A file is only ever in the
  register because it arrived on a transmittal, and that transmittal is the receipt.
- What you'll notice: one transmittal per attached file, instead of one transmittal for
  several files attached over a few days. If a supplier wants several documents on one
  transmittal, they use their transmittal form ("Send to us"), not "Attach".

**The status a supplier sends for is worked out from the package's reason.**
- Before: not asked on the supplier package form either.
- Now: "For approval" sends at the status labelled "Issued for approval"; anything else sends
  at the first status that does not allow construction. The backend needs a status on every
  planned item, so this choice is made for them.

**What came back "turned back" shows as sent.**
- Before: a supplier saw their transmittal as "turned back".
- Now: Document Control returns the *revision* for a correction instead. The supplier sees the
  revision as returned, with the reason, and sends the corrected file under the same revision.

---

## 2. Checks and conformance

**The checks page lists the backend's 35 checks, not the old ~100.**
- The backend runs 35 checks. The other ~65 old checks were never run by anything any more,
  so they would have shown "never run" for ever. They are gone from the list.
- Running a check again for one defect ("I fixed it — check again") runs **all** checks, then
  looks whether that defect is still open. It takes a little longer.
- "Look at it again on" (a review date when accepting a defect) is no longer stored.

---

## 3. Reviews

**The reviews list shows one row per review, not one row per step.**
- Before: each step of a route was its own "cycle", so a two-step route was two rows.
- Now: one review = one row, standing at the step it is on (the open one, or the deciding
  one once answered). The review page shows the whole route in "Progress".

**Who sits on a step is set by the route.**
- A route's step names a function, people of ours, or both. Everybody holding the function on the
  project, and everybody named who is on the project, is seated.
- Someone named on a route but not on the project is skipped. If nobody is left, the review is refused
  with a message saying which step has nobody.
- On the deciding step, at least one person named must hold a function that may approve the document.
- The route proposes who answers each step; the sender may change the people on each step for that
  review, and the record says so (see CLAUDE.md, Reviews).

**A route's own verdict list.**
- A route can decide from its own list instead of the review outcomes (the "outcome set" on the routes
  screen). The list must be published and have at least one verdict that lets a revision proceed.
- Reviews keep the list their route had when they started; changing the route later does not change them.

**Delegation (handing a step to somebody else).**
- Works as before: until a date, with a reason, flagged when the matrix would not have made it,
  and waiting for Document Control when they carry this act out.
- Difference: you hand a step to **one** person at a time (as your form already does).
- The delegate answers and comments **in the holder's place**: the record says
  "Aisha Approver for Eli Engineer", and the step shows the holder answered, by the delegate.

**Writing, changing or taking back a comment before the step is answ**Comments go with the answer.**
- Comments are written with the verdict or advice, under that choice, and are obligatory only when the
  choice carries comments. There is no separate comment box (this replaced the earlier Comments card).

elease" works. Behind the scenes it creates a review with **no steps**, already
  decided at the status you chose; Document Control releases it like any decided review (or it is
  released at once where nobody holds Document Control).
- It does not appear in the reviews list. It does use a review number (RV-…) from the same series,
  so you may see a gap in the review numbers in the list.

**An outside party approving before use ("Somebody outside has to approve it first").**
- Their approval runs as its own **one-step review** ("Approval by Northwater Utility"), answered
  the same way as any outside party's step (in the app, or recorded for them by one of ours with
  proof). It **does appear in the reviews list**.
- While it waits: a revision not yet released cannot be released; a revision already released is
  **put on hold** ("not for use") and everybody who received it is told.
- Approved: Document Control lifts the hold (or releases), and what was asked for is sent.
  Where nobody holds Document Control, that happens at once.
- Not approved: Document Control sends it back with a reason. A held revision then stays on hold
  **for good**; the next revision replaces it.
- The worker makes a copy of the PDF people were reading marked "ON HOLD" across every page, with the
  reason. The copy stays on record after the hold is lifted.

**Late-review warning.**
- The people on a step who have not answered are warned **once**, the working day before it falls due
  (the project's working days and time zone). If the warning could not go the day before, it goes on
  the day itself. It is a notification, and an email when review email is on.
- The reviews list shows "warned <date>". Sending a step back and opening it again clears it, so it is
  warned again.
- It runs in the worker every 30 minutes. A step with no due date is never warned.

---

## 4. Revisions and documents

**Voiding a revision.**
- Only the **newest** revision, and only if it was released in error or never reviewed.
- Released ones: voided by whoever decided it, or Document Control (or its author where the people
  doing the work carry this act out). Never-reviewed ones: by the author or Document Control.
- Whoever received it is told to stop using it, and what was asked to be sent for it lapses.
- The worker makes a copy of the PDF people were reading marked "VOID" across every page, with the reason.

**"As it was" (the document's history page) starts from today.**
- Each change to a document now records a snapshot of it. Documents changed before this update
  have **no earlier snapshots**: their history page starts at their next change.
- A snapshot is taken once per request that changes the document. A request that changes nothing
  visible (a download, for example) records nothing.

**Readers of a closed document.** Works as before (the person who registered it, an author of a
revision, or an administrator names them). Taking a reader off works from the panel.

**Legal hold.** Recorded, with a reason, by Document Control or an administrator. Disposal is refused
anyway (only the app owner removes anything), so legal hold is a flag on the record.

**Your own fields, previous number, legacy scheme, application.** Now kept with the document when
registering and editing. Documents registered before this update have none.

**Sending for review — "leave it to the author" (who receives it once released).**
- Works: the author is told to say who receives it; nothing is sent until they do.

**Asset tags.**
- An asset that is no longer used is **retired** (kept on record, offered no more), not deleted.
- A package can be filled "by asset tag": the documents linked to the chosen tags (and matching its other
  rules) join it.
- A requirements list that names an unknown tag creates it (named by its tag) and links the document.

---

**Records: confirmed and corrected.**
- A record is **confirmed** once (by whoever may create or control it): it is then fixed as evidence and
  never revised. Confirming it twice is refused.
- A mistake in a record is **corrected by a further record** that names the one it corrects. Both are
  kept; the original is never altered.

**Withdrawing an approval.**
- Only Document Control, with a reason. Only on the newest revision: if a later revision is already in
  review or released, you are told to withdraw that one instead.
- The review is kept as it was, marked "approval withdrawn" with who, when and why. The document shows
  as withdrawn until a replacement is released. Its author is told.

**Reclassifying a comment** (whether it stops the release).
- Document Control or the revision's author, with an optional note, while the comment is open.
- What it was before is kept and shown ("originally not blocking").

**Numbers from a range issued to a party.**
- When a document is registered, an open range issued for the same start of number (for example
  `P1001-10-CI-DWG`) is used first, lowest range first. When its last number is taken it is marked
  "exhausted", and numbering goes back to the project counter.
- A number already on a document is skipped, so a range and the counter never give the same number twice.
- There is still no "give me a number without registering": a number is given only when a document is
  registered. No screen asks for one on its own.

## 4b. Packages

- **Several reasons for issue** on one package. The first is its main reason; what is delivered goes out
  for all of them (the transmittal says "also for …").
- **Your own fields** are kept with the package.
- **Deleting** asks for a reason, which goes on the audit trail. Only an empty package that never went
  out can be deleted; any other is kept.
- Our own organization can be a recipient of a package.

**Correspondence.**
- A deliverable type **Correspondence (COR)**, numbered like Engineering, with document types that go to release
  without a review:
  - minutes (MOM);
  - letters (LET);
  - site and progress reports (SRP);
  - photos and survey records (PHO);
  - test certificates and inspection records (TCR);
  - delivery notes (DLN);
  - permits (PMT);
  - vendor catalogues and manuals (VCM);
  - requests for information (RFI).
- New organizations get them; your demo gets them the next time its setup runs.
- An organization renames, retires or adds types in its lists. Whether a type is reviewed is the existing
  "Reviewed before release" choice on Document types.

**Releasing a revision that was never sent for review** ("Release as [status]" on the document): for a type that
is not reviewed, it is sent on and released at the status chosen. A reviewed type is refused: send it for review
first.

## 5. Transmittals

**Drafts are kept apart until issued.**
- A draft has **no number** ("Draft") and nobody it names can see it. It appears in the log only
  under the "Draft" filter, for whoever wrote it and Document Control.
- Issuing it checks everything again on the day (released, not on hold, people still on the project)
  and gives it its number then. A draft for our own people and two organizations becomes three
  numbered transmittals, as a direct send would.

**Copies (CC).**
- People copied in are told, but **never asked to acknowledge**, and do not count in "seen".
- They are put on every transmittal the send produces (one per organization, plus ours).
- Only people can be copied in, not organizations.

**Dates.**
- The date of issue, the day something arrived and the day it went by hand can be an **earlier day**,
  never a later one. An earlier day is recorded at midday in the project's time zone.

**Something received.**
- "For" (who of ours it is for) is recorded; those people are **told it came, as copies** — they are
  not asked to acknowledge it. Checking it stays Document Control's job.
- A note on how it arrived is kept and shown as "They wrote:".
- A message with no files can be recorded as received.

**Telling people again.** Only those it is for who have not acknowledged it are told again.

**Opened.** Each opening is now counted. Transmittals opened before this update show "opened once".

**Files kept with it later.** Document Control can keep more files with something received after it was
recorded (the covering email, a letter). What arrived is not changed: the files are kept beside it,
shown as "kept by <name>, <date>", and the audit trail says they were added later.

**The check on arrival is kept for good.** Accepting or returning what arrived is now kept on that
submission itself, apart from the outcome a later release or return records. Before, a release wrote over
it, so the transmittal said "accepted by" whoever released the revision. The transmittal list and the
transmittal page read the check the same way now (`Arrivals`). Checks made before this update are read as
before.

**The transmittal page is worked out in one place** (the backend, `GET /transmittals/{id}/page`). What you
may notice:
- "How it went" offers the organization's own system, and the proof is asked for, as set on that
  organization in Settings ("their system", "proof required"). Before, both settings were ignored here.
- A review that was withdrawn no longer counts as open beside the document it carried.
- "Sent before" counts transmittals, not lines, and never a draft.
- The condition-by-condition acceptance check was removed from the page: nothing ever recorded one, so
  it never showed.

**Transmittals you may not open.** A document's "Sent out" tab lists every transmittal that carried it, but
links only those you may open; the others are listed without a link (before, the link led to "not found").

**A supplier's "New transmittal"** opens again (it failed for people of another organization).

**People & access for management.** Management (Manage) reaches People & access only on a project where
management adds people (Settings → Who does what, people added without Document Control). There it can now read
the functions and organizations the page chooses from. Where Document Control adds people, the page is not
offered to management.

**Returning what arrived when no "return" outcome is published.** It is returned all the same: back to
the sender, to correct under the same revision, with your reason.

---

**Who still holds a replaced revision without knowing (Exposures).**
- When a revision is released, everybody with an account who received an earlier revision on a
  transmittal is **told in the app** to stop using it. That counts as told.
- An organization with nobody here counts as told only once it is sent the current revision (or a later
  one) on a transmittal. Until then it is listed on Exposures, with "Send rev … to them".
- Releases made before this update told nobody; people with an account are counted as told anyway.
- The "… is ready — issue it" link is never shown: drafts are kept apart until issued (see above).

## 6. Schedule and document requirements

**A waived need still shows as missing on the schedule screens.** The screens have no place for a
waiver; the backend counts it as covered for readiness.

**The schedule itself is not uploaded as a "list for a decision".** It is read from the **schedule
document**: attach the export to a new revision of it and send that for review. Releasing it is the
approval, and moves every activity date. The "Project schedule" controlled-change page says so.

**The requirements list can be a controlled document.**
- The starter setup includes the document type **RQL — Document requirements list**, already marked. Any other
  type can be marked too, on Document types: "Is a document requirements list — read when released".
- A document of that type is registered and reviewed like any other: the printed PDF is what reviewers read.
- When a revision is released, the spreadsheet (.xlsx or .csv) attached to it is read automatically. It uses the
  same columns as the requirements template.
- Each row becomes what an activity needs. A document the register doesn't have is registered as a placeholder.
  For every activity and department the list mentions, what it no longer lists is no longer needed.
- **All or nothing:** if any line is wrong (an unknown activity, a department the activity doesn't have, a
  missing type for a new document…), nothing is applied. Document Control is told which lines and why, and fixes
  the list in a new revision or uploads it by hand.
- Every read, applied or not, appears in the history of uploaded lists ("rev B", from the released revision).
- Uploading the list for a decision, below, still works as the manual way.

**Needed documents show where they stand.** On an activity, each needed document shows its newest revision and
state in your organization's own words, for example "placeholder · not started", "rev A · in review" or
"rev B · IFC · released & issued". It is listed whatever its state. It counts as ready only when released at the
required status.

**Departments per activity and the requirements list are uploaded for a decision**, as before
(draft → submit → approve, or rejected with a reason). Approving applies them. Differences:
- The project code of a new placeholder is the project's own; the "Project Code" column is ignored.
- "Approved By" and "Supplier" on a requirement are checked but **not stored** on the need.
- What a need is for is recorded as the "EXECUTION" reason for issue (or your first published reason).
- A supplier's new placeholder is registered as supplier data (the deliverable type that asks for an
  originator), ours as engineering.

**Calls to departments, readiness, issuing to senders** work as before. A shortage needs a note, and
Document Control is alerted. Issuing the list to a supplier **tells its people** but does not open a
supply package for them.

**Uploaded lists for a decision** are never deleted: a discarded draft is kept, marked rejected.

---

## 6b. Administration

**An administrator opening a project they are not on** joins it, holding the organization's
administrator function (the first function that may configure), as the old app did. It is on the audit
trail ("PROJECT_JOINED"). Somebody who was taken off a project is not put back this way.

**Project type** is now kept on the project itself, so the project switcher shows it. Projects created
before this update get the type they were given (read from their saved details).

**A distribution matrix row for a document family** (when the matrix is cut by family) is saved as one
rule per document type in that family, each marked with the family. The matrix reads it back as one family
row. If a type is added to the family later, re-import the row to cover it. Rules read from a file say so
("Read from a filled-in distribution matrix").

**Function clearance.**
- On Functions & permissions, a function can be given a clearance: "up to Internal", for example. No clearance
  means no limit, which is how every existing function stays.
- A document above a function's clearance is read only by:
  - people named on it as readers;
  - whoever registered it;
  - whoever it was sent to.
- This applies to every function, Document Control included. Before you limit Document Control, make sure
  that is what you want.
- Clearance also changes who is proposed and seated:
  - People whose clearance does not reach a document are not proposed when sending it.
  - They are not seated on its review steps. If nobody is left on a step, the review is refused with a message
    saying so.
- The order of the levels is the confidentiality list's own order, or its `level` property where one is set.

**Requests, confirmations and answers are transmittals.** What used to be a notification is now a transmittal (words
alone), replying in one thread, each told by the transmittal itself (notification and email):
- a request checked by Document Control asks its confirmer (Request); confirming or refusing answers whoever asked,
  Document Control copied in;
- "Nothing to add", or a request applied, answers whoever asked;
- a postponement asks whoever plans to confirm it (Request), the people the action concerns copied in; confirming
  it or taking it back replies in the same thread;
- a person added to a project asks management to confirm (Request); the confirmation or refusal answers whoever
  added them.
Answering one counts as acknowledging it. When nobody is there to send it to, the notice is sent as before.

**A discipline that does not answer is escalated.** When an action's day has passed with a discipline's documents
missing and nobody of that discipline confirmed, everyone of that discipline, management (Manage) and Document
Control are notified once, 3 working days after the day. The number is changed in Settings → How this project works.
The action is not marked; the notice is in the notice log.

**Sessions end after 7 days.** A session still renews while in use, but never beyond 7 days from signing in;
then the person signs in again.

**Refused requests are recorded.** When someone signed in is refused (403), the audit trail records
`ACCESS_REFUSED` with what was asked and why, once an hour per person and address.

**New passwords are stronger.** At least 8 characters, and never one published in a data breach. Passwords
already set keep working. The team import's first passwords are random.

**Sign-up confirms the email** while email is on: the first administrator signs in after opening the emailed link;
the sign-in page offers to send it again.

**A sign-in from a new browser is emailed** to the person, with what to do if it was not them.

**The bot check** (Cloudflare Turnstile) appears on sign-in, sign-up, forgot password and "send the link again" once
the installation sets its keys.

**Forgot password.**
- "Forgot your password?" on the sign-in page asks for the email and sends a link to choose a new password.
- The link works once, within 30 minutes, and stops working as soon as the password changes any other way.
- The page answers the same whether or not the account exists, so nobody can use it to find out who has one.
- Choosing the new password unlocks the account and signs it out everywhere. Two-step sign-in still applies.
- The email goes whenever email is on (it does not follow the per-kind switches). With email off it is kept in
  the outbox, so on a developer's machine the link can be read there.
- An organization that signs in through its own provider gets no link, except for its administrators.

**Sign-in & security (Settings, administrators).**
- Whether two-step sign-in is asked of everyone, and how many people have it on.
- The people who have it on, each with "Turn it off" for someone who lost their phone and recovery codes.

**Your sign-in (the menu under your name).**
- Turn your own two-step sign-in on (key, then a code, then the recovery codes once), or off with a code.
  Where the organization requires it, it stays on.
- The password is changed through "Forgot your password?", so only whoever reads your email can change it.

**Two-step sign-in.**
- After the password, the sign-in page asks for the code from the authenticator app; a recovery code also works.
- Where the organization requires two-step sign-in and the person has not set it up, the page shows the key to
  add to their app. After the first code it shows the recovery codes, **once**.

**Opening files.**
- Only PDFs and plain images open in the browser.
- Anything else downloads, and is never shown inside the app's own address, so an uploaded web page or script
  cannot run.

## 6c. Organizations working together

- **Signing up** asks only for the organization and its administrator. Projects are opened afterwards.
- **Collaborator, guest, not on DELIOS** now behave differently (before, collaborator and guest were the same
  thing under two names). A collaborator is an organization linked to its own DELIOS: on Settings →
  Organizations, "Invite them to link" with the email of someone there. Guest or not on DELIOS is still chosen
  by hand. Organizations marked collaborator before this update, with no link, now read as guests.
- **Which organizations take part in a project**, their role and the function their people start with: on
  Settings → Organizations, "On <project>".
- **The organization's page** (account menu → the organization's name; also from the setup page): projects ours
  and joined, people, organizations we work with, invitations, defaults for new projects.
- **Working on another organization's project:** the project picker lists, under that organization's name, the
  projects you were put on; choosing one switches you there with your own sign-in, and "Back to …" returns.
  Someone with no project of their own sees them on their first page.
- **Roles on a project:** four more, Main contractor (builds only) `CONTRACTOR`, Subcontractor `SUBCONTRACTOR`,
  Supplier / manufacturer / vendor `SUPPLIER`, Third-party inspector / certifier `INSPECTOR`, each with its own
  starting matrix.
- **Defaults for new projects** are seen and changed directly on the organization's page ("See and change them"):
  the same questions as a project's Control room, each marked "the app's" or "ours", the app's own listed, and
  "Reset to the app's defaults". Taking one project's choices as the defaults is still there.
- **A project's Control room** marks each answer "as the defaults", "the app's" or "changed here", and has
  "Reset to the organization's defaults" (or to the app's, when the organization set none). What the project
  is, and checks ticked off on it, are not touched.
- **The organization's page is clickable:** a project opens (ours, or switches into another organization's), a
  person goes to People & access, an organization to Organizations, "their people" to its people.
- **Supplier fixes:** a supplier's schedule ("Where your documents are needed") was always empty: it now shows the
  actions needing its documents. Its document page no longer fails. A review handing its document back
  (rejected, or released with comments) tells the supplier's people and is on their Home. The menu reads
  "Schedule & actions" for everyone.

- **Schedule & actions is the same page for everyone.** Another organization's people open it from the same
  menu entry and see the actions that need their documents (their own, and those shared with them), each
  with only those documents; not our disciplines, confirmations, notices or notes. The separate supplier page
  ("Where your documents are needed") is gone: its address opens Schedule & actions.
- **Creating a document from another organization** (deliverable types that require the originator, e.g.
  Supplier document) asks whose it is and its order. It no longer asks when it was received: that is filled
  when its first submission comes in. "Who may see it" starts at the lowest level. The new demo calls the
  type "Supplier document" (an existing organization renames it in Settings → Deliverable types).

- **Where a document got late (action page):** sending for review, or the supplier sending it in, is due on the
  documents' day (e.g. 13 Sep for works on 20 Sep); released & issued on the action's day. Before, the app guessed
  a route and counted its days back from the documents' day (giving e.g. 24 Aug).

- **Accepted with comments:** the author is told it is in force and that its comments go into the next revision
  (started without asking); it is on their Home as "next revision due".
- **Sending back after C3 (or any verdict asking for changes)** no longer asks why: the verdict and its comments go
  with it; "Anything to add" is optional.
- **Who is told of a decision, a release or a send-back:** everyone the review concerns: whoever started it, the
  author, everyone on the route, those copied in, Document Control, and for another organization's document,
  that organization's people.
- **Copy to (cc) on Send for review now works:** the people chosen were dropped before; they are kept on the
  review and told.
- **IFU "Issued for update"** is a status a review can grant (a setup gains it with `seed-demo`, after IFA; steps
  that may grant IFR may grant it too). Work does not go ahead on it: released at IFU, the document goes back to
  its author (or supplier) for the next revision. The transmittal reason IFU reads "Issued for update" too.
- **"Make it stop the release" (reclassifying a comment) is removed:** Document Control approves nothing; the
  decider's verdict decides. Comments reclassified before keep that record.
- **Replies by email (not on DELIOS):** an organization not on DELIOS can be given "Their email for
  transmittals" (Settings → Organizations). Our transmittals then go to it by email, files attached, and read as
  sent by email. Their reply to that email waits on the transmittal ("Replies by email") and on Document
  Control's Home: "Record it as received" makes it a received transmittal following ours (its files checked as
  usual), or "Set it aside" with why. Setup: docs/ACTIVATION.md, "Replies by email".
- **Fixed:** saving an organization not on DELIOS no longer asks to name one of its people.
- **Received date is no longer on a document's Edit:** it is filled when what was sent arrives (their submission,
  or what Document Control records from outside), and asked only when registering something that already arrived.
  An import of old documents still carries the date they had.
- **New document:** "Keep it for" is now "Retention period"; its hint says what it will be from the criticality.
  The criticality explains only itself (what an error means, who approves it). The details step fits on the page.
- **File fields** are a dashed line with a light button, not a button inside a grey box.
- **Status chips** are outlined, with only a light wash of their colour.
- **The reason IFU reads "For update"**; the status IFU still reads "Issued for update".
- **New transmittal:** "An answer is required" is a tick (ticked when the reason expects an answer); ticked, it
  asks the day (left empty, the reason's own number of days).
- **Action page:** a discipline whose documents are all ready is told so automatically, once. Notify is offered
  in every state and its message says where the discipline stands. Disciplines have their own "Add or take off"
  button, like documents. "Is a discipline missing, or one that should not be here?" offers asking to add one or
  to take one off.
- **Plain words:** "in force" is gone from the screens: "released", "the revision people work from", "now used".

## 7. Notifications and email

- Notifications are kept and shown in the bell and on the Notifications page; opening the page reads
  them all, as before.
- **Email is off by default.** Every email is still written down (the outbox) and marked "off". Turn
  sending on in `.env`: one switch for everything, then one each for transmittals, reviews and
  notifications.

---

## 8. Data added while testing

Testing on your local copy added a few records to the demo data: some test documents, packages,
transmittals, a schedule note, a delivered draft letter ("Draft letter (e2e)"), and activities A100
and A300 now carry the departments CI and ME (from a test of the departments list). None of this is
in the code; it lives only in your local database.
