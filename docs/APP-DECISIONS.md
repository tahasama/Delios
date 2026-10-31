# Decisions about the application, not the Standard

Taken out of `docs/STANDARD-CHANGES.md` (owner: "whatever does not concern the DMS, but only the app, should not be
there"). These are about how DELIOS is built and drawn: its two levels of settings, its organizations' accounts and
links, sign-in, storage, screens and code names. They change nothing in the Document Management Standard. The rules
the app follows today are in `CLAUDE.md`; this file keeps what the Standard-changes file used to say about them.

## Sections moved whole (their old numbers kept)

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

---

## 49 · A needed document is shown whatever its state

**Clause:** §14.3 *Baseline entries*. Extends §5.

**Must say:** a document an action needs is listed from the register whatever
its state — placeholder, in review, released, released and issued — with that
state shown in the organization's own words. It counts as ready only as §5
says; showing it tells people it exists, not that it may be used.

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

---

## 62 · Verdicts are one list, its sets serving deliverable types

- **One list of verdicts** (Review outcomes), kept where every list is kept; what were separate verdict lists are its
  sets. A set names the deliverable types it serves, as any set does; a code is never repeated in the list.
- **Each verdict states its meaning** (accepted, accepted with comments, rejected, for information) when it is
  written, and every set in use keeps one that lets a revision be released.
- **A review decides with the set serving its document's deliverable type**, unless its route names another; a route
  naming a set that does not serve its documents is warned of, never refused. The review keeps the set it was offered.

## 64 · Two levels of settings: what a project may change is the organization's choice

- **The organization's settings are the default of every project**: what the app gives, adapted by the organization.
- **For each setting the organization decides, once, whether projects may change it**: fixed (every project uses the
  organization's) or free (a project keeps its own version, which later changes of the organization never touch).
- **What stays the same across projects by default is what other things depend on**: numbering, revision naming,
  what verdicts, statuses and reasons mean, classification and keeping, functions and their rights; what is the
  project's own work (its sub-projects, orders, routes, forms, who does what) is free.
- **Making a setting fixed later undoes nothing** a project already changed: what a project changed is never
  overridden by the organization.
- **What each function may do may be the project's own** where the organization leaves it free (the functions
  themselves stay the organization's, and so does the right to configure).
- **Only a reset, from the organization's settings, puts a project back on the organization's**, for a mess, with why,
  its control function told; **what the project held is kept**, and may be put back on it, with why.
- **Lists are decided one by one**: each list has its own switch, and a project copies only the list it changes,
  where the organization leaves it free; a list the organization keeps fixed is the same on every project. Lists that
  describe projects themselves (their type, our role) are always the organization's.
- **Forms are decided the same way, form by form**: one switch for all of them; a project copies only the form it
  changes, where free. Opening a project and adding an organization are the organization's acts: their forms are
  always the organization's.

## 66 · Organizations link by themselves once proven, never on their word

- **The Standard assumes every party is on the same system.** In practice another organization works with us in one
  of three ways: from its own DELIOS, through accounts we make for it, or not on DELIOS at all (one of ours records for
  it). Nobody is forced to register.
- **When an organization we recorded joins DELIOS and proves it is the one recorded** (its guest's email link, the
  word of whoever recorded it, an agreed merge, or a guest making their own DELIOS with the account made for them),
  every organization that recorded it is linked with it at once, and the accounts made for its people move to it:
  same sign-in, now from home, everything they did kept. Nobody is invited or asked; the host's administrators are told.

## 67 · How the project works, on two levels

- **The Control room's answers** (who carries each act out, how releasing, stamping, readiness and the matrix work, the
  risk window, escalation) follow the same two levels: where the organization keeps an answer fixed, a project reads it
  and cannot change it; where free, the project chooses. A project keeps the answers it already held when an answer is
  made fixed later.
- **Functions are the organization's; what each may do is each project's by default** (owner): a project's control
  function changes it there, for every function, its first change taking its own copy. The organization may make it
  Fixed. Configure, the administrators' permission, is never given or taken on a project.

## 71 · What each function may do, said in one place

A function's permissions are read and changed in one place: the grid (a permission on every document) and, opened
from the function's name, every rule it holds for certain documents only, each named by its field ("Discipline Civil").
What each permission allows is always written under the grid, never left to a hover. A function's name may be
corrected; its code never changes. A function has no department of its own (the field shown before was never kept).

A project changes what each function may do by default; the organization may fix it for all. Configure, the
administrators' permission, is given and taken only in the organization's Settings.

## 73 · A person's email is proven before it counts

An email given to someone by an administrator counts only once its owner opens a link sent to that address; until
then the account keeps the email it had, which is told of the change. Sign-in by the organization's own account
matches people by email, so an unproven address would let in, or shut out, the wrong person.

## 76 · What a project starts with, and what it may change, said in one place each

The Standard has each project write down how it works. In DELIOS the organization says it once for every project:
its Control room is the same console as a project's, every step with its answers, and is what a new project starts
with (Defaults for new projects, a page of its own with the whole form). A second page, What projects may change,
lists every setting with one switch each: Fixed, every project uses the organization's as it is; Free, a project may
take its own copy, which the organization's later changes never touch. Making a setting fixed later never undoes
what a project already changed. A project already open keeps its own answers when the defaults change, and goes
back to them only by its own "Back to the defaults". What only a project knows (who acts as its control function, its
schedule's days, how its suppliers send) stays the project's.

## 77 · Fixed, except on the projects named; what one project changed, read in one place

A setting the organization keeps fixed may still be left free on one project, when that project needs something
special (owner: both ways at once were dangerous or messy: freeing it for every project to help one, or changing a
project's copy from two places). An administrator names the project on the setting's switch, always with why; the
project's control function is told, and only that project may then take its own copy. Ending it is also with why:
what the project changed stays, as when a setting is made fixed later. An exception counts only while the setting is
fixed; the switch, the Control room's answers and every change a project makes read it the same way.

The organization's Settings also read one project against the organization's: choose a project, and every card it
keeps its own copy of (since when, by whom, which lists or forms), the Control room and stamp answers it changed, and
the exceptions it holds are listed, each opening the organization's card where it is put back or ended. Nothing is
changed there: a project's settings are changed in that project's Settings, by its control function.

## 78 · The days around an action on two levels; the organization's defaults keep a copy when replaced

How many days before an action's day a document is needed, and from how many days before it a missing document puts
the action at risk, are the organization's first: every project reads them as they stand, and keeps its own only where
the organization leaves it free (one switch each). A project may set its own before its schedule is named, sees the
organization's beside its own, and may follow the organization's again. The requirements list may still give a document
its own window.

Replacing the organization's defaults for new projects as a whole, taken from a project or back to the app's own, asks
why and keeps what they held first, as a project's reset keeps its copy. Each kept copy is listed with when, by whom and
why, and may be put back, with why; what stands then is kept in its turn. Nothing of the defaults is lost.

## 79 · Who keeps the organization, and what single sign-on trusts

The Standard says who administers the system; it does not say what a project role may reach beyond its project. DELIOS now
holds these, after a security review:

- **The organization's people, organizations and settings are kept by our own people only.** An account standing for
  someone of another organization's DELIOS, or one we made for another organization's people, never counts as an
  administrator, the control function or a Manage holder for the organization's pages, whatever function it holds on a
  project (`Keepers.OursAsync`).
- **A function that may configure makes its holders administrators**, so only an administrator gives it: putting someone
  on a project with it, changing their function to it, or asking for someone to join with it is refused otherwise
  (ADMIN_ONLY, `Keepers.FunctionConfiguresAsync`).
- **Nobody sets another person's password but an administrator** (creating an account or changing one); everyone else
  invites, and the person chooses their own from the link. When an administrator sets one (the organization's People,
  "Set a password"), the person is told at once by email and on Notifications and signed out everywhere; it is logged
  (PASSWORD_SET). Never one's own: that goes by "Forgot password", which proves the email.
- **Single sign-on trusts an email only as far as it is proven:** with email domains set on the organization's account,
  the provider's account names count, at those domains only; with none, only an email the provider says it verified.
  An account standing for someone of another organization is never entered by single sign-on.
- After signing in, the page asked for is only a path on this site (never `//…`, `/\…` or a control character).

## 83 · How the files themselves are protected

The Standard asks that controlled information be kept safe; it says nothing of the files' bytes once stored.

- **Every file is kept encrypted**, with a key kept apart from the files and their copies (owner: "those files should
  be PROTECTED"): whoever takes the disk, the store or a backup reads nothing. The key is the organization's to keep
  safe: lost, the files cannot be read again.
- **Nobody reaches a file but through the app**, which checks who asks every time; no link to the store is ever given.
- **The backup copy is out of the app's reach**: a copier of its own makes it, as each file is stored, and nothing that
  breaks into the app can change or wipe it. In production it goes to another place, under a key that may add and
  never delete.
- **A file that cannot be checked for viruses is refused, never kept as clean** (owner: "refuse them with
  explanation"): locked by a password, or holding more than the check opens. The sender is told why, and sends it again
  without the password, or in parts.
- **Every download is recorded, whatever the organization keeps about reading**, and the administrators are told when
  one person takes more than 200 files in an hour (owner).
- **What opens drawings and office files is shut in**: on a network of its own, it reaches neither the register, the
  store nor the internet.

## 84 · A training space per organization (decided, not built)

The owner (31 Oct 2026): "we should have a sand box for trainees too"; then "the training is per organisation as they
mostly work the same way for all projects, and customization of the later would never be 100% different from it".

- **One training space per organization**, never one per trainee and never one per project: an organization works the
  same way on all its projects, and a project's own changes never stray far from the organization's settings, so one
  space set up the organization's way teaches what every project does.
- **Everything can be tried there**: register documents, send them for review and decide, release, send transmittals,
  and **make made-up organizations for the different roles** (a client, a supplier, a contractor…) to try working with
  others, all without touching a real project.
- **It follows the organization's settings live** (owner): what the organization changes, the training space reads at
  once, as a project that changed nothing does.
- **It can be wiped and started again**, by whoever has the authority (owner): the one exception to "nothing is deleted
  but by the app owner", because nothing in it is real.
- **Its people never count towards the plan's users** (owner: "agreed").
- **Kept apart from the real work** (owner: "search and audit trail are by project"): it is a project of its own, so the
  register, search, reports and a project's trail are already apart. What spans projects must leave it out: the
  organization's whole audit trail and whole full download, the projects' figures, the organization's list of
  organizations and the names and codes reserved across DELIOS (made-up organizations must not take a real company's
  code or name), and email (nothing in it is sent outside the app).
- Still to settle: who wipes it, and the code that marks a project as the training space.

## Passages taken out of sections that stay in the Standard-changes file

**From §27:**

The plan is a document, not a setting: it changes nothing, so it is read under
Assurance, beside the statement of conformance, never among the settings. A
project states its scope once (This project), and how it is measured once
(Assurance: the share of clear documents it aims at; the checks run by
themselves every day). There is no separate
register of exceptions

**From §56:**

A person
added from a list, or by anyone, never has a password chosen for them: they are emailed a link to choose their own
(good for 7 days, once); where email is off, the link is handed to whoever added them. Joining still waits for
management where the project asks for it (People to confirm).

**From §56:**

the row the person sees (sheet and row), what writing it would do, with the same rules as registering one by one
(the backend's own check, `POST /documents/check`).

**From §59:**

- Everyone on a project reads its directory: the organizations taking part and their people.

**From §59:**

- The Standard speaks of "Document Control" as a department. DELIOS names no function

**From §60:**

Settings are kept at two levels: the organization's (its projects, opened, archived and reopened there) and
  each project's.

**From §60:**

- Beside its name, an organization carries an identifier with its country: its company registration, else its tax
  number, else its number on a professional register, else a public body's own; or why it has none. A name can be
  spelled ten ways; an identifier cannot. Before one is created, those that look like it are named, and the person
  says whether it is one of them. An organization joining DELIOS proves its email domain and claims what others made for
  it; duplicates are merged with every side's agreement, never deleted.

**From §60:**

- The Standard makes codes unique within one register. DELIOS keeps them unique across every organization on it, and
  never reuses one:

**From §61:**

- Only whoever acts as the control function on the project changes its lists; a project with none leaves it to
  whoever opened it, and nobody else.
- A list holds sets. Each set names the deliverable types it serves; the default set serves every other type, so a
  document always finds exactly one set of each list, and two sets switched on never serve the same type. This is how
  supplier documents get their own document types, criticality levels or review outcomes without a second list.

**From §63:**

- **A list the project creates is a field of the document** by that alone, offered for each deliverable type from the
  set serving it, and read, filtered and shown like the app's own fields.

**From §65:**

- **Turning a scheme off for a deliverable type stops registering that type** until a scheme is chosen again; records
  (transmittals, reviews, packages, actions, tags) fall back to a short form instead.

**From §68:**

Either way their number is kept beside ours, one to one
  (`number_equivalents`, `Documents/Equivalents.cs`), the register finds it under both,

**From §68:**

Chosen by an administrator or the control function,
  with what they are filed under (deliverable type, document type, discipline) and a warning read and ticked.

**From §68:**

once the
  check accepts it, it is in the register exactly so (`Document.AsReceived`, `Revision.TheirStatus` / `TheirOutcome`,
  series `AS_RECEIVED`); returned, nothing is registered. Their next revision replaces the one before that we never
  took further; we never start one of our own on it (AS_RECEIVED). A red warning says, wherever it shows (package,
  transmittal, document, register stamp "as received", Control room): numbering,

**From §68:**

**What we built (owner):**

**From §72:**

A function's opened card shows only
its rules for certain documents; on every document is said by the grid's ticks alone.

**From §74:**

, written on the one New transmittal form. What the ask fixes is
filled in and shown, never chosen, so it cannot be got wrong:

**From §74:**

The request then names its decision for whoever is asked ("Confirm", "Refuse", "Add it", "Nothing to add",
"Confirm the postponement", "Deliver it as it stands"), each leading to the place where it is taken (the action, People
to confirm, the package), already chosen, because the decision needs what is known there.

**From §75:**

It is set in one place, the same for every document: the
organization's card is every project's default, and a project changes its own where the organization leaves it free.
The card says whether PDFs are stamped at all;

**From §75:**

the words at its foot;
the corner it sits in (top right by default); and how large it is drawn.

**From §75:**

Document families group document types and help with recommendations; they decide nothing, so they carry no stamp
rule and have no Settings page: they are a set in Types & sets, read on Help.

**From §80:**

DELIOS counts them at the site:

**From §80:**

, claimed by a
  click on its day;

**From §80:**

A project's calendar runs from the month it starts to the month it
  finishes, with the schedule's action days on it, read by everyone on the project.

**From §80:**

- **A new project starts with the organization's place** (Defaults for new projects), then keeps its own.
- **Dates read one way across the organization** (its choice of four), on every screen, so a date means the same to
  everyone reading it.

**From §81:**

DELIOS keeps it as it is asked:

**From §81:**

- **Two ways to read it, one page each package:** drilling down from a package into the packages in it, or the whole tree
  on Packages; both open the same package page.

**From §82:**

- **The organization's settings are an administrator's and a few authorized people's** (owner): administrators and
  those of ours who keep a project (its control function, whoever holds Manage) read them whole; the rest of ours read
  what applies on their projects, never the organization's defaults or switches; another organization's people read
  only the words screens show (names of states and lists, how dates read, whether a PDF is stamped), and none of the
  organization's switches or controlled lists.
- **A forged sender's address is the real world's to settle** (owner): a reply by email is taken in only from the
  organization's address and waits for the control function to record it by hand; nothing more is built against forgery.

**From §82:**

- **The organization's own lists are an administrator's**: the control function of one project does not upload or
  approve them for every project.

**From §85:**

- **An unpaid or ended contract never touches the record.** The organization reads only: everyone keeps reading and
  exporting, nobody adds or changes, nothing is deleted. Handing the data back and deleting it after an agreed time is
  a contractual act, written in the data processing agreement, never a consequence of non-payment.

**From §85:**

Whoever runs the register (DELIOS's team) sees counts only

**From §85:**

it then acts as a named administrator ("DELIOS support:
  <name>"),

**From "Still open":**

- **Asset tags are numbered**, as packages are: from their scheme, by default
  project code, TAG and a sequence (P1001-TAG-0001); a tag never changes.
- **Revision naming is the organization's**: schemes of series (letters or
  numbers, with a prefix and a start), a default, and per deliverable type
  another (for example supplier documents P1, P2). A document keeps counting
  the way it began; a series in use is never recounted.
- **A verdict list may be the organization's own** (for example for supplier
  documents): a list says it is verdicts, each value says what it means, and a
  route serving supplier documents decides from it.

**From "Still open":**

- **Verdict lists are made as lists of verdicts**: each verdict states its
  meaning when it is written; a list with no accepting verdict cannot be
  published.
- **Checks are numbered by the system** by what they look at (settings,
  document details, revisions, reviews, storage, schedule, packages), not by
  the standard's clauses.
- **A supplier package can be delivered** like any delivery package.

**From "Still open":**

- **DCIOM** (a governance framework of measures, thresholds and advice) is on hold by the owner's choice: nothing
  of it is built. Notes in `docs/gaps/dciom.md`.

**From "Still open":**

Built: every notification queues its email (kept in the email log
  with its state, by kind: transmittal, review, notification), and a
  transmittal's email carries the whole transmittal as its page shows it
  (number, project, subject, from, to, copied in, issued for, answer by,
  message, every document with revision and status, the link). Switched off
  until the installation names a mail server. Still to come: an organization
  with nobody on the system receiving it by email directly (today one of ours
  sends it, and the dispatch is recorded).

## What in the application depends on each section

- §1: `releaseRevision` in `frontend/lib/lifecycle.ts`, the issue-request gate, 19 checks in `scripts/verify-release.ts`.
- §2: `openApprovalStep` / `settleApproval` in `frontend/lib/transmittals/issue-requests.ts`; the *External approval* checkpoint in `frontend/lib/actions/action-lateness.ts`.
- §3: `closedDocumentFilter` and `CLOSED_MODELS` in `frontend/lib/core/tenant.ts`; the access list on the document page.
- §4: `frontend/lib/reviews/delegation.ts` — `delegateCandidates`, `delegationRefusal`, `byPrivilege`.
- §5: `frontend/lib/schedule/readiness.ts`, the denormalised counters on `Action` (`needCount`, `metIssuedCount`, `metStatusCount`).
- §6: `Action.lastMetAt`; the `LATE_RECEIPT` state on the schedule.
- §7: `frontend/lib/actions/action-lateness.ts`; the delay columns on the action page; the baseline export.
- §9: the `ActionNote` record; `DB-13` in `frontend/lib/checks/runners.ts`; audit acts `ACTION_CARRIED` / `ACTION_STOPPED`.
- §10: `TransmittalRecipient.kind`; the seen count everywhere it appears.
- §11: `Transmittal.inReplyToId`; the exchange on the transmittal page; `/transmittals/new?follows=` (see §45: answering and completing are one "Follow up").
- §12: `chaseTransmittalAction`, `markRecipientSentAction`; the recipient's `dispatchedAt`, `dispatchChannel`, `dispatchRef`, `dispatchedByName` and proof; audit acts `TRANSMITTAL_CHASED`, `TRANSMITTAL_SENT_ON`.
- §13: `acceptTransmittalAction`, `attachTransmittalFilesAction`; files of kind `ATTACHMENT` on the transmittal; "Make it a document" on the transmittal page; audit acts `TRANSMITTAL_FILES_ATTACHED`, `TRANSMITTAL_FILE_REGISTERED`.
- §15: gate `ISS-ITEMS`; check `IS-03`; the acceptance conditions of entry 13, which a letter answers as not applicable.
- §16: `settleApproval`, `returnAtGate`, `holdRevision`, `liftHold`, `returnHeld`, `returnRecipients`; `Revision.heldAt`, `heldReason`, `heldByName`; audit acts `OUTSIDE_APPROVED`, `OUTSIDE_REFUSED`, `REVISION_HELD`, `REVISION_HOLD_LIFTED`.
- §17: policy `POLICY_PDF_STAMP`, `STAMP:<kind>`, `STAMP_COMMENTS`; `Stamping` (`StampChoices`), `lib/documents/copies.ts` (`openCopy`).
- §18: `revisionGround`; act `AUTHORIZE_REVISION` (default: the people doing the work).
- §19: property `review` on `DOCUMENT_TYPES`; `typeSkipsReview`, `releasedWithoutReview`, `readyForRelease`, `submitForReleaseAction`.
- §20: `Transmittal.followsId`, `followKind` (SUPPLEMENT | REPLACES).
- §21: `frontend/lib/conformance/checks/catalog.ts`, the Assurance section.
- §22: `frontend/lib/conformance/checks/prevented.ts`, *Assurance → Default rules*.
- §23: the retire/reactivate actions, `ConfigValue.status`.
- §24: `frontend/lib/settings/field-policy.ts`, `FieldPolicy`, `CustomField`, *Settings → Forms & fields*; ten forms wired to it.
- §25: `frontend/lib/numbering-records.ts`, *Settings → Numbering*.
- §26: the `days` on a route step, `ReviewCycle.dueAt`, the **Step due** and **Review due** columns.
- §27: `frontend/app/(app)/conformance/plan/plan.tsx`, `ScopeConfig` (`MEASURE`, `dmpDocumentId`).
- §28: `REVIEW_ADVICE`, `ReviewService.AnswerAsync`, `verdict-status.tsx`.
- §29: `ReviewStates.Withdrawn`, `WithdrawForUpdateAsync`.
- §30: `Revision.StatusCode`, `AnswerRequest.Status`.
- §31: `StartReviewRequest.People`, `StepView.GoesTo`.
- §32: `ListUploadEndpoints`, `Verbs.Plan`, `Activity.ExternalId`.
- §33: `DocumentService.UpdateAsync` (`DETAILS_NEED_A_REVISION`).
- §34: `KeepingService.LegalHoldAsync`, `ON_LEGAL_HOLD`.
- §35: `DocumentService.EndAsync`, `ReinstateAsync`, `KeepingService.UnvoidAsync` (`WAS_RELEASED`, `NEVER_RELEASED`, `ARCHIVED_WITH_PROJECT`), `Supersession.TellWithdrawnAsync`, project status update.
- §36: `ProjectCodes.EnsurePublishedAsync`, called on project create and code change and before a document is numbered.
- §37: `DOCUMENT_TYPES` property `criticality`, `CRITICALITY` property `meaning`, the create form.
- §38: `ActionNotices`, `NoticeLog`, `Activity.RiskFrom`, `Requirement.RiskDays`, `ReadinessConfirmation.Automatic/Revoked*`, `ActivityDecision.Confirmed*/Reversed*`, `/notices`, `NotifyPanel`.
- §39: `Transmittal.ActivityId/ActivityAnswered*`, `/transmittals/{id}/activity-answer`, `NeedRequest.TransmittalId`, `ADD_TO_ACTION` Home work, `LinksCard`, `needDefaults`.
- §40: `Written` (`Revision.Unvoided*`, `Document.Ended*/Reinstated*/LegalHoldLifted*`), `Review.SendBacks`, `ReviewComment.ReclassifyNote`, `Package.AcceptNote`, the revision row, the review page's "Sent back".
- §41: `ACTION_LINKS`, `PROJECT_PEOPLE`, `CONFIRM:{act}`, `Verbs.Manage`, `Transmittal.ActivityConfirm/ActivityProposal`, `Membership.PendingSince/Refused*`, `/activity-check|confirm|refuse`, `/people/pending|confirm|refuse`.
- §42: `Document.WithSupplier`, `HandBackRequest` (RETURN_FOR_UPDATE), `/documents/{id}/asks`, `/asks/{id}/answer`, `/documents/{id}/send-to-supplier`, `ASKED_OF_SUPPLIER`, `HELD_BY_US`, `ANSWER_HAND_BACK`, `SupplierHold.HandsToSupplier`, `Register.SupplierStage`, `supplierStage`, `NoticeRequest.OutsideLink`.
- §43: `VERDICT_EFFECT` (`proceed`, `resubmit`, `information`), `verdictEffect`, `SupplierHold`.
- §44: `/supplier-schedule`, `/needed`, `plannedState`.
- §45: `followsId` / `inReplyToId`, `REASONS_FOR_ISSUE.family`; the transmittal form and page.
- §46: `Function.Clearance`, `Identity/Clearance.cs`, `DocumentQueries.Visible`; the clearance choice on Functions & permissions.
- §47: `DemoSeed.EnsureCorrespondenceSetupAsync`; `releaseRevisionAction` (sends a not-reviewed type on).
- §48: `Actions/RequirementsImporter.cs`, type property `readsRequirements`.
- §49: `frontend/lib/actions/api.ts` (`latest`), the action page.
- §50: `Numbering.FromRangeAsync`, `number_ranges`.
- §51: `Transmittals/Supersession.cs` (`/exposures/untold`), `Reviews/ReviewWarnings.cs`, `Stamping.MarkAsync`.
- §52: `POST /api/admin/projects/{id}/join`.
- §53: `ActionNotices.EscalateAsync`, project setting `ESCALATE_AFTER_DAYS`.
- §54: `Actions/ActionLetters.cs`; `ActivityDecision.TransmittalId`, `Membership.ConfirmTransmittalId`.
- §55: `Organizations/` (`OrganizationLink`, `AccountLink`, `ProjectParty`), `User.HomeTenantId`, `POST /api/auth/switch`.
- §56: `SheetGuard` (no list is uploaded in Settings), `DocumentService.CheckRegisterAsync`, `Numbering.RefusalAsync`, `CreateUserRequest.Invite`, `PasswordReset.InvitationLink`, `lib/documents/forms-import.ts`.
- §57: `ReportBuilder.AsOfAsync`, `ReportBuilder.ExchangeAsync`, `ReportIds.AsOf`, `ReportIds.Outside`, `ReportOptions.Party`.
- §58: `ReportBuilder` (`ProgressAsync`, `ExchangeAsync`, `AsOfAsync`), `Chart.Kind`, `Figure.Change`, reports print (`.report-print`). Not yet built: 58.1's planned-date history (`docs/gaps/conformance-reports.md`).
- §75: `POLICY_PDF_STAMP`, `STAMP:RELEASED|RETURNED|SUPERSEDED|VOID|HELD`, `STAMP_SHOW:<what>`, `STAMP_COMMENTS`, `STAMP_PLACE`, `STAMP_SIZE`, `STAMP_NOTE` (Settings → The stamp, both levels); `Stamping.StampChoices`, `FaceAsync` (worker); `DOC_FAMILIES` (Types & sets).
- §76: `PROJECT_DEFAULTS`, `LIBERTY:<key>` (`Settings/Liberty.cs`); `/organization/settings/flow`, `/organization/defaults`, `/organization/settings/may-change`.
- §77: `LIBERTY_EXCEPT:<key>` (`Settings/Liberty.cs`, `PUT /api/liberty/{key}/except`, LIBERTY_EXCEPTION; `GET /api/liberty?projectId=`), `Settings/ProjectDifferences.cs` (`GET /api/admin/projects/{id}/differences`); `/organization/settings?project=<id>`.
- §78: `SCHEDULE_LEAD_DAYS`, `SCHEDULE_RISK_DAYS`, `LIBERTY:LEAD_DAYS`, `LIBERTY:RISK_WINDOW` (`Actions/ScheduleDays.cs`, `/api/admin/schedule-days`, `/api/projects/{id}/schedule/days`); `kept_copies` with no project, kind DEFAULTS (`Settings/OrganizationDefaults.cs`, `/api/admin/project-defaults`, migration KeptCopyOfTheOrganization).
