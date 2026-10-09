# One review, many parties — the plan

The model agreed in conversation, written down before any code is changed. It
replaces three ideas that used to be separate — an internal review route, an
external review by transmittal, and an approval — with one idea:

> **A review is a route of steps. A step names who answers. If that party is
> inside our control the step is answered in the app; if it is outside, the step
> travels by transmittal. Every step gives a verdict. One step is the decider.
> Document Control publishes what the decider granted, and may return but never
> decide.**

Everything below follows from that sentence.

---

## 1 · Vocabulary, fixed

| Word | Means | Does not mean |
|---|---|---|
| **Review** | The whole route over one revision, its steps, their verdicts and comments | A single reviewer's opinion |
| **Step** | One party's turn to answer, in order | A transmittal |
| **Verdict** | What a step said, from that step's published set | The release |
| **Advice** | What an advisory step's comments amount to; derived, never chosen | A verdict |
| **Grant** | The deciding step naming the status the revision will carry | Publication |
| **Publish (release)** | Document Control applying the granted status, superseding, making current | Approval |
| **Issue** | Handing a published revision to a party, by transmittal, with a reason | Release |
| **Return** | Document Control handing a revision back with a reason | A verdict |
| **Condition** | A reservation attached to a verdict, with what closes it | A blocking comment |

"Approval" disappears as a separate act: it is a verdict at the deciding step.

## 2 · What each record holds

### Route step (template)

| Field | Purpose |
|---|---|
| `holderKind` | `FUNCTION` (internal) or `PARTY` (external) |
| `holderRef` | The function code, or the party id |
| `act` | `ADVISE` · `DECIDE` · `CONTROL` (a Document Control check) |
| `outcomeSetKey` | The verdict set this step answers from |
| `handsOnStatus` | The status the revision carries once this step completes (`IFR`, `IFA`…) |
| `grantsStatus` | Only on the deciding step: the statuses it may grant |
| `mayCondition` | Whether this step's verdicts may carry conditions |
| `evidence` | `NONE` · `OPTIONAL` · `REQUIRED` — a returned stamped copy |
| `days` | Working days allowed, for the at-risk and overdue marks |

A template already matches on deliverable type, document type, discipline and
criticality. **Add originator to the match**, so "supplier document we produced"
and "supplier document we did not" can route differently — the only difference
between two of the worked examples.

### Review cycle step (run)

Holds the answer: verdict, verdict set, who gave it, when, note, evidence file,
the transmittal that carried it (if external), and who recorded it when the
party is not a user here.

### Condition

| Field | Purpose |
|---|---|
| `cycleStepId` | Who set it |
| `text` | What the reservation says |
| `closedBy` | `STEP` (another party's answer) or `REVISION` (a change) |
| `closesWithStepId` | When `STEP`: which step's approval closes it |
| `status` | `OPEN` · `CLOSED` |
| `closedAt`, `closedByName` | Evidence of closure |

Release is blocked while any condition is open, on the same rule as an open
blocking comment — one gate, not two.

### Revision

| Field | Purpose |
|---|---|
| `workingValue` | The internal label: `A`, `B`… or `P01`, `EN01` |
| `issueValue` | The external label, empty until first issued outside |
| `sequence` | Integer. Order is decided by this, never by comparing labels |

Series never reset. A revision scheme, routed by deliverable type, defines both
series, when the crossover happens (publication at an external status, or first
outgoing transmittal), and what a rejected issue does — increment, suffix `R`,
or decimal.

### Status properties

| Property | Purpose |
|---|---|
| `audience` | `INTERNAL` or `EXTERNAL` |
| `needsIssueRevision` | Publishing at this status assigns or increments the issue label |
| `permitsExecution` | Already exists; unchanged |
| `proposableBy` | Which act may hand on at this status |
| `grantableBy` | Which act may grant it |

### Party participation — how an external step is actually answered

A party outside our control takes part in one of two ways, and the choice is a
property of the party rather than of each step:

| Field on the party | Values |
|---|---|
| `participation` | `IN_APP` — they hold guest accounts and answer here · `BY_PROXY` — one of our people carries the exchange and records their answer |
| `custodianFunction` | Who carries it: Document Control, procurement, engineering |
| `externalSystem` | The name of their own EDMS or portal, where they impose one |
| `evidenceRequired` | Whether a recorded answer must carry its proof. Default true for proxy |

There is deliberately no email gateway. Sending from the system would invite
"I sent it by email", which puts half the exchange in private inboxes, loses the
trail, and leaves Document Control as the only party still inside the process.

A proxy step does not change the route. The **answer** belongs to the party; the
**work** belongs to the custodian, whose queue shows one task with two acts:

1. **Dispatch** — export the package (cover sheet, enclosures, revision labels),
   send it by whatever channel that party insists on, then record the date, the
   channel, their reference (their transmittal number or portal submission id)
   and the evidence.
2. **Record answer** — the verdict from that step's set, their comments, their
   stamped copy, their own code as they wrote it, and the evidence.

The clock runs from dispatch. The step has a holder, a date and an age, so it
appears in queues and carries at-risk and overdue marks like any other.

Their codes are kept as they wrote them (`foreignOutcome`, with its label), with
an optional per-party mapping to our verdict set so the gates still work. Our
verdict is never overwritten by theirs; both are shown.

### Party reference (the perspective problem)

One row per document per party: **their** number, **their** revision, **their**
status. Shown as optional register columns, quoted on transmittals beside ours,
searchable. The same table answers "what does the client call this".

A transmittal gains the mirror of it: **their transmittal number** and the
portal submission reference, so an exchange that happened in someone else's
system is provable in ours.

### Project

`ourRole` — which party we are on this project. It changes no mechanism; it
chooses defaults: which templates are offered, which direction is busy, whether
our decisions publish or submit.

## 2b · Who we are, who authored, what we trust

### Our role as a preset, never as a rule

A project records which party we are. The role does not change any mechanism; it
chooses the starting configuration — which route templates ship, who holds
upload permission, whether a control step exists, and the default mode for
counterparties. The permission matrix decides everything after day one, so a
project that does not match its preset simply edits it.

| Our role | Creates and uploads | Reviews | Decides status | Control function | Exchange carried by |
|---|---|---|---|---|---|
| Client / owner | Rarely | Yes | Yes, the final grant | Yes | Document Control |
| Owner's engineer / PMC | Rarely | Yes | Advises; sometimes decides | Yes | Document Control |
| EPC / main contractor | Engineering authors; Document Control may upload | Yes | Internally; the client grants the final status | Yes | Document Control |
| Subcontractor | As above, smaller | Yes | Internally only | Often | Document Control or the liaison |
| Supplier / vendor | Their engineering | A light internal check | No — the client grants | Usually none | The liaison |
| Architect | Authors and uploads their own | Yes | Design authority | None | Themselves |
| Design office / consultant | Authors and uploads their own | Yes | For design | None | Themselves |
| Control office / inspection body | Never creates | Stamps | Statutory approval | None | Themselves |

### Author and uploader are two different people

Every revision records both:

- `authoredBy` — the party and the person answerable for the content. Required.
- `uploadedBy` — whoever placed the file.

This is what makes "Document Control uploaded it" safe in the organizations where
that is the norm. The record says the content belongs to mechanical engineering
and the file was placed by Document Control, so the question *with whom does this
document lie* is answered by a field rather than by an argument. The same split
covers a recorded external answer: the party is the author, the liaison is the
recorder.

### Who may create a document

The **originator** creates the document or its placeholder. They hold the
original, they know its purpose, and they own its metadata — and the effort of
creating it is the same as the effort of asking somebody else to.

Document Control may create one only on **recorded authority**: an official
email, a transmittal, or an approved list already in the register. That source is
attached to the document as evidence. The exception stays auditable, and nobody
has to remember who asked for what.

### Nothing external is trusted until one of ours confirms it

A document that arrives from another party carries *their* number, *their*
revision and *their* title. That is a claim, not a fact. Intake is therefore two
checks with different owners:

| Check | Owner | Question |
|---|---|---|
| Acceptance | Document Control | Are the items present, readable, correctly numbered, in the right formats? |
| Verification | The discipline authority | Is this the document we expected, and is it the revision it claims to be? |

Until verification passes, the revision is **unverified**: stored, visible and
searchable, but it cannot be routed, issued, or used as the basis for anything.
The verifier is named on the record with the date.

### Exchange by sheet

Recording an external answer by hand is fine for ten documents and useless for
three hundred. Where a counterparty works in their own system, or where neither
side will adopt the other's, the exchange medium is a sheet, and it runs in both
directions.

**Out.** We generate it: one row per document-revision on the transmittal —
our number, revision, title, status, our transmittal number, the date sent —
followed by empty columns for them: their number, their revision, their code,
their date, their comments.

**In.** We import either their own register export or our sheet filled back.

**Mapping profile, per party.** Their column headings to our fields, saved once
and reused, so a counterparty renaming a column costs a minute rather than a
re-import.

**Matching**, in this order: our document number and revision; then their number
as already held in the cross-reference; then the transmittal number and line. A
row that matches nothing is listed as unmatched and never guessed at.

**What an import may write**, and nothing else:

- their number, their revision, their status;
- their verdict, its date and their comments — recorded as that party's answer on
  the open external step;
- their submission reference and their own due date.

It may never write our number, our revision, our status or our verdict.

**How an import runs.** A dry run first, which reports matched rows, new
cross-references, verdicts to be recorded, unmatched rows and conflicts — a code
that changed, a revision that moved. Nothing is applied until that is read. The
file itself is stored as evidence and hashed; the party is the author of every
answer it carries, and the person who imported it is the recorder.

**Repeatable.** Re-importing weekly produces a reconciliation report of drift:
their revision moved, their code changed, a document missing from their side.
One mechanism serves every counterparty, with no bespoke integration per
client.

## 3 · Gates and checks

**Gates** refuse an act at the moment it is attempted:

- A deciding step cannot be submitted without the status it grants.
- A granted status must be compatible with the rest of the route: an
  internal-only status with external steps still ahead is refused, in words.
- Publication is refused while a blocking comment or a condition is open.
- Publication at an external status assigns the issue label.
- Issue outside is refused while the status is "to be", and refused for a
  revision whose status is internal-only.
- A revision that already carries an issue label cannot be re-published at an
  internal-only status; that needs a new revision.

**Checks** find records that already exist and disagree — owned, dated, listed
with the other conformance defects:

- Revision and status disagree.
- Issued outside with no issue label.
- Issue label spent but nothing was ever transmitted.
- External answer recorded on behalf with no evidence attached.
- Conditional verdict with no closing condition named.
- Unverified revision that has been routed or issued.
- Document created by Document Control with no recorded authority attached.
- Imported record whose revision or status no longer matches the counterparty's.

## 4 · Stamps and signatures — what is universal, what is an organization's choice

Three different things, often confused:

1. **The system's own stamp on the rendition at publication** — status, revision,
   date, document number. Near-universal practice, applied by us, not a
   signature. Keep it on by default; let an organization turn it off.
2. **A qualified electronic signature on an internal decision** — not required by
   the fact of reviewing. The controlled record (identity, timestamp, audit
   trail, access control) is the evidence in most quality systems. Required only
   where a regulator, a client contract or a licensing rule says so: a licensed
   engineer's seal, a permit submission, a regulated industry. So: an
   organization's choice, configured per step.
3. **A returned stamped copy from an external party** — the other party's own
   process produces it, and we cannot refuse it. Default `REQUIRED` on external
   steps, because without it the only thing behind their verdict is our word.

The returned copy is **evidence filed against the revision**. It never becomes
the controlled copy, never supersedes the rendition, and is never redistributed
as the document.

## 5 · Party roles — the taxonomy `ourRole` picks from

Broad enough for energy, industrial, EPC and building work, and the same list
serves the parties we deal with:

- **Owner / Client** — commissions the work, usually grants the final status
- **Operator** — will run the asset; often reviews for operability
- **PMC / Owner's engineer** — manages the project for the owner
- **EPC contractor** — engineering, procurement and construction under one
  contract
- **EPCM** — the same without construction execution
- **Engineering consultant / design office** — produces or checks design
- **Architect** — design authority on building work
- **Main contractor** — builds, and reviews what subcontractors send
- **Subcontractor** — a trade under the main contractor
- **Supplier / vendor** — supplies equipment and its documents
- **Fabricator** — makes to our drawings; returns as-builts and certificates
- **Inspection body / third-party inspector** — witnesses and certifies
- **Control office (bureau de contrôle)** — statutory technical control
- **Certification body** — certifies systems or products
- **Authority / regulator** — permits and approvals
- **Commissioning agent** — accepts systems into service
- **Testing laboratory** — issues test records
- **Insurer** — reviews risk-bearing design

Each is a `Party` with a code, internal or not. `ourRole` on a project is one of
them. Nothing else in the model depends on which.

## 6 · Build order

Each stage leaves the system working and says what it makes possible.

**Stage 1 — external steps.** Route steps may name a party; a step that crosses
a boundary raises its transmittal, links both ways, and accepts a returned
verdict with evidence. Party participation (`IN_APP` or `BY_PROXY`), the
custodian's dispatch-and-record task, and the export package that the custodian
sends.
*Makes possible:* the three worked examples, end to end, without spreadsheets —
including the case where the other party refuses to use this system at all.

**Stage 1b — exchange by sheet.** The generated sheet, the per-party mapping
profile, the dry run and its report, and the weekly reconciliation.
*Makes possible:* the same flow at three hundred documents as at ten, which is
the difference between a process that is used and one that is abandoned.

**Stage 2 — verdicts per step, statuses that move. Built.** Each step answers
from its own set; the deciding step grants; steps hand on at a status; Document
Control publishes and may return. "To be X" shown everywhere, and nothing "to
be" may be issued.
*Makes possible:* everyone stamps, one decider, and the control gate is real.

What it turned out to be, in the built system:

- **A status says who may put a revision at it.** Two properties on every
  published status, in Value sets: who it is for (inside, or outside as well),
  and whose choice fixes it at publication. An outside status defaults to
  Document Control, because it is the other organization's answer that makes it
  true.
- **There are no intermediate statuses.** A revision has a status only once
  Document Control publishes one. Where it stands while a route runs is the
  route's business — the register says "in review, step 2 of 3" more precisely
  than IFA ever could — and why it goes out is the reason for issue on the
  transmittal that carries it. An intermediate status was a second way of saying
  both, shaped like the thing it was not, so a reader could take it for a
  release. It was built, seen to be wrong, and removed.
- **One "to be", one meaning.** The status the deciding step settled on, which
  Document Control has not published. It prints as one amber unit, qualifier and
  code in the same weight, in the register, on the document and on the review.
  Nothing may be issued at it — the issue gate refuses anything not released.
- **The deciding step may be narrowed** to some of the statuses, and that
  narrowing is copied onto the step when it opens, so an answer is judged
  against what was asked rather than against the route as edited since.
- **Each step answers from its own set, and that is one select, not two.** An
  advisory step's answer is read off its comments, so it has nothing to choose;
  the deciding step answers from the route's verdict list. A per-step verdict
  list would have been a second place to say the same thing.
- **The gate refuses.** Document Control publishes at what was decided, or —
  when the status is one it fixes — at what the answer turned out to be; and in
  either case it may send the revision back with a reason, which authorizes the
  next revision.

**Stage 2b — the decision says what happens next. Built.** The deciding step,
having settled what the revision is for, also says who needs it: our own people
(the distribution matrix proposes them), other organizations, and whoever it is
transmitted to for approval — or it delegates the choice to the author. Document
Control reads that at the gate, publishes, and the transmittals are raised from
it rather than retyped. A project that wants no gate sets *After the deciding
step* to "Nobody" in the Document Management Plan, and the decision releases and
issues on the spot.
*Makes possible:* one act instead of three, and a Document Control gate that is
a check rather than a re-entry desk.

**Stage 2c — issuing is asked for. Built.** Releasing a revision and telling
people about it are two acts. The first is Document Control's own and needs
nobody's permission; the second needs a request, always.

- **Anybody with standing asks** — whoever wrote the revision, uploaded it,
  started its review or sat on one of its steps — at any time, as often as the
  work needs. Two asks are two requests: issue it to the site team now, ask the
  client to price it next week.
- **A request carries a reason for issue**, from the published set, because what
  is wanted of a recipient is that reason and not a second question.
- **The deciding step is offered the first one**, with *ask for it to be issued
  now* ticked, because whoever settles what a revision is for is the likeliest
  to know who needs it. Unticking it is an answer: the decision stands and
  nobody is told.
- **Delegating tells the author**, and that is all it does: a notification, not
  an obligation.
- **Whether there is a control stage is not a setting.** It is whether anybody
  holds the control function on the project. Somebody holds it: they receive,
  release and send. Nobody holds it: those acts belong to the people doing the
  work — the deciding step releases, and whoever asked for a revision to go out
  sends it themselves. Two settings that asked the same question in workflow
  words were built, seen to be a second place to say it, and removed.
  Administrators configure the app and leave; the project says what it is.
- **A released revision nobody asked about is stamped Not issued** beside its
  number and in the register. It is in use and usable; nobody has been told,
  including anyone whose approval it may still need, and the responsibility for
  that sits with whoever did not ask.

**Every route ends at the control function.** Whatever the deciding step
answered — accepted, accepted with comments, revise, rejected — the revision
reaches the control function, which does its last checks and releases it at what
it is good for. Nothing is stuck in review, and nothing is decided twice.

What happens next is the people's, on their own calendar: start the next
revision, ask for it to be issued, ask an outside organization to approve it, or
ask the control function to void the revision or withdraw its approval. Everyone
who sat on the route is told as each step answers, so they know when to ask.

**Document Control's check is not a review verdict, and a fault in the
submission keeps its revision.** (Agreed later; it refines the paragraph below.)
A verdict is about what the document says; Document Control's check is about
whether what was sent is in order: the template, the number in the title block,
the right file. Its outcomes are their own published set (accepted, returned to
sender, returned to initiator, returned for a new revision, released), recorded
in their own column, and each says whether what it returns needs a new revision.

- **On arrival.** What another organization sends in is accepted by Document
  Control before anybody reviews it. Refused, it is returned to the sender, who
  sends corrected files under the same revision.
- **At the gate, whatever the verdict.** A fault Document Control finds in the
  submission sends it back for correction under the same revision: to our
  initiator, or to the organization that sent it. The corrected files come in,
  and the route runs again from the start.
- **A verdict that asked for changes** always needs a new revision, because what
  the document says must change; Document Control sends it back with that verdict.
- **Nothing is overwritten.** A revision holds its submissions in order; the
  returned one is kept with the outcome and the reason, and the register shows
  the same revision value throughout.

**A revision ends released or returned, and a returned one is replaced, never
corrected.** It keeps what was submitted and what was said about it, and the
verdict that asked for changes authorizes the next revision. Editing it in place
would erase the thing the record exists for — "what did we submit in March, and
what did they say" has to stay answerable.

**Sending a revision back to a step is a different act, and it is guarded.** It
is for a fault in the *route* — the wrong file attached, a step seated with the
wrong people, an answer recorded against the wrong step — where the same
revision going round again is honest because the revision was never the problem.
It needs one of the published **reasons to send a revision back to a step**,
which is a value set like any other: the organization decides what counts, and
adds, edits or retires them. Without one the app refuses, so the ordinary way
back stays "to the author, and the next revision replaces it".

**Whoever holds the open step may rewind it too, and only backwards.** A
reviewer who opens the wrong file would otherwise have to answer on a document
they know is wrong. They may send the route back to a step that has already
answered, never forward and never to one still waiting, with a published reason
and words of their own; everyone on the route is told, with their name. Nobody's
verdict is quietly undone, and a rewind used as a do-over is visible rather than
prevented.

**The control function has two acts there, and which it may take depends on the
verdict.** A final verdict — accepted, accepted with comments — can be released:
the status goes in force and the previous revision is superseded. A verdict that
asks for changes cannot, because releasing it would supersede the revision people
are working from and replace it with the one just rejected. Then the only act is
to send it back, and the control function says where to: any step of its route,
which picks up from there, or its author, who prepares the next revision.
Everyone who was on the route is told either way.

Two consequences, both removals:

- **A comment never holds a release.** The decider decides; comments are what
  they decided on, and what the next revision answers. The gate that refused to
  release while a blocking comment was open is gone — it was a second decision,
  taken by nobody.
- **Voiding a revision and withdrawing an approval are the control function's
  acts.** Anybody who thinks one is needed asks, and the reason on the record
  says who asked.

Where a project has no control function, the release step does not exist: the
deciding step releases, and the same people ask each other directly.

**Stage 3 — conditions. Built, except the scoped second round.** A condition is
not a second kind of record: it is a comment that stops the release, with one
more thing said about it — what settles it.

- **The next revision**, which is what most reservations mean and the default.
- **A later step of the same route.** "Approved, under reserve of the architect"
  is that: the comment names the architect's step, and when that step answers,
  the comment closes itself. The revision does not go round again for it, and
  the record says who settled it and when.
- **The release gate is unchanged**, because there was never a second one: a
  revision with an open blocking comment cannot be released, whatever the
  verdict says. A condition is one of those comments.

**A second round is a whole round.** A revision that comes back is replaced by
the next one, and the next one goes down the route from the start — every step,
including the ones that had nothing to say last time. A route sent to some of
its steps is a different route, and the record would no longer say what it says
now: that these people, in this order, looked at this revision.

**Stage 4 — revision series.** Working and issue labels, the sequence integer,
the revision scheme, and the backfill of existing revisions.
*Makes possible:* history that reads honestly — how many internal attempts, how
many issues.

**Stage 5 — perspective.** `ourRole`, party references beside our numbers,
foreign transmittal numbers and portal references, and the register columns that
show them.
*Makes possible:* a contractor keeping its own register beside the owner's
portal without losing traceability.

**Nothing is reviewed that nobody can read. Built.** A route cannot start on a
revision with no file attached, and a revision cannot be released without a
rendition. The gate is at the moment the route starts, not at the end, because
a verdict given on an empty revision is worth less than no verdict at all.

**A revision with no review is voided, not replaced quietly. Built.** A revision
that was opened, left, and is now in the way of the next one can be voided by the
control function, which says it never counted — which is the truth. Voiding what
was issued stays the approving authority's decision; voiding something nobody
ever looked at is housekeeping.

**What the control function has waiting is on Home, not a page of its own.
Built.** Home is the work queue, and this is a kind of waiting work like any
other — it does not deserve a place in the menu beside the five jobs.

Home now has tabs, built from what this person actually has, so nobody reads a
row of empty headings. *All* is the overview: every group, the first few of each,
with a count, how long the oldest has waited, and *see all* when there are more.
A tab is one kind of work in full, grouped by how long it has been waiting —
today, yesterday, earlier this week, older — because a queue is read by age: the
question is never "what is here" but "what has been here too long".

Two of those groups are the control function's: **Ready to release**, and **Send
back** for a decision that asked for changes, which is not a decision to take but
a chore holding the author up. A third, **Released, never sent**, is nobody's
decision at all — whoever needed it sent did not ask, and this is where that
stops being invisible.

**Stage 6b — a revision always carries a review.** It is impossible for a
revision to exist without at least one review: a revision nobody ever looked at
is not a revision, it is a draft. A revision that reaches the end of its life
with no review is voided before the next one starts, and the standing checks
name any that slipped through.
*Makes possible:* a register where "no review" is never the answer.

**Stage 6 — the net.** The standing checks, the "waiting on Document Control"
queue with its age, and the reports that measure each step's duration.
*Makes possible:* finding what slipped, and proving where time went.

## 7 · Decisions taken

1. **An external approval raises the status of the same revision.** The client
   stamps issue `01` at "to be AFC"; we publish `AFC`; it is still `01`. A new
   revision is required only when a reviewer asks for a change.
2. **A revision series never resets.** Both the internal and the issue series run
   for the life of the document, so the history reads as what actually happened.
3. **A rejected issue increments the issue series.** `01` rejected, reworked,
   re-issued as `02`. No `R` suffix, no decimal — one rule, nothing to parse.
4. **Document Control is a gate by default, and may be drawn as a step.** The gate
   exists in every route; an organization that wants the wait measured adds the
   step to its own templates. Their choice, not ours.
5. **One revision in motion at a time.** A document has exactly one revision
   being prepared or reviewed. The next one starts when that one is released or
   sent back. Two at once would be two answers to the same question, and the
   register could not say which revision the document is at.
6. **Only the newest revision can be acted on.** Withdrawing an approval and
   voiding are offered on the newest revision and nowhere else. Everything before
   it is frozen as it was issued: a change there would alter a record somebody
   already worked from, and would change nothing anybody works from now.
7. **No electronic signature by default.** A route step may be configured to
   require one, and the system's own stamp on the rendition at publication stays
   on regardless.
