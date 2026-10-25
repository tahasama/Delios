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
- It goes with the project's day's notices, once a day at the project's notify hour (09:00 unless the Control room says
  otherwise, "The day's notices go out at"). A step with no due date is never warned.

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
approval, and moves every activity date.

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
Control are notified once, 3 working days after the day. The number is changed in the Control room, on "Disciplines confirm".
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
- **The reason IFU reads "For update"**; the status IFU still reads "Issued for update".
- **New transmittal:** "An answer is required" is a tick (ticked when the reason expects an answer); ticked, it
  asks the day (left empty, the reason's own number of days).
- **Action page:** a discipline whose documents are all ready is told so automatically, once. Notify is offered
  in every state and its message says where the discipline stands. Disciplines have their own "Add or take off"
  button, like documents. "Is a discipline missing, or one that should not be here?" offers asking to add one or
  to take one off.
- **Review page:** comments show once (with the answer, once a step has answered). "Withdraw from review" and
  "Notify" sit folded under the document; "Withdraw?" and "Notify?" in the title open them.
- **Start a review:** step tabs like the other forms, one step at a time; the documents list has a "tick all" box
  and column heads; Continue says "Tick at least one document" instead of reloading empty.
- **Plain words:** "in force" is gone from the screens: "released", "the revision people work from", "now used".
- **New supplier package:** no "Everything due by" (each document is due on its own planned date; the list shows
  the next one due) and no "Accepted by" (nobody accepts a supplier's package); the status is optional.
- **Delivery packages:** "Why they get it" is gone: the status it needs says it (the published reason with the same
  purpose — "Issued for review" → "For review" — else one for execution when work may go ahead on that status).
  Those putting it together only add and take out its documents (and may delete it while empty and never sent);
  Document Control (and above) edits every field while it is open, checks readiness, asks about what is missing and
  delivers. Documents are ticked in the list and taken out from the bar under it (the "Take documents out" step is
  gone, replaced by the bar). The ready count stands out.
- **What is missing from a delivery package** is asked on a transmittal (Request) to whoever accepts it. Their
  confirmation answers it on a transmittal (Confirmation) and delivers the package at once, on their responsibility,
  after a warning: the documents not ready go as they stand (released revision, else the newest; one with no
  revision cannot go), and the delivery transmittal says so with their name.
- **Packages "Export CSV"** exports the one package ticked in the list, never all of them.
- **Choosing documents** for a new transmittal, Start a review and packages is the register itself, opened for
  the form as for an action; "Continue" goes back to the form with the ticks. The short lists inside those forms
  (and the package's "Add documents" step with its own "Needed at") are gone: documents added to a delivery
  package need the package's statuses.
- **Answer required** on a new transmittal asks the day, always; the list and the transmittal say whether the
  answer is awaited, overdue, on time or late (until now only review-step transmittals were flagged).
- **Forms:** labels and hints keep to one line, so side-by-side fields stay level. New document, step 2: three
  columns (where it sits and who sees it · criticality and retention · PDF and native file).
- **Action page:** "Request a discipline" and "Request a document" are plain links; "Disciplines and documents"
  has an edit icon on the right of each line.
- **Review page:** "Withdraw?" and "Notify?" sit on the right under the review's chip; Notify opens straight
  on its form (no second button). Notice messages open at the height of their text.
- **Delivery package readiness** reads in the schedule's colours: all ready green, none red, between amber.
- **Side colours**: one colour per state (key on Help, listed by area); close states in close colours. Superseded is
  violet again; transmittals to check, sent, received, accepted and returned each have their own.
- **Recording what was received from outside:** "Received from" is picked from the organizations on the project; a
  data transmittal recorded so needs a document or a file (refused otherwise).
- **Supplier packages** count each document once: not sent yet, with the supplier, with us (to check / in review),
  released; "where it stands" says who has to act. "Received" reads "received, to check".
- **Assets & tags** is a table with search and filters; a tag's page lists its documents and links or unlinks them
  through the register, as for an action (until now, only from each document's Details).
- **Assurance:** checks the app makes impossible are gone (two revisions at once, two released, released with no
  status or with nobody's decision, no revision scheme, waived documents, criticality missing — it is optional);
  the others are reworded to what the app does, and "an action past its day" now reads the disciplines'
  confirmations. "Default rules" lists only what the backend really refuses, each with the answer it gets.
- **Settings bug fixed:** a status's "Allows work" and a reason's "Response period" were saved under names the
  backend never read; they are read now (old saved values too) and saved under the right names.
- **File fields** look the same everywhere (the new-document one).
- **New delivery package:** "Needed at" sits under "Due", beside a narrower description.
- **Action page:** "Request a document" moved from each discipline's buttons to the line under them, with its question,
  beside "Request a discipline".

- **Asset tags are numbered by themselves** (P1001-TAG-0001, Settings → Numbering, "Asset tags"); the New tag form
  no longer asks for one. Tags already made keep theirs; a tag the requirements list cites is still taken as written.
- **"An answer is required"** on a new transmittal is no longer ticked by itself when the reason usually asks one.
- **Every data transmittal carries a document**, sent as well as received (backend FILE_REQUIRED). Before, a data
  reason with a subject and a message alone went out; that is now an information transmittal.
- **Assurance findings link to the exact spot:** a setting finding opens its list with the value in edit; actions,
  packages and reviews open their own page. Before, they all sent to Settings.
- **Revisions can be named differently** (Settings → Revisions): new schemes, the default, and which deliverable type
  follows which. Before, only the seeded scheme existed and nothing could change it.
- **A list says it is verdicts** ("What it is", on the set). A list named otherwise (like "Supplier review outcome"
  under a key without OUTCOME, VERDICT or REVIEW) can now be used on a route. The review advice list is no longer
  offered as a route's verdict list (it never was one).
- **Package document lists** carry the side colour of each line's state; the "Next step" card no longer does.

- **Phase** is a document's detail now (it was shown but never kept): asked on create, in Details, and when a
  revision starts; the register filters by it. Revisions are named per phase (Settings → Revisions): one line per
  phase, plus one default line. New demos start with one default line, not two; an existing scheme's second line
  with no phase, never used, is dropped by `seed-demo`.
- **Verdict lists** have their own page (Settings → Verdict lists): a list is made with its verdicts and each one's
  meaning. "What it is" on a value list is gone.
- **Verdicts are kept in Types & sets** (Review outcomes): the Verdict lists page is gone (its address leads there);
  each verdict list became a set of Review outcomes, its verdicts in it. A review decides with the set serving its
  document's deliverable type unless its route names one; a mismatch is warned of. A verdict whose code Review
  outcomes already had stays in its old list, read only, for the reviews decided with it.
- **Checks** are numbered by the app (SET, DOC, REV, RVW, STO, SCH, PKG); findings keep their history.
- **New transmittal:** the kind is a dropdown, then its type; data with nothing attached offers to become
  information instead of only blocking.
- **Supplier packages** can be delivered ("Deliver": a delivery package with its documents).

- **Purchase orders follow their supplier** on the new-document form, and the backend refuses another supplier's.
- **Missing fields are outlined in red** when a form is sent, also when the backend names them.
- **Criticality** always has a recommendation; required in Forms & fields, it is required on the form.
- **Letters** need a message as well as a subject; "Ask placeholders of a supplier" shows on data transmittals only.

- **"Ask placeholders of a supplier" is gone from the new-transmittal form** (it repeated the package's "Send to
  <supplier>" and the register's "Create transmittal"). The supplier package now lists what is overdue above its
  documents, and ticks the overdue ones not sent yet in one click.

- **Import & export is checked first, always.** The "Dry run" tick is gone: a file is checked, then one button
  names what it writes ("Register 41 documents, leave out 3"), and asks first when rows are left out. Problems point
  at the sheet and row as seen in the file (they were counted wrong in a workbook), the check uses the backend's own
  rules (a row that passes registers), and the rows with problems, or the whole report, can be downloaded. After
  writing, a link opens the register at what was written.
- **Team list sends invitations instead of showing passwords.** Each person is emailed a link to choose their own
  password; with email off, the link is in the report (with Copy), and leaving the page asks first. People added
  this way wait under People to confirm where the project asks for it, as before.
- **The Import & export page** follows the Schedule look; a file chosen is shown with Remove and is let go when the
  kind changes; each kind says which files it takes; the matrix and the Settings lists show as an administrator's.
  Exports are grouped (the register, Assurance, the record). "Back to register" is gone (the menu does it).
- **Reports reworked.**
  - "Register on a date" works: a report of its own, which revision was current at the end of any day and what is
    current now. Before, it always answered "nothing was current", whatever the day.
  - Reports is in the menu for everyone of ours (before: Document Control only); a supplier sees its own deliveries
    against plan there (before: a bare "page not found").
  - The lines behind every report are shown (before: four reports sent you elsewhere); a bar opens its own lines;
    the filter says what it does and has Apply and Clear; the window can be changed; Excel as well as CSV.
  - "Export register" left this page: the register's own export is on Documents.
  - Deliveries can be read by sender (us as one, each supplier) or by discipline; a fresh review wait reads blue.
  - The Schedule look; numbers beside the bars, not on them; dates from today; "Department" reads "Discipline";
    the average turnaround says "under a day" instead of "0.0 d"; readiness bars carry the action's name.
  - Two new reports: **Progress by week** (how the register, deliveries, overdue, reviews and transmittals moved week
    by week, and since last week) and **Who owes what** (what each organization owes us and we owe it, documents and
    answers; a supplier reads its own). An Overview tab repeating the other tabs' figures was tried and removed.
  - Charts fit their question: the transmittal log in columns per month, reviews as the longest waits in days (or by
    reviewer), activity readiness on a calendar.
  - Every report prints (landscape, without the menus).
  - Register on a date charts when the register moved on from that day (replaced, released for the first time, put
    out of use, week by week), instead of counting what was current by discipline.
- **Settings → Controlled changes is gone** (upload a matrix or a list, then approve it). Settings regulates and
  takes no uploads; the matrix and the lists come in on Import & export, checked first. Four download templates no
  page offered any more (an old deliverable CSV, a schedule template, a details correction, a review matrix) are gone.
- **The setup tip is steps** (1 Settings lists, 2 the team, 3 the matrix, 4 the deliverable list) right of the title on
  Import & export; each opens its import, the one shown is marked. It follows dark mode.
- **Two downloads for each import kind:** the list as it stands now (the register as a filled workbook, the team, the
  matrix, every Settings list) and an empty template. The register brought back corrects only what changed.
- **Spreadsheets are checked before they are read**, on Schedule (the three lists), Import & export and Controlled
  changes: a renamed or damaged file, a workbook that unpacks too large or carries macros, and a file the virus check
  flags are refused, each said plainly. Before, the Schedule lists were only checked for size and name, and the
  screens' imports not at all. CSV downloads keep cells starting with = + - @ as text.
- **Tips look like tips** (dashed frame, yellow bulb, "TIP").
- **Stamps follow the project's choice** (the Control room, on Accepted and Returned): stamped
  or not; each stamp (released, returned by the review, superseded, void, on hold) on or off; and, if wanted, the
  comments of a verdict that carries them listed on a last page. Before, the setting was not read and every stamp
  was made.
- **A rejected revision is stamped** "RETURNED" in red, with the verdict and the day.
- **The PDF opened from a document is the stamped copy** (void, on hold, superseded, returned, released, else the
  clean one). Before, the clean copy was always opened, so no stamp was ever seen.
- **Three checks are gone**: a received document with no date received, a required field left empty, and a reason
  asking an answer with no period. The app already prevents them; they are listed under "Refused on every project",
  now in tabs by area. Their old findings close the next time the checks run.

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

- **Forms & fields is the project's** and the backend refuses what a form insists on (documents, revisions, transmittals,
  packages, tags). Your lists are document fields by themselves, a register column and filter. Gone from the page, as
  the app no longer asks them: the Readiness and Person forms, a revision's separate reason and "released as", the
  document's file and received date, a transmittal's response day and covering files, a package's status and acceptor.
  "A column of the register" now really makes one. "Copied in" on Send for review can be required or left out. Opening a
  project and adding an organization are checked by the backend too. A list of one's own in Numbering & identity can be
  a part of the number; the Numbering builder no longer offers lists a number cannot be built from.
- **A field of your own is one row** on Forms & fields: added and changed with the same form, taken off while never
  answered, retired once answered. Lists are no longer added to the document form by themselves (that made two fields).
- **Numbering is the organization's.** It is changed on the organization's page (Numbering), by an administrator, for
  every project; a project's Settings → Numbering reads it. The control function no longer changes it there, unless the
  organization makes numbering free for projects (What projects may change). A scheme that has given numbers keeps its
  parts: rename or retire it, or make a new one. "When this scheme is used" is now kept.
- **Revision naming is the organization's**, as numbering: changed in the organization's Settings (Revisions), by an
  administrator, for every project; a project's Settings → Revisions reads it, unless the organization makes it free.
- **The organization's Settings** (Organization → Settings) hold the same cards as a project's, each with its switch
  (may projects change it) and the projects with their own copy; a project is put back to the organization's only there.
- **Review routes have two levels.** The organization's are changed in the organization's Settings (Review routes), by
  an administrator, and offered on every project. A project changes its own where free (the default): its first change
  makes its own copy, and the organization's later changes do not reach it.

- **The Control room's switches now do what they say.** Four were read by nothing: "Sending a review to its reviewers",
  "Sending a document out", "Starting a revision nobody asked for" and "When an action has what it needs". Each now
  changes who may act (the backend refuses otherwise) or when a document counts for an action. The first three are left
  to the people doing the work until a project chooses otherwise, so nothing changes on a project that never answered.
  A revision started after one accepted as it stands now always asks why.
- **Revisions**: a line counting in small letters or with leading zeros keeps it when saved ("a", "01" in "Starts at");
  before, saving turned it to capitals and dropped the zeros.
- **Settings, the rest of the cards**: the Control room draws "Released & issued" as one step and shows a supplier's
  documents; the days around an action are set there. Review routes keep an outside step's reason, offer only the two
  real kinds of step, put "offered first" first and choose organizations properly. Functions & permissions: a tick is
  the permission on every document, and two columns the backend never kept are gone. Sign-in & security sets single
  sign-on and password sign-in, and the sign-in page offers the organization's own account.



---

**The day's notices, once a day at a set hour** (owner: "09:00, and add it to settings as a choice").
- Before: a worker job looked at every action of every project every 30 minutes.
- Now: once a day per project, at its notify hour on its own clock (`NOTIFY_AT`, 09:00 by default, the Control room's
  "At risk" step, the organization's Control room and Defaults for new projects; a switch as every Control room answer),
  only the actions whose risk window is open or whose day passed lately, and the review steps falling due, are read.
- Sent then, once each: at risk; notified again when a discipline stays silent (no longer waiting for a "day passed"
  notice first); a review step due today or the next working day. Each is a notification, an email and a pop-up.
- Taken out (owner: they are states, read when someone looks): the "all your documents are ready" notice for an action
  still ahead, and the "its day passed with documents missing" notice. Both still read on the action and on Home.
- The automatic confirmation of a discipline whose documents were all there by the day is still written, in the first
  day's notices after the day.
- A schedule read by an older version of the app's reading is read again once, when the worker starts after an update,
  never on a clock.

---

**Nothing runs on a clock to find out what happened** (owner: "the changes are the ones who tell us").
- The checks (Assurance) no longer run by themselves every day: they run when someone of the control function presses
  "Run the checks". Their figures say when they last ran. Taken out because the daily run re-read stored files and the
  whole history of every project every day, a cost growing every year, whoever looked.
- The notices no longer look every day whether anything is due: what changes an action, a review step or how a project
  counts its days writes the day its notices fall on, and the worker sleeps until the earliest one. A day with nothing
  written runs nothing. What is sent, and when, is unchanged.
- The sender of emails, notifications and the worker's jobs no longer asks every second whether there is something to
  send: the act that put it there wakes it once its save is committed.
- A schedule read by an older version of the reading is no longer read again when the worker starts: it is read again
  the first time someone opens that project's schedule. Schedules nobody opens are left as they are.
- The screens are told what changed only once the change is committed (before, a screen could read just before the
  commit and keep the old answer).

---

**Home's log is read by everyone of ours on the project** (owner). Before: the control function and administrators only.
Now anyone of ours reads it, narrowed to the acts on what they may open (a document above their clearance, its
revisions, files, reviews, and a transmittal they may not open are left out). The journal beside Home is narrowed the
same way (before, it named documents above the reader's clearance). Another organization's people still never read it.

---

**Every page keeps what it read until something it shows changes** (owner). Reports, the register's other reads,
transmittals, packages, assets, reviews, Assurance and its plan, the Schedule's extras, the calendar, Home, and every
Settings and organization page now keep their answers, per person, until a change names them (at most an hour). Read
fresh every time, as before: notifications, the account, sign-in and security, what waits for a result, the audit trail
and a person's activity, the notice log, and Excel downloads. A wrong password typed no longer throws away every kept
answer; a discipline's confirmation now also refreshes the Schedule.

---

**Reports are counted by hand, for everyone** (owner, as the checks). Before: counted again on every opening, every
tab, every page of lines and every download. Now: counted once, kept for everyone, and counted again only when someone
presses "Count again"; the plate says when and by whom. Each of our readers now sees only the lines on documents and
transmittals they may open (before, a report listed documents above the reader's clearance); the figures and the chart
still count the whole project.

---

**The pages' kept answers are capped** (owner). They live in the screens' memory only, at most 100 MB; when full, the
ones used longest ago drop by themselves. Nothing is written to disk any more, and a restart of the screens starts with
none kept (the first opening of each page reads it again).

---

**Health checks ask often only while starting** (owner: "what purpose of it all?"). Docker asks each part whether it is
alive: the database, Redis, the queue, the backend and the drawing converter. Before: every 5 to 30 seconds, for ever
(the queue's and the backend's each start a program to answer). Now: every few seconds while starting, so what waits
on them starts at once, then every 5 minutes.

---

**Opening and downloading no longer wait in the audit queue** (owner). Before: every recorded act, opening a document
included, locked the organization's audit trail until its save, so readers queued behind one another. Now: opened,
downloaded and a person's activity read are written beside the chain, unlocked, each sealed by its own fingerprint; acts
that change something stay in the chain as before. Nothing disappears from the Audit trail or a person's activity.

---

**A document's history keeps only what changed** (owner). Before: every change saved the whole document again, with all
its revisions and files. Now: each point keeps only what changed since the one before (a whole one every 20), and the
History page reads exactly as before. Nothing kept earlier is touched.

---

**Each file is copied to the second place as it is stored** (owner). Before: every 6 hours the copier listed every file
on both sides to find what was new. Now: the app copies each file the moment it is stored (an upload once checked, a
stamped copy…), and the full comparison runs once a week as a safety net; its alert waits 8 days instead of 12 hours.

---

**Who you are and what you may do is read once, not on every click** (owner). Before: every backend call read your
membership, function and rights from the database (about four reads), and every page read your profile and all your
projects. Now: kept in memory until something about people, functions, rights, projects, organizations or settings
changes in your organization, then read again once; at most 15 minutes in any case, as a safety net. The backend still
checks every act; signing out and sessions ended work as before.
