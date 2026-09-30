# Changes the Standard needs

Decisions taken while building the application that the **Document Management
Standard v2** does not yet say, or says differently. None of these are screen
design; each is a rule about how information is controlled, so the published
document has to change before the application can claim conformance to it.

Read with `docs/ROLLOUT.md` §6 — *When the Standard changes*: once the document
is republished, `src/lib/checks/rules.ts` and `src/lib/checks/catalog.ts` are
regenerated from it, every spine link whose rule or check moved goes to *review
required*, and a new synchronized baseline is released. Never edit those two
files by hand to match this list.

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

**Configuration:** an organization that wants them separate keeps them separate
— `POLICY_RELEASE` (TOGETHER | SEPARATE). The Standard should state the default
and permit the other, not forbid it (§1.3 *Local configuration*).

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

## 12 · An act the Standard does not name

**Clause:** §11.5 *Receipt*, §11.9 *Acceptance of transmittals*, §11.12 *Time
limits*.

**Telling them again.** Where an addressed recipient has not opened a
transmittal, the control function may notify them again. The day is recorded
against that recipient and in the audit trail. Without this the record was
silent about the commonest failure in distribution: nobody looked.

A transmittal is not closed by hand. Once issued it is the proof that it was
sent, and opening it is the proof it reached the person addressed; what happens
next is a transmittal of its own — an answer, a reply saying what is wrong, an
onward issue to colleagues. Nothing about the first one needs to be ended.

**Depends on it:** `chaseTransmittalAction`; audit act `TRANSMITTAL_CHASED`.

---

## 13 · Acceptance conditions that cannot apply

**Clause:** §11.9 *Acceptance of transmittals*, conditions a–e.

**Must say:** where a transmittal encloses nothing — a clarification, a notice,
an answer in words — the conditions about enclosures are recorded as **not
applicable** rather than left blank or ticked. The record then says why they
were not answered.

**Depends on it:** `acceptanceCheckAction`; the condition list on the
transmittal page, which keeps ✓ / ✗ / — after the check is made.

---

## 14 · Audit acts to add to the record vocabulary

**Clause:** §16.6 *Views*, and wherever the Standard enumerates recorded acts.

`ACTION_CARRIED`, `ACTION_STOPPED`, `TRANSMITTAL_CHASED`.

Each is a decision somebody is answerable for, so each is a recorded act and
each belongs in the project's own log, not only in the administrator's audit
trail.

---

## Still open — decided in conversation, not yet built

- **Escalation** where somebody refuses to acknowledge carrying an action
  without its documents. Agreed to be the Standard's and the DMP's business
  rather than the application's; the Standard should say what happens.
- **Amending a transmittal after issue** — adding a recipient, adding a
  document, resubmitting after a rejection under §11.10. The application
  refuses all three today, and the Standard does not say whether they are
  permitted at all.
