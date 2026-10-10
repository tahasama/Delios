# Changes the Standard needs

Decisions taken while building the application that the **Document Management
Standard v2** does not yet say, or says differently. None of these are screen
design; each is a rule about how information is controlled, so the published
document has to change before the application can claim conformance to it.

Read with `docs/ROLLOUT.md` §6 — *When the Standard changes*. The catalogue is
no longer generated from the document: `src/lib/checks/catalog.ts` is the
application's own list of what it can answer (see §21 below), so a change here
is a change to the published document, and only then — if it names something
the register can settle — a change to the catalogue.

Each entry says what the Standard holds today, what it must hold, and what in
the application already depends on the change.

---

## 1 · Release and issue are one act

**Clause:** §2.5 *Issue, release and transmittal*. Touches §7.2 *Revision
state*, §7.9 *Transition record*, §8.1 *Approval requirement*.

**Today:** release and issue are two acts. A revision is released, and is
issued separately, possibly later, possibly not at all.

**Must say:** a revision is either not released, or **released and issued** in
one act. Release is refused unless the issuance is stated — who it goes to, and
why. The two timestamps are stamped together.

**Why:** the gap between the two was where information sat released internally
and unavailable to the people who needed it, with nothing in the record saying
so. Latency with no owner.

**Default, and preference.** Released and issued in one act is the default —
what the application recommends and does out of the box. It is not a rule:
an organization that wants them separate keeps them separate — `POLICY_RELEASE`
(TOGETHER | SEPARATE), set by its administrator. The Standard should state the
default and permit the other, not forbid it (§1.3 *Local configuration*).

Where they are separate they are two states in order: **Released**, then
**Issued** once it is sent; saying who receives it is optional on the review
route, and a released revision not yet sent is a state of its own, not a
breach. Where they are one act, such a revision breaks the rule and is stamped
NOT ISSUED; `scripts/issue-released.ts` issues the ones seeded that way on demo
data.

**Depends on it:** `releaseRevision` in `src/lib/lifecycle.ts`, the issue-request
gate, 19 checks in `scripts/verify-release.ts`.

---

## 2 · An outside approval is a step of the route, not something beside it

**Clause:** §8.1–§8.2 *Approval requirement / authority*, §9.1 *The review
cycle*, §11.11 *Transmittals and review cycles*.

**Today:** an external approval is treated as a separate act after review.

**Must say:** where release waits on an outside party, that approval is a step
of the review route. It has the route's own due date, it holds the release
until it answers, and its answer either releases and issues the revision or
returns it to review. The days it takes are inside the review time, not added
to it.

**Depends on it:** `openApprovalStep` / `settleApproval` in
`src/lib/issue-requests.ts`; the *External approval* checkpoint in
`src/lib/action-lateness.ts`.

---

## 3 · Confidentiality is a named list, not a clearance ladder

**Clause:** §5.7 *Confidentiality*.

**Today:** confidentiality reads as levels a person is cleared for.

**Must say:** levels the organization publishes as open are readable by
everybody on the project. Anything above them is readable by **people named on
the document itself**, kept by whoever is answerable for its content — its
author or whoever uploaded the file — plus an administrator, because somebody
must be able to. There is no clearance attribute on a person.

**Why:** clearance made confidentiality a property of rank. On a project the
people who may read a closed document are chosen deliberately, one by one.

**Depends on it:** `closedDocumentFilter` and `CLOSED_MODELS` in
`src/lib/tenant.ts`; the access list on the document page.

---

## 4 · Delegation reaches only the people the route names

**Clause:** §8.5 *Delegation*, §1.4 *Accountability*.

**Must say:** a step may be handed only to somebody the authority matrix or the
route names for that act. Holding the verb as Document Control or as an
administrator is an emergency power, not a qualification to answer in
somebody's place; those holders are refused as ordinary targets, and the refusal
says so.

**Depends on it:** `src/lib/delegation.ts` — `delegateCandidates`,
`delegationRefusal`, `byPrivilege`.

---

## 5 · Ready means released, issued, and at the status the action asks for

**Clause:** §14.3 *Baseline entries*, §14.8 *Verification*.

**Today:** a baseline entry is met when the document reaches the required
status.

**Must say:** a required document counts as available when its current revision
is **released and issued** and carries the required status. For information
produced outside, where release is not ours to give, the required status alone
counts — and which of the two readings applies is the project's published
answer, not the reader's assumption (`POLICY_READY`: ISSUED | STATUS).

**Depends on it:** `src/lib/readiness.ts`, the denormalised counters on
`Action` (`needCount`, `metIssuedCount`, `metStatusCount`).

---

## 6 · Late receipt is a state of its own

**Clause:** §14.8 *Verification*.

**Must say:** an action whose documents all arrived, but whose last document
arrived **after** the day of the work, is not complete in the sense §14.8
means. It is recorded as **late receipt** — the work went ahead without
everything it needed, and what was missing turned up afterwards. It is never
reported as done.

**Depends on it:** `Action.lastMetAt`; the `LATE_RECEIPT` state on the schedule.

---

## 7 · Where the time went: a chain of checkpoints, each with its own owner

**Clause:** §14.4 *Required-by dates*, §14.8 *Verification*. New material.

**Must say:** when a required document is late, the delay is attributed by a
succession of checkpoints, read in order, because one cannot be late without
making the next one late too. The **first that slips is the cause**; the ones
after it inherit the delay rather than own it.

| Checkpoint | Measured against | Owed by |
|---|---|---|
| Sent for review — *Supplier sent*, where it is not ours | the planned submission date (§14.4) | whoever produces it |
| One per step of the route: advisory step, client review, external approval, the deciding step | that step's own due date, set by whoever wrote the route | that step |
| Released and issued | the day of the action | Document Control; where a project has none, whoever decided it |

**Why:** so nobody argues about it afterwards, and so a step never carries a
delay that began before it.

**Depends on it:** `src/lib/action-lateness.ts`; the delay columns on the action
page; the baseline export.

---

## 8 · The day passing is the work happening

**Clause:** §14.8 *Verification*.

**Must say:** an action whose scheduled date has passed is taken to have been
carried out — that is what a schedule is — **unless** the control function has
recorded that the work was postponed. The record, not the reader, says which.

---

## 9 · The readiness verification record, and what DEF-DB-13 means

**Clause:** §14.8 *Verification*; **Annex H**, check DEF-DB-13 *Action
proceeded without readiness verification* (critical, structural).

**Today:** the check reads as "an action proceeded short of its documents", so
every shortfall is a critical defect.

**Must say:** the clause asks whether readiness was **verified**, not whether
everything arrived. The verification record is a note written against the
action saying what happened — carried out anyway, or postponed — who approved
that, why, and who owes the delay with what they say about it. The note keeps
**the date the action stood at when it was written**, because a later schedule
moves the date and would otherwise erase what was agreed. It is never edited
and never deleted.

DEF-DB-13 therefore fails an action that passed short of its documents **and
carries no such note**. An action that carries one has answered the clause,
whatever the note says.

**Depends on it:** the `ActionNote` record; `DB-13` in
`src/lib/checks/runners.ts`; audit acts `ACTION_CARRIED` / `ACTION_STOPPED`.

---

## 10 · Recipients: asked, or only told

**Clause:** §11.4 *Recipients*, §11.5 *Receipt*, §11.8 *Distribution*.

**Today:** recipients are recorded individually, all of one kind.

**Must say:** a recipient is either **addressed** — asked to do something with
what was sent — or **copied in**, kept informed and asked for nothing. Both are
recorded individually and both may open it. **Receipt evidence under §11.5 is
read from the addressed recipients only**: a transmittal is not received
because somebody copied in happened to look at it. A copy's opening is still
recorded, against that person.

**Depends on it:** `TransmittalRecipient.kind`; the seen count everywhere it
appears.

---

## 11 · An answer is correspondence, not a field

**Clause:** §11.1 *Transmittals*, §11.12 *Time limits*.

**Must say:** an answer to a transmittal is **a transmittal of its own** — its
own number, its own reason for issue, its own recipients and its own enclosures
— linked to the one it answers. Anybody the question reached may answer it,
including somebody copied in. The people copied in on the question are copied in
on the answer unless changed.

Whether the response period of §11.12 has been met is then read from the
existence of a linked answer, not from a note somebody typed.

**Depends on it:** `Transmittal.inReplyToId`; the exchange on the transmittal
page; `/transmittals/new?replyTo=`.

---

## 12 · Acts the Standard does not name

**Clause:** §11.5 *Receipt*, §11.9 *Acceptance of transmittals*, §11.12 *Time
limits*.

**Notifying again.** Where addressed recipients have not opened a
transmittal, the control function may notify again whichever of them it
chooses — one, several, or all. The day is recorded against each recipient
notified, and their names in the audit trail. Without this the record was
silent about the commonest failure in distribution: nobody looked.

A transmittal is not closed by hand. Once issued it is the proof that it was
sent, and opening it is the proof it reached the person addressed; what happens
next is a transmittal of its own — an answer, a reply saying what is wrong, an
onward issue to colleagues. Nothing about the first one needs to be ended.

So a transmittal has no *closed* status. Where §11.11 says a transmittal with no
review obligation is complete on acceptance, *accepted* is that completion; no
further status is set. Whether an answer owed under §11.12 is still outstanding
is read from whether one has been linked to it, never from a status.

**Sending it on.** An organization with no accounts here (a party of kind
*offline*) cannot open a transmittal, so it can never be seen. It is addressed
through its contact, and one of our people — the party's liaison, or the
control function where none is named — is told instead, sends it to them by
email or through their own system, and records on that recipient the day, how
it went, their reference and the proof. For that recipient, that record is the
receipt §11.5 asks for. It is the same record a review step carried for such an
organization already keeps, and a review step sent that way fills in the
transmittal's row for them too.

**Depends on it:** `chaseTransmittalAction`, `markRecipientSentAction`; the
recipient's `dispatchedAt`, `dispatchChannel`, `dispatchRef`,
`dispatchedByName` and proof; audit acts `TRANSMITTAL_CHASED`,
`TRANSMITTAL_SENT_ON`.

---

## 13 · Acceptance is the control function's decision, not a checklist

**Clause:** §11.9 *Acceptance of transmittals*, conditions a–e.

**Must say:** the conditions of §11.9 are what the control function applies
when it judges what has arrived; they are its procedure, and are not recorded
one by one. The record keeps the decision — accepted, or rejected with the
reason the sender is given — who made it, when, and any note. A rejection is
a decision of its own and must give its reason.

A received transmittal that encloses nothing — no documents and no files —
leaves nothing to judge, and is accepted as it is recorded.

Files that came with a received transmittal and are not register documents —
the covering letter, the email, what was attached — are kept with it as the
record of what arrived. One becomes a register document only when somebody
makes it one; the transmittal then lists that document.

Checks recorded condition by condition before this change are kept, and shown
as they were.

**Depends on it:** `acceptTransmittalAction`, `attachTransmittalFilesAction`;
files of kind `ATTACHMENT` on the transmittal; "Make it a document" on the
transmittal page; audit acts `TRANSMITTAL_FILES_ATTACHED`,
`TRANSMITTAL_FILE_REGISTERED`.

---

## 14 · Audit acts to add to the record vocabulary

**Clause:** §16.6 *Views*, and wherever the Standard enumerates recorded acts.

`ACTION_CARRIED`, `ACTION_STOPPED`, `TRANSMITTAL_CHASED`, `TRANSMITTAL_SENT_ON`,
`TRANSMITTAL_FILES_ATTACHED`, `TRANSMITTAL_FILE_REGISTERED`.

Each is a decision somebody is answerable for, so each is a recorded act and
each belongs in the project's own log, not only in the administrator's audit
trail.

---

## 15 · A transmittal may carry words alone

**Clause:** §11.3 *What may be issued*, and check IS-03.

**Must say:** a transmittal issues documents, or words, or both. One that
encloses nothing but has a subject or a message — a clarification, a notice,
an answer, a covering letter — is complete and is issued like any other. Only a
transmittal empty of both documents and words is incomplete, and IS-03 counts
only that one.

**Depends on it:** gate `ISS-ITEMS`; check `IS-03`; the acceptance conditions
of entry 13, which a letter answers as not applicable.

---

## 16 · An outside approval is answered through Document Control, and a late one puts the revision on hold

**Clause:** §7 *Release*, §11.10 *Rejection and resubmission*.

**Must say:** an outside party's answer on a revision it must approve goes to
the control function, like any decided revision. An approval lets it release
and issue the revision. A refusal blocks release until the control function
sends the revision back, with a reason, to whoever it goes back to: the
supplier where it came from outside, otherwise whoever started its route. The
control function chooses who is copied in; they start as the people who sat on
the route.

Where a released and issued revision is found to need an outside approval it
never had, it is put **on hold, not for use** from the moment it goes to that
party, and stays released — people hold copies of it. Everybody it was sent to
is told, and told again when the hold ends either way. It cannot be sent again
while on hold. An approval lets the control function lift the hold, and what
was asked for it is then sent. A refusal leaves it on hold for good; it goes
back with a reason, and the next revision replaces it.

**Depends on it:** `settleApproval`, `returnAtGate`, `holdRevision`,
`liftHold`, `returnHeld`, `returnRecipients`; `Revision.heldAt`,
`heldReason`, `heldByName`; audit acts `OUTSIDE_APPROVED`, `OUTSIDE_REFUSED`,
`REVISION_HELD`, `REVISION_HOLD_LIFTED`.

---

## 17 · The verdict stamped on the document

**Clause:** §10.2 *Renditions*, §12.5.

**Must say:** where the project chooses, a binding review verdict is stamped
on the viewable PDF copy — top right of the first page: the verdict, who gave it (and for which outside party), the date and time, and the
reason — whether the review ran on a route or was opened from a received
transmittal. A revision on hold is stamped ON HOLD — NOT FOR USE on every page.
Each stamp makes a new copy; the copy as submitted is kept. Whether to stamp is
the project's choice, set by its administrator; the release title block of
§12.5 is applied either way.

**Depends on it:** policy `POLICY_PDF_STAMP`; `stampVerdict`, `stampPdf` (state
HELD).

---

## 18 · A new revision says why it exists, once

**Clause:** §6.5 *Authorization*, §9.3.

**Must say:** a revision is authorized by what happened to the one before it,
not by a separate act of the control function.

- *The verdict asked for it* — refused, or accepted with comments to carry
  (a verdict whose effect is "back to the author" or "final, fix next time"),
  or Document Control sent the revision back. The verdict is the reason: the
  next revision may be started at once, by whoever works on the document, and
  it carries the verdict as its reason. Nobody writes it again.
- *Nobody asked for it* — the revision before was accepted as it stands. A new
  one may still be started, on any side, but whoever starts it must write why;
  the form asks only in this case, and the reason is shown next to the revision
  it follows, where somebody reading the older one will look for it.

The verdict is read for what it does, not for its code, since every
organization names its own verdicts.

**Default, and preference.** Starting a revision nobody asked for is left to the
people doing the work by default, whether or not the project has a control
function. An administrator may give it to Document Control instead; it cannot
be switched off, because the reason is the record.

**Depends on it:** `revisionGround`; act `AUTHORIZE_REVISION` (default: the
people doing the work).

---

## 19 · A document type says whether it is reviewed

**Clause:** §3.1 *Document types*, §7.1, §8.1.

**Must say:** every document type is published with the answer to one
question — is it reviewed before release? A type that is reviewed goes down a
review route, as now. A type that is not goes from preparation straight to
release: whoever would have sent it for review sets the status it is released
at and who receives it, and from there it is any decided revision — an outside
approval asked for opens first, and Document Control's gate publishes it.

§8.1 asks for a recorded approval before release. For a type that is not
reviewed there is none to record, and none is invented: the type's own rule
stands in for it, and the release record says so. A revision that was sent
down a route after all needs its approval like any other.

**Default, and preference.** A type that says nothing is reviewed. Whether a
type is reviewed is the organization's answer, given when the type is
published.

**Depends on it:** property `review` on `DOCUMENT_TYPES`; `typeSkipsReview`,
`releasedWithoutReview`, `readyForRelease`, `submitForReleaseAction`.

---

## 20 · A transmittal is never changed after it went

**Clause:** §11.1, §11.10.

**Must say:** what was sent stays as it was sent. A person or a document left
out goes on a **supplement**: a new transmittal, with its own number, that says
which one it adds to. A package the recipient rejected goes again on one that
**replaces** it, again with its own number. Both start as a copy of the first —
its reason, its people, its documents — and the sender changes what was
missing or wrong. The first lists what was sent after it.

A replacement follows only a rejected transmittal; anything else is added to on
a supplement. A draft has not gone, so it is simply changed.

**Depends on it:** `Transmittal.followsId`, `followKind` (SUPPLEMENT | REPLACES).

---

---

## 21 · The check catalogue is the application's, not an annex of the Standard

**Clause:** Annex H, and §17 throughout.

**Today:** the annex lists 274 defect checks for any document system, and the
application is expected to run them.

**Must say:** a conformance check is a question somebody can answer from the
records that exist. The Standard states the conditions; each application
declares which of them **it** can detect, and is measured on those. 97 survive
here. The rest fall into two kinds, and the Standard should name both:

- conditions the application **prevents** (§22), which cannot arise to be found;
- conditions **no record could settle** — whether an unmarked copy was
  circulated, whether a comment was answered on its substance — which belong to
  an audit by hand, not to a page that reports a percentage.

**Why:** a check that cannot fail and a check that can only fail teach people to
ignore the page. Coverage rose from 51% to 100% by removing questions nobody
could answer, and the measured figure now means *of what can go wrong here, how
much is watched*.

**Depends on it:** `src/lib/checks/catalog.ts`, the Assurance section.

---

## 22 · A condition the application refuses is not a check, and is not counted

**Clause:** §17.4 *Integrity*, §17.7 *Qualified statements*.

**Must say:** where the act that would create a condition is refused, the
condition is stated as a **rule**, with the act that refuses it, and is excluded
from the measurement. A document number cannot be typed; a revision cannot be
released without approval, description and a fixed copy; information under legal
hold cannot be destroyed. Twenty such rules are published beside the checks.

**Why:** folding them into the percentage could only raise it and could never
lower it, which makes the figure unfalsifiable — the one thing a conformance
number must not be.

**Depends on it:** `src/lib/checks/prevented.ts`, *Assurance → Default rules*.

---

## 23 · A published list has no editions; a value is retired, never edited

**Clause:** §4.7 *Controlled value lists*.

**Today:** value lists are versioned, and a document is said to be checked
against the edition in force at its date.

**Must say:** a list has live values and retired ones. A value the register has
used is retired — it stays readable on every document that carries it and is
offered to no new one — and is never edited or deleted. There is no edition to
compare against, so no list version is published or stored.

**Why:** an edition number implied a drift that cannot happen: approvals already
record the authority matrix version in force when they were given, and the
uploaded lists (schedule, departments, requirements) keep every past version
with who approved it. A photograph of a rulebook that cannot move is a
photograph of nothing — which is also why the traceability spine and its
synchronized baseline were removed.

**Depends on it:** the retire/reactivate actions, `ConfigValue.status`.

---

## 24 · What a form asks is the organization's; what makes a record controlled is not

**Clause:** §1.3 *Local configuration*, §4.4 *Conditional fields*.

**Must say:** an organization decides, for every form, **what it captures and
what it calls it** — each field required, optional, or not asked — and may add
fields of its own. It may not configure away what makes a record controlled: a
document without a title, type or discipline, a transmittal without recipients
or a reason, a review without a route. Each of those states its reason on the
screen rather than being silently absent.

Two things override the organization's answer, and only ever to make a field
stricter: a numbering scheme that draws on a field, and the type-to-field
matrix.

**Depends on it:** `src/lib/field-policy.ts`, `FieldPolicy`, `CustomField`,
*Settings → Forms & fields*; ten forms wired to it.

---

## 25 · Records other than documents are numbered by a published scheme

**Clause:** §3 *Identification*, §11.1 *Transmittal*.

**Must say:** transmittals, activities, reviews and packages are numbered the
way a document is — by a scheme the organization publishes and routes — not by a
rule buried in the code that raises them. A scheme for a record reads the record
itself (project, sub-project, sender, receiver, reason, counter). Until one is
routed, the short form (`TR-0001`) stands, and numbers already raised keep it.

**Depends on it:** `src/lib/numbering-records.ts`, *Settings → Numbering*.

---

## 26 · A review's time belongs to the route, step by step

**Clause:** §9.4 *Review period*.

**Must say:** the working days a review has are set on the **route**, per step.
The step's own date is what that reviewer must answer by; the review's date is
every step's days added up, counted from the day it went out. Both are stated
wherever reviews are listed, and never confused: a step answered on time inside
a route that is overdue is a different fact from either on its own.

**Depends on it:** the `days` on a route step, `ReviewCycle.dueAt`, the **Step
due** and **Review due** columns.

---

## 27 · The Document Management Plan is generated from the configuration

**Clause:** §1.6 *Conformance assessment statement*, Annex C.

**Must say:** the plan a project publishes states how information is controlled.
Where an application holds that configuration, the plan is **written from it** —
numbering from the schemes, classification from the published lists, review from
the routes, retention from the classes — so the plan and the behaviour cannot
drift. What the application does not hold (cover page, client clauses, local
conventions) stays in a document the organization registers and names as its
plan.

**Depends on it:** `src/app/(app)/settings/dmp/plan.tsx`,
`ScopeConfig.dmpDocumentId`.

## 28 · Advice is chosen from a published list, with its comments

**Clause:** §9 *Review*.

**Must say:** an advising step answers from the organization's advice list (for
example: no comment, comments none blocking, blocking comments). The comments
are written with that answer, in the same place, and are obligatory when the
answer has comments; otherwise they are not asked. Advice never says less than
the comments it carries. The decider reads it and is not bound by it, except
that a blocking comment stops release until settled. The same holds for a
verdict that carries comments (accepted with comments, rejected).

**Depends on it:** `REVIEW_ADVICE`, `ReviewService.AnswerAsync`, `verdict-status.tsx`.

---

## 29 · A revision under review may be withdrawn to be changed

**Clause:** §7.2 *Revision state*, §9 *Review*.

**Must say:** until released, a revision is changed in full (files, title,
fields) while in preparation. Under review, the author or Document Control
withdraws it, with a reason. The review is kept, in the review register, as
**withdrawn** with that reason and its comments; everyone on the route is told.
The revision then goes through a new review. A revision is never in two
reviews at once.

**Depends on it:** `ReviewStates.Withdrawn`, `WithdrawForUpdateAsync`.

---

## 30 · What a revision is issued for is stated at start and confirmed at each step

**Clause:** §7.3 *Revision status*, §9 *Review*.

**Must say:** a revision starts with its purpose (IFR when nothing else is said).
Each step of its review confirms it or changes it, on purpose; the decider's
grant is what the revision is released at. Document Control releases what was
granted and does not choose it.

**Depends on it:** `Revision.StatusCode`, `AnswerRequest.Status`.

---

## 31 · The sender names the people of a review; a step is never without names

**Clause:** §9.2 *Review route*.

**Must say:** a route proposes who answers each step; the sender may change the
people for that review, and the record says so. Every step names who answers it
before the review starts, and the review shows those names on every step,
including those not yet reached. "Leave it to" someone (who receives it once
released) goes to whoever started the review.

**Depends on it:** `StartReviewRequest.People`, `StepView.GoesTo`.

---

## 32 · The schedule's lists are controlled documents

**Clause:** §11 *Planning*.

**Must say:** the schedule, the disciplines per action and the document
requirements list are each a register document, revised and released like any
other. Their Excel is read into the application only by Document Control or a
function holding the Plan permission. From a released revision: the uploader
confirms the file is that revision, or says why it differs. With no released
revision: a reason is obligatory (approver away, approved on paper and the
stamped scan follows). Every upload is logged with who and why. Actions keep
the application's own number and the planner's ID beside it.

**Depends on it:** `ListUploadEndpoints`, `Verbs.Plan`, `Activity.ExternalId`.

## 33 · A document's details change only with a revision

**Clause:** §4.9 *Metadata change*.

**Must say:** the details of a document (title, type, discipline, criticality,
confidentiality, retention…) change together with a revision being prepared,
and are part of what that revision's review sees. Once the revision has left
preparation, no detail changes on its own: correcting one takes a new
revision. Before the first revision, the reserved number's details may be set.

**Depends on it:** `DocumentService.UpdateAsync` (`DETAILS_NEED_A_REVISION`).

## 34 · Legal hold freezes the end of a document, not its work

**Clause:** §10 *Retention and disposal*.

**Must say:** a legal hold is put on and lifted by Document Control, each time
with a recorded reason. While held, the document cannot be retired and none of
its revisions voided. The work goes on: new revisions and reviews are allowed.
Nothing is ever disposed of by the application; only the owner of the system
removes anything.

**Depends on it:** `KeepingService.LegalHoldAsync`, `ON_LEGAL_HOLD`.

## 35 · How a document ends: cancelled, withdrawn, archived

**Clause:** §7.1 *Document state*.

**Must say:** a document that will never be produced, and of which nothing was
ever released, is **cancelled**. A document that was released and is no longer
valid is **withdrawn**: everyone who was sent a revision of it is told to stop
using it, and its history stays. A document is **archived** only with its
project, when the project is archived; reopening the project brings its
documents back into use. Voiding is not an end of the document: it says one
revision never counted.

Each end can be taken back with a recorded reason: a cancelled or withdrawn
document is reinstated (not while its project is archived), and a void is
taken back while the revision is still the newest and the document not held.
The people told of the end are told of its reversal.

**Depends on it:** `DocumentService.EndAsync`, `ReinstateAsync`, `KeepingService.UnvoidAsync` (`WAS_RELEASED`, `NEVER_RELEASED`,
`ARCHIVED_WITH_PROJECT`), `Supersession.TellWithdrawnAsync`, project status update.

## 36 · A project's code is always a published value

**Clause:** Annex C *Configuration* (published value sets), §5 *Numbering*.

**Must say:** the list of project codes in Settings holds every project's code
from the moment the project is created or its code changed. A document takes
its project's code from the project it is created in; it is never typed and
never refused for it. A code the administrator retired stays retired.

**Depends on it:** `ProjectCodes.EnsurePublishedAsync`, called on project create and code change and before a document is numbered.

## Still open — decided in conversation, not yet built

- **Escalation** where somebody refuses to acknowledge carrying an action
  without its documents. Agreed to be the Standard's and the DMP's business
  rather than the application's; the Standard should say what happens.
