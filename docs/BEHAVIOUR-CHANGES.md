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

**Who sits on a step is whoever holds the step's function.**
- Before: you could pick specific people per step when sending for review.
- Now: the people picked per step are ignored. Everybody holding the step's function on the
  project is seated. To change who reviews, change who holds the function, or the route.

**Delegation (handing a step to somebody else).**
- Works as before: until a date, with a reason, flagged when the matrix would not have made it,
  and waiting for Document Control when they carry this act out.
- Difference: you hand a step to **one** person at a time (as your form already does).
- The delegate answers and comments **in the holder's place**: the record says
  "Aisha Approver for Eli Engineer", and the step shows the holder answered, by the delegate.

**Changing or taking back a comment before the step is answered.**
- The backend allows it (author only, until their step is answered).
- **Your review page has no button for it.** The code is there, but no screen shows it. Until a
  button is added, comments are closed with a resolution instead.
- A comment taken back is **kept on record**, marked withdrawn, and no longer shown or counted.
  (The old app deleted it.)

**Releasing a document type that is not reviewed.**
- "Send on for release" works. Behind the scenes it creates a review with **no steps**, already
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
- No "HELD" stamp is printed on the PDF.

**Late-review warning.** The old app warned the people on a step the day before it fell due. The
backend does not send that warning yet (the "warned" date stays empty).

---

## 4. Revisions and documents

**Voiding a revision.**
- Only the **newest** revision, and only if it was released in error or never reviewed.
- Released ones: voided by whoever decided it, or Document Control (or its author where the people
  doing the work carry this act out). Never-reviewed ones: by the author or Document Control.
- Whoever received it is told to stop using it, and what was asked to be sent for it lapses.
- No "VOID" stamp is printed on the PDF.

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
- Packages cannot yet be filled "by asset tag" (refused with a message).
- A requirements list that names an unknown tag creates it (named by its tag) and links the document.

---

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

**Still not possible:** adding files to something received after it was recorded (what came is fixed
at arrival, which is its receipt); returning everything on a received transmittal when your
organization has published no "return" outcome.

---

## 6. Schedule and document requirements

**A waived need still shows as missing on the schedule screens.** The screens have no place for a
waiver; the backend counts it as covered for readiness.

**The schedule itself is not uploaded as a "list for a decision".** It is read from the **schedule
document**: attach the export to a new revision of it and send that for review. Releasing it is the
approval, and moves every activity date. The "Project schedule" controlled-change page says so.

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

## 7. Notifications and email

- Notifications are kept and shown in the bell and on the Notifications page; opening the page reads
  them all, as before.
- **Email is off by default.** Every email is still written down (the outbox) and marked "off". Turn
  sending on in `deploy/.env`: one switch for everything, then one each for transmittals, reviews and
  notifications.

---

## 8. Data added while testing

Testing on your local copy added a few records to the demo data: some test documents, packages,
transmittals, a schedule note, a delivered draft letter ("Draft letter (e2e)"), and activities A100
and A300 now carry the departments CI and ME (from a test of the departments list). None of this is
in the code; it lives only in your local database.
