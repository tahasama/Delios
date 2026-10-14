# Changes the Standard needs

Decisions taken while building the application that the **Document Management
Standard v2** does not yet say, or says differently. None of these are screen
design; each is a rule about how information is controlled, so the published
document has to change before the application can claim conformance to it.

The check catalogue is
not generated from the document: `frontend/lib/conformance/checks/catalog.ts` is the
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

**Depends on it:** `releaseRevision` in `frontend/lib/lifecycle.ts`, the issue-request
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
`frontend/lib/transmittals/issue-requests.ts`; the *External approval* checkpoint in
`frontend/lib/actions/action-lateness.ts`.

---

## 3 · Confidentiality is a named list, not a clearance ladder

**Clause:** §5.7 *Confidentiality*.

**Today:** confidentiality reads as levels a person is cleared for.

**Must say:** levels the organization publishes as open are readable by
everybody on the project. Anything above them is readable by **people named on
the document itself**, kept by whoever is answerable for its content — its
author or whoever uploaded the file — plus an administrator, because somebody
must be able to. A function may carry a clearance (§46).

**Why:** clearance made confidentiality a property of rank. On a project the
people who may read a closed document are chosen deliberately, one by one.

**Depends on it:** `closedDocumentFilter` and `CLOSED_MODELS` in
`frontend/lib/core/tenant.ts`; the access list on the document page.

**Amended by §46:** a function may carry a clearance, confirmed by the owner.

---

## 4 · Delegation reaches only the people the route names

**Clause:** §8.5 *Delegation*, §1.4 *Accountability*.

**Must say:** a step may be handed only to somebody the authority matrix or the
route names for that act. Holding the verb as Document Control or as an
administrator is an emergency power, not a qualification to answer in
somebody's place; those holders are refused as ordinary targets, and the refusal
says so.

**Depends on it:** `frontend/lib/reviews/delegation.ts` — `delegateCandidates`,
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

**Depends on it:** `frontend/lib/schedule/readiness.ts`, the denormalised counters on
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

**Depends on it:** `frontend/lib/actions/action-lateness.ts`; the delay columns on the action
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
`frontend/lib/checks/runners.ts`; audit acts `ACTION_CARRIED` / `ACTION_STOPPED`.

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
page; `/transmittals/new?follows=` (see §45: answering and completing are one
"Follow up").

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

**Depends on it:** `frontend/lib/conformance/checks/catalog.ts`, the Assurance section.

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

**Depends on it:** `frontend/lib/conformance/checks/prevented.ts`, *Assurance → Default rules*.

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

**Depends on it:** `frontend/lib/settings/field-policy.ts`, `FieldPolicy`, `CustomField`,
*Settings → Forms & fields*; ten forms wired to it.

---

## 25 · Records other than documents are numbered by a published scheme

**Clause:** §3 *Identification*, §11.1 *Transmittal*.

**Must say:** transmittals, activities, reviews and packages are numbered the
way a document is — by a scheme the organization publishes and routes — not by a
rule buried in the code that raises them. A scheme for a record reads the record
itself (project, sub-project, sender, receiver, reason, counter). Until one is
routed, the short form (`TR-0001`) stands, and numbers already raised keep it.

**Depends on it:** `frontend/lib/numbering-records.ts`, *Settings → Numbering*.

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

**Depends on it:** `frontend/app/(app)/settings/dmp/plan.tsx`,
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

## 37 · Criticality is recommended by the document type

**Clause:** §5.6 *Criticality*, Annex C *Configuration*.

**Must say:** each document type carries a recommended criticality, published
in Settings with the type. Creating a document fills it in from the type; the
person creating it may choose another level when they see it differently, and
the recommended one stays marked. Each level says in plain words what it means,
with examples, and what it decides (who approves, how long it is kept), shown
where it is chosen.

**Depends on it:** `DOCUMENT_TYPES` property `criticality`, `CRITICALITY` property `meaning`, the create form.

## 38 · Before an action: automatic confirmation, notices, postponement

**Clause:** §14 *Planning and readiness of activities*.

**Must say:** a discipline whose documents for an action are all released at
the status asked is confirmed automatically; otherwise it confirms by hand from
the action's risk window (per document, or the project's), always saying why it
goes ahead without what is missing, and after the day always saying why it
confirms late. The disciplines still short are told automatically when the
action becomes at risk and again when its day passes; those who confirmed are
not. A postponement is written with who decided and why, and is confirmed by
whoever plans the project with what changes, so a new schedule revision can
follow. Document Control may take back a confirmation or a decision, with a
reason, kept on the record. Every notice is kept: who was told, by whom, when.

**Depends on it:** `ActionNotices`, `NoticeLog`, `Activity.RiskFrom`, `Requirement.RiskDays`, `ReadinessConfirmation.Automatic/Revoked*`,
`ActivityDecision.Confirmed*/Reversed*`, `/notices`, `NotifyPanel`.

## 39 · Disciplines and documents of an action set by hand

**Clause:** §14 *Planning and readiness of activities*.

**Must say:** besides the disciplines-per-action and requirements lists,
Document Control or whoever plans the project may tag an action's disciplines
by hand, and Document Control may add a register document to an action (for a
discipline it concerns) or take one off. Anyone concerned may ask, by a
transmittal to Document Control that names the action; Document Control
answers every such request, by adding the document or saying why not, and the
person who asked is told. Each change is kept in the activity log.

**Depends on it:** `Transmittal.ActivityId/ActivityAnswered*`, `/transmittals/{id}/activity-answer`, `NeedRequest.TransmittalId`,
`ADD_TO_ACTION` Home work, `LinksCard`, `needDefaults`.

## 40 · What people write is kept, and shown where it matters

**Clause:** §5 *Records* and §11 *Review and approval*.

**Must say:** everything a person writes and the system keeps (a comment, an
explanation, a reason, a note, an answer, a message) is shown with the thing it
is about and to the people it is for, not only in the activity log. A later act
never erases it: taking a void back, lifting a hold, reinstating a document,
sending a route back to an earlier step, or submitting corrected files keeps
what was written before, beside what answers it. A text that is too long is
refused, never cut.

**Depends on it:** `Written` (`Revision.Unvoided*`, `Document.Ended*/Reinstated*/LegalHoldLifted*`), `Review.SendBacks`,
`ReviewComment.ReclassifyNote`, `Package.AcceptNote`, the revision row, the review page's "Sent back".

## 41 · Management confirms requests and new people, where the project wants it

**Clause:** §1.4 *Roles* and §14 *Planning and readiness of activities*.

**Must say:** each project says whether Document Control adds documents and
disciplines to actions and people to the project, or the work does it itself
(the discipline for its own documents; management for people). With Document
Control, the project may also ask for management's confirmation: Document
Control checks the request, management (a function holding Manage) confirms
or refuses with a reason, and the change is then applied. A person added is
not on the project until confirmed. A request keeps the rule it was raised
under.

**Depends on it:** `ACTION_LINKS`, `PROJECT_PEOPLE`, `CONFIRM:{act}`, `Verbs.Manage`, `Transmittal.ActivityConfirm/ActivityProposal`,
`Membership.PendingSince/Refused*`, `/activity-check|confirm|refuse`, `/people/pending|confirm|refuse`.

## 42 · A supplier's document is held by one side at a time

**Clause:** §9 *Information from suppliers and contractors*.

**Must say:** a document exchanged with a supplier (one asked of them by a
placeholder) is held by one side at a time, and only the holder changes it,
so that two sides never overwrite each other's work. The placeholder sent, the
supplier holds it; once they send it, we hold it; our check returning it hands
it back to them; after the review, a verdict accepting it or taking it for
information leaves it with us, and one with comments to take into the next
revision, or one rejecting it, hands it to them. Every document of
an outside organization is filed in that supplier's package (one per supplier
and purchase order, made by itself), which Document Control shares with the
supplier once and for good. A placeholder is asked of a supplier only on a
transmittal — raised from that package, or from the register, one supplier's at a
time — the record of what was asked, when, and by when — and is asked once; adding a document to a package asks nothing. The
supplier sees only what was asked of it or exchanged with it. The side that does not hold
it asks the holder to hand it back for an update, saying why; the holder
accepts or refuses with why, and the one who asked is told. A revision not yet
reviewed passes as it is and returns under the same value; only a release, or
a review that returns it, makes the next one a new revision. A document with no
placeholder (a letter, minutes) is not held: the supplier may send another at
any time. A supplier's document is read in its own states: sent, received,
accepted, returned (by Document Control's check, with why), in review, released
and issued, returned (rejected by the review). A notice about a supplier's
missing document proposes that supplier's people, who are sent to the document
itself.

**Depends on it:** `Document.WithSupplier`, `HandBackRequest` (RETURN_FOR_UPDATE), `/documents/{id}/asks`,
`/asks/{id}/answer`, `/documents/{id}/send-to-supplier`, `ASKED_OF_SUPPLIER`, `HELD_BY_US`, `ANSWER_HAND_BACK`,
`SupplierHold.HandsToSupplier`, `Register.SupplierStage`, `supplierStage`, `NoticeRequest.OutsideLink`.

## 43 · A verdict list says four meanings, whatever its names

**Clause:** §9.3 *Review outcomes*.

**Must say:** an organization names its own verdicts, but each one says one of
four things: accepted; accepted with comments, to take into the next revision;
rejected, back to the author for a new revision; for information, its content
not reviewed. What follows a verdict (release, a next revision, who holds a
supplier's document) is read from that meaning, never from a code.

**Depends on it:** `VERDICT_EFFECT` (`proceed`, `resubmit`, `information`), `verdictEffect`, `SupplierHold`.

## 44 · A supplier sees where its documents are needed, and nothing else of the plan

**Clause:** §9 *Information from suppliers and contractors*, §14 *Planning and readiness of activities*.

**Must say:** a supplier is shown the activities that need its documents, each
with its date, and in each only its own documents, with where each stands and
whether it is on time, at risk or overdue. It is never shown other parties'
documents, our disciplines, confirmations, notices, or why an activity moved; a
postponed activity reads "date to be confirmed". Every planned date reads the
same way for everyone: ready, submitted, overdue, at risk, or days left.

**Depends on it:** `/supplier-schedule`, `/needed`, `plannedState`.

## 45 · One "Follow up"; two families of transmittal; a receipt is ticked

**Clause:** §11.1 *Transmittals*, §11.2 *Reasons for issue*, §11.5 *Receipt*.

**Must say:** answering a transmittal and completing one are the same act,
**Follow up**: a new transmittal, with its own number, that mentions the one it
follows. Following one we sent carries over its documents and people (a
supplement); following anything else goes back to whoever sent it, with the
people copied in carried over (an answer). The subject stays the first one's;
no "RE:" or "Supplement to" is written into it — the mention says it. A package
they rejected is still sent again on one that **replaces** it.

A transmittal is either a **data** transmittal (documents for review, approval,
construction…) or an **information** transmittal (a request, an answer, a
confirmation…). The sender picks the family, then a reason from that family's
published list (`REASONS_FOR_ISSUE` prop `family`: Data | Information).

The sender is the person signed in and the date is today: neither is asked.
Recording one received outside the system is a tick, "Received from outside the
system" (Document Control only), and only then are who sent it and when asked.

**Depends on it:** `followsId` / `inReplyToId`, `REASONS_FOR_ISSUE.family`; the
transmittal form and page.

---

## 46 · A function may be limited to a confidentiality level

**Clause:** §5.7 *Confidentiality*. Amends §3.

**Must say:** a function may carry a **clearance**: the most confidential level
its holders read without being named. A document above it is read only by the
people named on it, whoever registered it, and whoever it was sent to. This
holds for every function, the control function included. No clearance means no
limit. People whose clearance does not reach a document are not proposed as
its recipients, nor seated on its review. The levels are ordered by the
published confidentiality list (its `level` where given, else its order).

**Replaces** §3's "no clearance": clearance belongs to a function, never to a
person. Confirmed by the owner.

**Depends on it:** `Function.Clearance`, `Identity/Clearance.cs`,
`DocumentQueries.Visible`; the clearance choice on Functions & permissions.

---

## 47 · Correspondence is a deliverable type, released without review

**Clause:** §3.1 *Document types*. Extends §19.

**Must say:** the organization publishes a deliverable type **Correspondence
(COR)**, numbered like engineering documents. Its document types are not
reviewed before release: minutes (MOM), letters (LET), site and progress
reports (SRP), photos and survey records (PHO), test certificates and
inspection records (TCR), delivery notes (DLN), permits (PMT), vendor
catalogues and manuals (VCM), requests for information (RFI). The organization
may rename, retire or add types; whether each is reviewed stays the type's own
answer (§19).

**Depends on it:** `DemoSeed.EnsureCorrespondenceSetupAsync`;
`releaseRevisionAction` (sends a not-reviewed type on).

---

## 48 · A released requirements list is read on release, all or nothing

**Clause:** §11 *Planning*, §14.3. Extends §32.

**Must say:** a document requirements list is a controlled document (type
**RQL**, or any type published as a requirements list). It is reviewed as a
PDF; when its revision is released, its spreadsheet is read into the
requirements automatically. One wrong line applies nothing, and the control
function is told why. The upload by Document Control or Plan (§32) remains the
manual way.

**Depends on it:** `Actions/RequirementsImporter.cs`, type property
`readsRequirements`.

---

## 49 · A needed document is shown whatever its state

**Clause:** §14.3 *Baseline entries*. Extends §5.

**Must say:** a document an action needs is listed from the register whatever
its state — placeholder, in review, released, released and issued — with that
state shown in the organization's own words. It counts as ready only as §5
says; showing it tells people it exists, not that it may be used.

**Depends on it:** `frontend/lib/actions/api.ts` (`latest`), the action page.

---

## 50 · Numbers from a range issued to a party; none without registering

**Clause:** §4 *Numbering*.

**Must say:** a number is given only when a document is registered. Where a
range has been issued to a party for the same start of number, it is drawn
first, lowest range first, until exhausted; then the project counter resumes.
A number already used is skipped, so the two never give the same number.

**Depends on it:** `Numbering.FromRangeAsync`, `number_ranges`.

---

## 51 · Superseded revisions are told to whoever received them; a late review is warned once

**Clause:** §11.8 *Distribution*, §9.4 *Review periods*.

**Must say:** when a revision is superseded, everybody who received the
earlier one is told, and the control function can see who has not been told.
A reviewer who has not answered is warned once, the working day before the
step falls due (the project's working days and time zone). A void revision's
viewable copy is marked VOID on every page, like ON HOLD (§17).

**Depends on it:** `Transmittals/Supersession.cs` (`/exposures/untold`),
`Reviews/ReviewWarnings.cs`, `Stamping.MarkAsync`.

---

## 52 · An administrator who opens a project joins it, on the record

**Clause:** §2 *Roles*.

**Must say:** an administrator not on a project who opens it is added to it
with the administrator function, and the audit trail says so. No one reads a
project without being on it.

**Depends on it:** `POST /api/admin/projects/{id}/join`.

---

## 53 · A discipline that does not answer is escalated

**Clause:** §14.8 *Verification*.

**Must say:** when an action's day has passed with a discipline's documents
missing and nobody of that discipline has confirmed whether the work went
ahead without them, the discipline's people, management and the control
function are all told, once, a number of working days after the day. The
number is the project's (three unless it says otherwise). Nothing is marked on
the action; the notice is the record.

**Depends on it:** `ActionNotices.EscalateAsync`, project setting
`ESCALATE_AFTER_DAYS`.

---

## 54 · Requests, confirmations and answers travel as transmittals, in one thread

**Clause:** §11.1 *Transmittals*, §11.2 *Reasons for issue*. Extends §15 and §45.

**Must say:** a request about the work, its answer, a confirmation sought and
given all travel as transmittals (words alone, the information family), each
answer replying to what it answers, so the thread is the record:

| What | Reason | To | Copied in |
|---|---|---|---|
| A request about an action checked, management's confirmation sought | Request | whoever is asked to confirm | — |
| That request confirmed | Confirmation | whoever asked | the control function |
| Refused, nothing to add, or applied | Answer | whoever asked | the control function, when somebody else settled it |
| An action postponed: whoever plans asked to confirm | Request | whoever plans | the people the action concerns |
| The postponement confirmed | Confirmation | whoever recorded it | the people concerned, the control function |
| The decision taken back | Answer | whoever recorded it, whoever plans | the people concerned |
| A person added to a project, management's confirmation sought | Request | whoever confirms | — |
| The person confirmed, or refused | Confirmation, or Answer | whoever added them | — |

Answering a transmittal one was asked on acknowledges it. Escalation and the
automatic notices about an action stay notices (§53).

**Depends on it:** `Actions/ActionLetters.cs`; `ActivityDecision.TransmittalId`,
`Membership.ConfirmTransmittalId`.

---

## 55 · Organizations working together, each with its own DELIOS

> Added: an organization not on DELIOS may receive our transmittals by email at one address of theirs; only a reply
> to such an email, from that address, comes back, and only as a reply waiting for Document Control to record it
> as received (or set aside with why). Correspondence is never opened to a free project mailbox.


**Before:** another organization took part as a party of ours: its people held accounts we made inside our
organization, or nobody of theirs signed in and one of ours recorded for them.

**Now:** three ways, and a company can move from one to the next without losing anything
(docs/ORGANIZATIONS.md):

- **Collaborator.** It has its own DELIOS organization. We invite it through someone we know there; its
  administrator accepts or refuses, saying why. Its people then work on our projects with their own sign-in:
  each gets an account here standing for them, holding the function we chose for their organization on that
  project, linked to their own. Their administrator chooses who works on our project; we may change the
  function or take them off. Switching someone off at home, or ending the link (either side, with why), stops
  their accounts here at once. What they did stays, under the party we know them by.
- **Guest.** It has no DELIOS. We make accounts for its people inside ours, and close them when the work is done.
- **Not on DELIOS.** Nobody of theirs signs in. It has a code (in document numbers), and one of ours records
  for them, with proof. If it registers later, our party is linked to it, and its people see everything recorded
  for them, under the same code and numbers.

A project belongs to the organization that opened it, and its data stays there. Each project says which
organizations take part, the role each plays, and the function a collaborator's people start with. An
organization that asks for two-step sign-in is entered from elsewhere only by someone who has it turned on at
home. Each organization's administrators see, on its own page, the projects it opened and those it joined, its
people on each, the organizations it works with, and the invitations between them; every invitation, answer and
end is on both organizations' audit trails.

**Depends on it:** `Organizations/` (`OrganizationLink`, `AccountLink`, `ProjectParty`), `User.HomeTenantId`,
`POST /api/auth/switch`.

---

## Still open — decided in conversation, not yet built

- **Every transmittal and every notification also goes by email**, showing what
  the app shows, so there is a double proof: inside the app, and outside by
  email. Built: every notification queues its email (kept in the email log
  with its state, by kind: transmittal, review, notification), and a
  transmittal's email carries the whole transmittal as its page shows it
  (number, project, subject, from, to, copied in, issued for, answer by,
  message, every document with revision and status, the link). Switched off
  until the installation names a mail server. Still to come: an organization
  with nobody on the system receiving it by email directly (today one of ours
  sends it, and the dispatch is recorded).

- **A data transmittal carries a document**, sent or received (the file that came,
  when received from outside); words alone are an information transmittal
  (request, RFI, answer, confirmation). Whether an answer is asked is the
  sender's choice each time, never assumed from the reason.
- **Asset tags are numbered**, as packages are: from their scheme, by default
  project code, TAG and a sequence (P1001-TAG-0001); a tag never changes.
- **Revision naming is the organization's**: schemes of series (letters or
  numbers, with a prefix and a start), a default, and per deliverable type
  another (for example supplier documents P1, P2). A document keeps counting
  the way it began; a series in use is never recounted.
- **A verdict list may be the organization's own** (for example for supplier
  documents): a list says it is verdicts, each value says what it means, and a
  route serving supplier documents decides from it.
- **Phase is document metadata**, and revisions are named per phase: one line
  per phase (letters, numbers, prefix, start) and one default line for a
  phase without its own; each revision keeps the phase it was made in.
- **Verdict lists are made as lists of verdicts**: each verdict states its
  meaning when it is written; a list with no accepting verdict cannot be
  published.
- **Checks are numbered by the system** by what they look at (settings,
  document details, revisions, reviews, storage, schedule, packages), not by
  the standard's clauses.
- **A supplier package can be delivered** like any delivery package.
