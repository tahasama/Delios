# Working on DELIOS — read this first, every session

## Where what we agreed is written

Read these before changing anything they cover. When a decision is made in
conversation, write it into the right one in the same commit as the code.

| File | Holds |
|---|---|
| `CLAUDE.md` (this file) | How to work with the owner, and the rules that must never break |
| `docs/STANDARD-CHANGES.md` | What the original Document Management Standard must change to match what we built. Every new rule about controlling information goes here. |
| `docs/REVIEW-MODEL.md` | The review model: routes, steps, advice, verdicts, release |
| `docs/STRUCTURE.md` | Where everything is, by area; where to look when debugging or adding a feature |
| `docs/ORGANIZATIONS.md` | Organizations working together (collaborator, guest, not on DELIOS), linked accounts, the organization's admin page |
| `docs/BEHAVIOUR-CHANGES.md` | What behaves differently since the screens moved onto the backend |
| `docs/DETAIL-STYLE.md` | The reference style (Schedule & actions, the action page): what "apply the same" means |
| `docs/gaps/*.md` | Known gaps per area |
| `PRODUCT.md` | Product context and users |

## Where things go

Everything is filed by area, under the same name everywhere: `backend/app/<Area>/`,
`frontend/app/(app)/<area>/` (pages), `frontend/lib/<area>/` (`api.ts` reads, `forms*.ts` sends). The
full map, the services and "where to look" are in `docs/STRUCTURE.md`: read it before adding a file,
and keep it up to date when a folder is added or moved.

**Rules live in the backend, once.** Where something stands (an action's state, a revision waiting for the
check, a transmittal's status, a package's readiness) is worked out by the backend and read by every screen;
a screen only words it. A new rule goes in the backend, never in a page.

## How to work with the owner

- Short, plain replies. No jargon. PowerShell commands one per block.
- To update the owner's copy: `git pull`, then `docker compose --profile app up -d --build`. The app's own services
  (API, worker, screens, migrations) carry the profile `app` in `compose.yaml`; without it only the dependencies start
  (database, storage, queue…), for running the API by hand. `COMPOSE_PROFILES=app` in `.env` makes it the default.
- Never send screenshots or pictures.
- Never quote a bare document number as a reference.
- Ask before choosing any code (status, verdict, type…). A code never changes once used.
- Nothing is deleted except by the app owner. Exception: an empty package
  that never went out may be deleted by whoever composes it (it holds no content;
  removing a package never removes documents).
- Every setting there is today is the project's, not the organization's (no
  organization administration page exists yet). Document Control keeps its
  freedom on them (people, functions, organizations, numbering, routes); it
  acts on the projects it is on.
- The owner's full-rights account: `grant-all <email>` (backend command) makes
  that person an administrator, unlocks them, and puts them on every project
  with Document Control, which is given every verb.
- No model names in commits. Commit and push to the working branch.
- Do not run the tests unless asked; do compile (`dotnet build` in `backend/`, `npx tsc --noEmit` in `frontend/`).
- Think about the whole flow, not a patch. When the owner reports something
  wrong, revisit the whole flow it belongs to (start → withdraw → send again →
  advise → decide → release → issue), not only the line reported.
- Never remove behaviour that exists without saying so and why.
- No code written inside the page (no inline scripts, no `dangerouslySetInnerHTML`).
  Display preferences (theme, sidebar width) live in cookies the server reads.

## Design — locked in by the owner

- The look of Schedule & actions and of the action page is the reference for
  every page, card and form, including the hidden ones (panels, popovers,
  details). It is written down, with the exact classes, in
  `docs/DETAIL-STYLE.md`. When the owner says "apply the same", follow that
  file to the letter; do not restyle the reference pages.
- One control size everywhere, set once in `frontend/app/globals.css` on `:root`:
  `--control-h` (2rem), `--control-text` (13px), `--control-radius`. Every
  field, dropdown, button and file field stands that height with that text.
- Use the shared pieces only: `btn()` and `inputCls` (`frontend/components/ui.tsx`),
  `.ask`, `.plain`, `ActionForm`. Never give a field or button its own height,
  padding or text size on a page; never restyle the file button locally.

## Rules that must never break

### What people write
- Everything a person writes and the app keeps (comments, explanations,
  reasons, notes, answers, messages) is shown in the place where it matters:
  with the thing it is about, to the people it is for. Never only in a log.
  Nothing written is erased by a later step: a take-back, a send-back or a
  correction is kept beside what it answers.
- A comment changed or taken back by its author before their step is answered
  is a draft: only its final version is shown.

### Reviews
- Every route step names who answers it: people, a function, or an outside
  party. Never empty. Screens always show the actual names, on every step,
  including steps not yet reached.
- The sender may change the people on each step for that review; that choice
  is what the review uses, and the record says so.
- Sending for review opens the new review's page.
- A review is only ever started from the Send for review form (route, people
  per step, copies). No "create and send" shortcut on the new-document or
  new-revision forms: create first, then send from the document's page.
- A revision is never in two reviews at once.
- Advisers pick advice from the published advice list; never less than their
  comments say.
- Comments are written with the answer, under the verdict or advice choice,
  and are obligatory only when that choice carries comments (comments,
  blocking comments, C2, C3, accepted with comments, rejected). There is no
  separate comment box.
- "Issued for" starts as the revision's purpose (IFR when none). Each step
  confirms it or changes it. The decider's grant is what the revision carries
  and is released at; Document Control does not choose it.
- Progress shows "you are here" on where things really stand: the open step
  while in review, "Not released" once decided.
- "Leave it to…" (who receives it) goes to whoever started the review.
- Accepted with comments, or released at a status for update (IFU, "Issued for
  update": work does not go ahead on it; status prop `update`), is released and back
  with its author at once: the author (or the supplier, who then holds it) is told
  its comments go into the next revision, which needs nobody's leave, and it is on
  their Home ("next revision due").
- Sending back after a verdict that asked for changes asks nothing more: the verdict
  and the comments written with it are the reason ("Anything to add" is optional).
- A decision, a release and a send-back are told to everyone the review concerns
  (`InvolvedAsync`): whoever started it, the author, everyone on the route (each
  step's people and whoever answered), those copied in, Document Control, and for a
  document of another organization (its originator, or whoever sent the revision)
  that organization's people on the project.
- "Copy to (cc)" on Send for review is kept on the review (`Review.CopyUserIds`):
  told when it is sent, and of what comes of it; never asked to answer.
- Document Control approves nothing: a comment's weight is never changed after it is
  written (no "reclassify"); the decider's verdict decides.

### Revisions
- Until released, everything is editable in one "Edit rev X" step: PDF, native
  file, title and every field. Author or Document Control. The Details tab uses
  the same fields and, while a revision is prepared, points to Edit rev.
- A document's details change only with a revision in preparation (or before
  its first revision). Once out of preparation, a change takes a new revision;
  the backend refuses otherwise. Records keep their own details edit.
- In review: "Withdraw from review" with a reason, on the document page and the
  review page, by whoever started the review or Document Control (and above);
  the author alone does not (backend STARTER_OR_CONTROL). The review stays in the register as **Withdrawn** with its
  reason and comments; everyone on the route is told. The revision can then be
  sent again.
- Revisions are never skipped, and an upload elsewhere never creates one.
- Starting a revision asks one text, "What changed, and why" (never two fields
  saying the same), plus a PDF and a native file, both optional at start.
- A withdrawn review is closed: no advice, verdict or comment can be given on
  it. Its progress ends at "Withdrawn"; a release comes from a later review.

- A document from another organization (its deliverable type names "originator" among
  what it requires, Settings, on the type) asks whose it is (the outside organizations,
  as the backend checks) and its order; never its received date, which is filled when
  its first submission comes in, or when Document Control records what arrived from
  outside (asked only when registering what arrived); never on Edit. "Who may see
  it" starts at the lowest level for it, unless chosen.
- Creating a document takes the same two optional files as a revision: a PDF
  and a native file. The project code comes from the project the user is in
  and is always in the Settings list of project codes (added there automatically);
  it is never asked for and never refused.
- Each deliverable type has its own document types: a type names the
  deliverable types it belongs to (Settings, on the type, "Deliverable types");
  the new-document form lists only those. A type naming none falls back to
  "Who produces it" (supplier or not).
- Criticality: the document type recommends a level (Settings, on the type);
  it is filled in on create and marked "(recommended)"; it is optional, and the
  person may choose another. A type naming none recommends the usual level (the list's default, else the level
  types recommend most): one is always recommended. Required in Forms & fields, it is required on the form too.
- A purchase order belongs to a supplier: the one it names (Settings, Purchase orders, "Supplier"), else the one
  whose supply package carries it. A document of another organization names only its own orders (or one tied to
  nobody); the form offers only those, the backend refuses another's (PO_OF_ANOTHER_SUPPLIER). "From another
  organization" is read from the deliverable type (it requires an originator), never from fixed type codes.
- A form sent with something missing outlines each missing field in red (`[data-missing]`) beside the list of
  what is missing; a field the backend names (its `field` / `fields`, `refusalForForm`) is outlined the same way.
- Whether a document is revised follows its type: a type marked "a record"
  (Settings, on the type) registers records, fixed once confirmed; nobody is
  asked. The form's first field is "Deliverable type" (who produces it; it
  picks the numbering), in the published values' own words. Each level shows its meaning and what it decides.

- A document exchanged with a supplier (one with a placeholder, from its
  supply package) is held by one side at a time, and only the holder changes
  it (`Document.WithSupplier`; backend refuses ASKED_OF_SUPPLIER / HELD_BY_US).
  Placeholder sent → the supplier holds it. They send it → we hold it. Our
  check returns it → they hold it. Review: a verdict meaning "accepted" or
  "for information" → we hold it; "accepted with comments" or "rejected" →
  they hold it (read from the verdict's meaning, never its code). What it is
  issued for is set automatically from the request.
  Whenever it passes to them (our check returns it, a review rejects it or releases
  it with comments), the supplier's people on the project are told, and it is on
  their Home (returned / next revision due).
- Every document registered with an outside organization as its originator is
  filed in that supplier's package, one per supplier and purchase order, made
  by itself with the first document (`SupplyFiling`) only when that supplier has
  no package yet: a package already there (made by hand or by itself) takes it,
  the one for its order first, else the supplier's one with no order.
  Document Control (and above) looks after it. A package's number comes from
  its numbering scheme and never changes (backend NUMBER_FIXED). Until it is
  shared: rename, narrow by a rule, and delete it (made by hand or by itself) while
  none of its documents was sent to the supplier; its documents stay in the
  register and are filed again. Once shared, name and rule are fixed (backend
  PACKAGE_SHARED) and it is kept.
- On our package page (supplier's or delivery), "Add or take out" opens the register for the package, as
  for an action (`/documents?pick=pkg:<n>`, on the supplier's documents for a supplier's package): its
  documents ticked, tick to add, untick to take out, then save. The list of
  the package's documents has ticks; ticking opens a bar under it: "Send to
  <supplier>" (not sent yet; starts a transmittal, `?placeholders=`), "Ask back
  for an update" (held by the supplier; starts a transmittal, `?askBack=`, the
  ask raised on each document when it is sent, with the message as why), "Take
  out" (not sent yet). A document sent to the supplier is never taken out
  ("You can't take out a document sent to <supplier>"; backend
  SENT_TO_SUPPLIER). The list shows, per document: where it stands, sent to the
  supplier (day), sent back (day, late or not), released & issued (day),
  planned (the document's planned day, else the package's; with ready / submitted / overdue / at risk / in
  N days; none reads "on no action" in red), and what is next for us. The
  supplier's page shows the same released & issued day.
- Choosing documents for a form (a new transmittal, Start a review, a package) is always the register,
  opened for it as for an action (`pick=tr:<form>` / `rv:<form>`): what it holds starts ticked; "Continue"
  goes back to the form, on the step it was on, with everything written so far. What is enclosed is listed
  on the form, each removable. A ticked document with nothing that can go (nothing released; for a review,
  nothing being prepared) is named, not enclosed.
- A transmittal asking for an answer asks it by a day (backend ANSWER_DATE_REQUIRED). The answer stands, in
  the list and on its page (`AnswerStates`): awaited, overdue (none, past its day), answered on time, answered
  late. Answered by a transmittal answering it (or following it, by someone else), or a review step's answer.
  "An answer is required" is the sender's tick, never ticked by itself (whatever the reason says).
- Form labels and hints sit on one line of fixed height (the hint cut, whole on hover), and every control is the
  control height, so fields side by side stay exactly level; forms are laid out in rows, field beside field
  (new document, step 2: project · criticality · PDF / sub-project · what the criticality means / who may see it ·
  retention period · native file). A search picker's line starts where every field's does (magnifier inside).
- The side colours (rails, Home's edges, the history's marks): one colour per state, never one colour for things
  that mean different things; close states take close colours (released emerald / accepted green, done / ready,
  superseded violet). The states and their classes are listed once in `lib/core/rails.ts` (CSS `.rail-*`), which is
  the key on Help, "What the colours say". Every list of documents takes them, the package lists too (a supplier's
  line by its stage, a delivery line by ready / released short of its status / nothing released); a card (Next step)
  takes none.
- Stamps on the PDF are the project's choice (How this project works): `POLICY_PDF_STAMP` (stamped or not), each
  stamp `STAMP:<kind>` (RELEASED, RETURNED, SUPERSEDED, VOID, HELD; on unless turned off) and `STAMP_COMMENTS` (off
  unless chosen: a verdict's comments listed on a last page). Read once in the worker (`Stamping.StampChoices`). A
  rejected revision is stamped RETURNED. The PDF opened from a document is its marked copy (`openCopy`,
  `lib/documents/copies.ts`).
- A check is only for what can still happen: what the app refuses or fills by itself is listed under "Refused on
  every project" (Default rules, tabs by area, `prevented.ts`), never checked.
- Assurance: each finding points to the exact spot where it is put right: a document's tab, or else the thing
  itself (a setting's list with that value opened for editing, the numbering row, the action, the package, the
  review), never a page to search. Check ids are the app's own, by what they look at: SET (settings), DOC (document
  details), REV (revisions), RVW (reviews), STO (what is kept in storage), SCH (schedule), PKG (packages); none
  refers to the original standard. Renumbering moves what was found and switched off with it (migration AppCheckNumbers).
- `unshare-package <email> <package-number>` (backend command) puts a supplier's
  package back to not shared, for testing; logged.
- A supplier package has two pages. Ours (Document Control and above): plate,
  counts that add up to the package (not sent yet · with the supplier · with
  us, how many to check · released, released first time), "The package" with one row of icon buttons (Share once; until shared:
  Narrow by a rule, Edit, Delete; Delivery list), and the documents (above). Nothing is uploaded on our page: no file fields, no
  "enter and send for review" (what reaches us outside the system is recorded on
  a transmittal, "Received from outside the system"). The supplier's page: only
  what was sent to it, in its words, the comments to take in, a file field
  beside each document it holds, and "Send to <us>".
- A supplier package is delivered by "Deliver" (The package): a new delivery package opens with its documents
  in it (or they are added to one already open), then goes the delivery way (check, deliver, accept).
- "Delivery list" downloads the package's own lines (`/api/packages/<n>/list`),
  never the schedule's requirements list.
- "Share with <supplier>" is pressed once, for good: until then the supplier
  does not see the package. Sharing tells the supplier's people on the project.
  Our package page names them, and warns when nobody of theirs is on the
  project (then nobody of theirs sees it). Once shared, it sees there only the documents asked
  of it on a transmittal, and of its own documents only those exchanged with it.
- A placeholder reaches its supplier only on a transmittal, from the package
  (tick some or all not asked yet) or from the register's "Create
  transmittal" (one supplier's at a time, to that supplier) — both ways, the
  record of what was asked, when, due when. Each is asked once (backend
  ALREADY_REQUESTED); after that it is handed back and forth (ask it back,
  send it for an update). Its package line is marked asked either way. Adding
  to a package is not asking.
- Stamps beside a supplier's document number (register, document page,
  package lines), in the reader's words (`SUPPLIER_STAMP`): sent to supplier /
  to be transmitted; received / transmitted; accepted; returned / to correct;
  in review; released (with comments to take in: next revision due / to
  revise); returned / to revise. Not sent yet: "not sent to supplier" (register
  and package; our own placeholders read "number reserved"). A supplier's package as a whole, in the packages
  list (`packageStage`), says who has to act: not shared yet, nothing sent yet, waiting on the supplier (n),
  waiting on us (n), waiting on both, complete; the list's columns are the same counts as the package page.
  A line received reads "received, to check" (ours), accepted "accepted, to send for review". The list and the
  package page count the same way (`packageCounts`).
- Document Control (and above) only, on supplier packages. A new supplier package asks the supplier and
  its order, and a status only if wanted: no single due date (each document is due on its own planned date)
  and nobody accepts it.
- Delivery packages: "Needed at" (statuses) also says why they get it (`ReasonFor`, backend: the reason with
  the same purpose, else one for execution); no separate reason is asked. Those putting it together only add
  and take out its documents (and delete it while empty and never sent); Document Control (and above) does
  everything else and edits every field while it is open (backend CONTROL_ONLY / OWNER_ONLY). Ticked
  documents are taken out from the bar under the list. What is missing is asked on a transmittal (Request) to
  whoever accepts it; their confirmation (a warning first) answers it on a transmittal (Confirmation) and
  delivers it at once on their responsibility, the documents not ready going as they stand (released
  revision, else the newest), said on the delivery transmittal. "Export CSV" on Packages exports the one
  package ticked.
- The side that does not hold it asks the holder to hand it back for an update
  (RETURN_FOR_UPDATE, with why): Document Control on our side, whoever of the
  supplier may upload on theirs. The holder accepts or refuses with why; the
  one who asked is told; accepted, it passes to them. Each ask and answer stays
  in Details. While we hold it, Document Control may send it to the supplier
  for an update. A revision not yet reviewed passes as it is and comes back
  under the same value: only a release, or a review that returns it, makes
  the next one a new revision. Documents with no placeholder (letters,
  minutes…) are not held: the supplier sends another whenever they want.
- Verdict lists are the organization's, any codes and names, but each value
  says one of four meanings: accepted, accepted with comments (fix next
  time), rejected (back to the author), for information. The app reads the
  meaning (`verdictEffect`, props proceed/resubmit/information), never C1–C4.
  Verdict lists are made and kept in Settings → Verdict lists (`VerdictListEndpoints`), as one: a name and its
  verdicts, each with its code, label and meaning, chosen by the person (never filled in for them); at least one
  lets a revision be released (backend MEANING_REQUIRED, NO_VERDICT_ACCEPTS). A route chooses its list from these
  (Review routes); a route for supplier documents serves "Produced by" the supplier deliverable type, or "From
  which organization". A value with no meaning reads "not chosen yet" until it is given one.
- Phase is a document's metadata (PHASES, published like any list): asked on the new-document form (row 2,
  column 3), in Details and Edit rev, and when a revision is started (it may move the document to its next
  phase). Each revision keeps the phase it was made in. The register shows, filters and sorts by it.
- How revisions are named is Settings → Revisions (`RevisionSchemeEndpoints`): schemes of lines, one line per
  phase, as many as wanted, plus one default line for any phase without its own (no phase published: that one
  line names every revision). A line counts in letters or numbers, with a prefix, a start (empty: A or 0) and
  letters skipped. One scheme is the default; any deliverable type may follow another. A revision is named by
  the line of the phase its document is in. A scheme chosen for a type names its documents not revised yet; a
  document already started keeps counting the way it began. A line revisions carry stays, never recounted
  (backend SERIES_IN_USE).
- A supplier's document reads in its own states (register, document page,
  package, the supplier's panel): Sent, Received, Accepted, Returned (by
  Document Control's check, with why), In review, Released & issued, Returned
  (rejected by the review); who holds it is said beside it. `supplierStage` and
  `RegisterEndpoints.SupplierStage` work it out the same way.
- A document the schedule needs is planned for the earliest day an active
  action needs it (`Readiness.RestateAsync` writes `Document.PlannedDate`
  whenever needs are worked out): the same date on the action, the register's
  Planned column, the document and its package. One no action needs keeps the
  date a person gave it.
- A planned date says what it means today, the same everywhere (register,
  document Details, package lines, the supplier's schedule; `plannedState`):
  ready (released), submitted (received, accepted, in review), overdue · N
  days, due today, at risk · N days left (inside the risk window), in N days.
- The menu and page are named **Schedule** (each action opens its own page); the rules below still say
  "Schedule & actions" for the same page.
- Schedule & actions is one page for everyone, narrowed by the backend to what is
  theirs (`OutsideViewAsync` / `Narrow` in `ScheduleEndpoints`): our people see every
  action; another organization's people see the actions needing a document they may
  see (their own, and those shared with them), and in each only those documents. Our
  disciplines, confirmations, notices and notes are ours: not shown to them; a
  decision reads without who or why. `/needed` only redirects to `/actions`.
- A notice about a supplier's missing document proposes that supplier's
  people (chosen, marked recommended); they are sent to the document, since
  the schedule is ours only.

- Released and issued are one act unless the organization sets POLICY_RELEASE =
  SEPARATE: a release needs someone to send to (an open request naming people
  or organizations, or the people named on the release form); the backend
  refuses otherwise (ISSUE_REQUIRED). The release sends it.
- Release is offered only for a decided revision (never in Prepare). Document
  Control does not say who receives it: the decider or whoever asked did. The
  release form shows them, each removable (the request keeps who was taken off,
  by whom, when: `IssueRequest.ReleaseNote`), and "Add people or organizations".
  No outside-approval tick and no "leave it to" on release; those are the
  decider's. "Ask for rev X to be sent" opens straight on its form (who, why),
  without "leave it to" or outside approval.
- Send for review starts on the recommended route (the most specific that
  serves the documents, marked "(recommended)"); each step starts with the
  recommended people (the route's, or the matrix's for the discipline when the
  step names nobody). The sender may change both.

### Transmittals
- One "Follow up" answers or completes a transmittal: a new one mentioning the
  one it follows (ours: documents and people carried over; theirs: back to
  whoever sent it). The subject is not prefixed ("RE:", "Supplement to").
- "Received from" (recording what came outside the system) is picked from the organizations set up on the project,
  with their codes (the number follows its series). Recorded so, a data transmittal carries a document (from the
  register) or a file that came with it; words alone are an information transmittal (backend FILE_REQUIRED).
  The same for every data transmittal, sent or received: it carries at least one document (or, received, the file
  that came); a letter is an information transmittal.
- One file field everywhere (globals.css `input[type=file]`): dashed line, light flat button at the control height;
  a page sets only its width.
- The form asks the kind (a dropdown: data or information transmittal, `lib/transmittals/kinds.ts`), then its
  type in that kind's words ("Issued for" / "Type of information"), from the reasons of that kind
  (`REASONS_FOR_ISSUE` prop `family`). A data transmittal with nothing attached is not refused on the spot:
  Continue asks "Nothing is attached… make it an information transmittal?" (choose its type) or "Attach a
  document". No "sent by" and no date: it is the
  person signed in, today. "Received from outside the system" (Document Control)
  is a tick, and only then are who sent it and when asked.
- A supplier's submission is issued for review (IFR) where IFR is published;
  the review then confirms or changes it.
- What came in reads, in the transmittal list, as its check answered: To check,
  Returned / Partly returned, Accepted (read from the documents it carried);
  words alone read Received. Never "Accepted" before or against the check.
  One rule for the list and the transmittal page (`Arrivals`); the check is kept on the submission
  (`SubmissionRecord.Check`), never overwritten by a later release or return.
- A submission returned by the check tells whoever sent it and their
  organization's people on the project, with why.
- What another organization sends becomes the document only when Document
  Control's check accepts it. Until then, and after the check sends it back,
  its files belong to the transmittal it came on (each line carries that
  submission's own files, checked there): the document keeps what it had (a
  placeholder: nothing; handed back for an update: the submission accepted
  before). `RevisionReading` (backend, `AwaitingCheck`).
- "Files that came with it" shows on a received transmittal only when files
  came with it.
- A placeholder sent to its supplier is issued for update: reason IFU ("For update",
  family Data; the status IFU reads "Issued for update"), set by itself on the transmittal (never chosen) where it is
  published; the data / information choice is not shown then.
- "Received from outside the system" is not offered when the transmittal is
  already about something of ours going out (documents chosen in the register
  or a package, placeholders, an ask back, a follow-up of ours).
- A transmittal made for a package's documents is titled in one line: "<package>
  — N documents submitted to <supplier>" ("asked back from" for an ask back),
  with a short message; the documents are listed on it, never in the title or
  message.
- Information reasons: REQUEST, RFI, ANSWER, CONFIRMATION (family Information);
  an existing demo gains them, and IFU, with `seed-demo`. A reason with no family is data.
- Placeholders are asked of their supplier from the supplier's package (tick, "Send to <supplier>") or the register
  ("Create transmittal"); the new-transmittal form has no box of its own for it (removed: a third, confusing way).
  The package shows what is overdue above its list: not sent yet (with "Tick the N to send", then the bar sends them)
  and with the supplier, not back.
- A letter (an information transmittal with nothing enclosed) needs its subject and its message; the form says so.
- "Issued for": a status is shown with its code in its full words ("IFU — Issued for update", as "IFR — Issued for
  review"); a reason is shown in its plain words ("For update").

### Organizations working together (docs/ORGANIZATIONS.md, Standard §55)
- Another organization works on our project in one of three ways: **collaborator** (its own DELIOS,
  linked; its people use their own sign-in), **guest** (accounts we make), **not on DELIOS** (a code; one of
  ours records for them). Nobody is forced to register. A collaborator is never chosen by hand: it is a party
  linked to its organization (invite by an email known there; their administrator accepts or refuses, with
  why; either side ends it, with why).
- A project belongs to the organization that opened it; its data stays there (`TenantScope` is the only
  way across). Each project says which organizations take part, their role, and the function a
  collaborator's people start with (`ProjectParty`).
- A collaborator's administrator puts their own people on our project: we get an account standing for
  them (`User.HomeTenantId`, no password, no sign-in name), linked to theirs (`AccountLink`). They sign in
  at home and switch in and back (`POST /api/auth/switch`; the 7 days run from the sign-in). Switched off
  at home, or the link ended: those accounts stop.
- The organization's page (`/organization`, administrators): projects ours and joined, people, organizations
  we work with, invitations (also on Home), defaults for new projects. Its projects, people and organizations
  are links (open or switch into a project; People & access; Organizations).
- Defaults for new projects (`/organization/defaults`, `PROJECT_DEFAULTS`): edited directly with the same form
  as a project's Control room (`components/how-it-works.tsx`), or taken from one project; they keep only what
  differs from the app's own; "Reset to the app's defaults". Copied when a project opens, never changing one
  already open; a joined project follows its owner. A project marks each answer "as the defaults" / "the
  app's" / "changed here" and has "Reset to the organization's defaults" (what the project is, and checks
  ticked off, stay).
- Not on DELIOS, with "Their email for transmittals" (`Party.ContactEmail`): our transmittals to them go by
  email with their files (`EmailReplies`), each with a reply address of its own (`replies+<key>@…`,
  `ReplyAddress`, kept outside organization fencing). A reply from that address only is taken in: it waits on
  the transmittal ("Replies by email") and on Document Control's Home; Document Control records it as received
  (a transmittal following ours, its files checked as anything that arrives) or sets it aside with why. Nothing
  is filed by itself; mail from anyone else is answered with how to reply; mail to no transmittal is dropped.
  No open project mailbox.
- Roles on a project (CONTRACT_ROLES): GENERIC, EPC, EPCM, PMC, DESIGN, OWNER, CM, CONTRACTOR, SUBCONTRACTOR,
  SUPPLIER, INSPECTOR (docs/ORGANIZATIONS.md). New ones only with the owner's approval.

### Settings
- Every setting is the project's: the hub says "How <project> works… What you change here changes this project
  only" (owner's answer). Nobody is left lost: the menu's Settings link shows exactly when a Settings page opens for
  the person (`SETUP_PAGES` + `maySetup`, layout `canSettings`); a page they may not open says plainly who changes it
  and leads back to Settings (`settings/no-access.tsx`), never a red "Administrators only" dead end.
- The hub has a Tip, "Setting up a project? Do it in this order": organizations, people, lists, numbering,
  revisions, verdict lists, review routes; each says done or to do, with what it found, and opens its page (a page
  the person may not open is named, "an administrator does this"). It goes once everything is set up. Each card
  carries a real figure, and what still needs doing reads "To do · …" in amber (an empty essential list, a
  deliverable type with no numbering, no revision scheme, a verdict without a meaning, only you on the project).
  Group icons take one neutral tint.
- People & access never asks a password: our people and someone of another organization with no DELIOS get the
  7-day link to choose their own (email off: the link is shown to whoever added them). Someone whose company has its
  own DELIOS is never added there: link the organizations; their administrator puts them on the project.
- Joining a project (owner): two switches of the project (Control room, "Adding people to the project"): who adds,
  **only the control function** (the default: a project is taken to have one) or **everyone on the project**
  (`PROJECT_PEOPLE` = CONTROL / SELF, read like every act: a project with no control function does it itself); and **confirmation by whoever
  holds Manage**, necessary (the default, `CONFIRM:PROJECT_PEOPLE`, backend `DefaultConfirm`) or not, in both modes.
  "Ask for someone to join" is always for someone new (first name, last name, email, function, department, an
  optional message; closed until opened): an information transmittal (Request) to whoever answers it (who is named;
  else whoever holds Manage; else, where no confirmation is asked, the control function). "Add someone" (someone with
  an account, the shared search field, function, department) is the control function's, in People & access; it shows
  on the directory only where everyone adds. `POST /people/requests` (`JoinRequests`, `MayAddAsync`, `AnswersAsync`).
  The control function may attach the email or letter a request came on, kept as proof. Confirmed on People to
  confirm, they are put on by themselves (a new account's invitation goes then), the control function is told, and
  the person is told by notification and email. Refused: they stay off, with why. The control function reminds whoever
  confirms with Notify (People & access, "Waiting to be confirmed"). Nobody to answer: refused (NOBODY_ANSWERS).
- **Project directory** (`/directory`, in the menu for everyone; `GET /people/directory`): the organizations taking
  part (role, how they work with us, who answers for each, people) and the people on the project (organization,
  function, department, control function / confirms); emails for our own readers only. Its only act is "Ask for
  someone to join" ("Add someone" too where everyone adds). Not in the account menu; `/people/ask` redirects here.
- **Who acts as the control function** is named in the project's configuration (Control room, "Who acts as the
  control function", `PUT /people/control`, `Membership.ActsAsControl`): anyone of ours on the project, whatever their
  function, holds CONTROL on the whole project, as if their function carried it (`ProjectAccess.WithControl`, every
  CONTROL holder lookup, `/api/me`). Those whose function carries CONTROL count too. An administrator or whoever acts
  as it names them; each is told. Nobody may be named: the project then has no control function, and the people
  doing the work carry its acts out themselves (as when the Control room says so).
- People & access, in the reference style: masthead (on the project · waiting · refused, and how joining works here),
  "Someone joins <project>" ("Add someone", "Ask for someone to join"), "Waiting to be confirmed" (with Remind), and
  Everyone (organization and project chips; each person's Change: function, department, name and email unless
  linked, "Can sign in" on every project, "Take off <project>", asked first). A linked account (works here from its
  own DELIOS) changes only its function and department here. The organization's own extra fields on a person (Forms
  & fields) are no longer asked when adding (they were checked on the screen only).
- A list's "Used on" counts the project's documents carrying each value (backend `GET /register/usage`), and opens
  them in the register; a value in use keeps its code. Values are retired, never deleted: the bulk "Delete" (which
  only retired) is removed.
- Organizations: the list is the organization's, shared by every project; who takes part in a project (role, the
  function a collaborator's people start with) and who answers for each there (`PARTY:<id>`, a project setting, so
  Document Control keeps it) are the project's. Who answers is optional and never blocks a save. A code is shown, never
  edited. An organization is never removed: "In use" unticked switches it off (no longer offered; its people no longer
  sign in; everything done under it stays). The "Remove this organization" button (which always failed) is gone.
- Layered settings (owner's decision, to build): the app gives defaults; the organization makes the originals; a
  project may change only what is marked as open to change for projects. An administrator changes the organization's;
  Document Control changes its project's; an administrator may give that right to anyone they nominate. Once a project
  has its own version, later changes by the organization never touch it (no overriding projects afterwards: "pure
  chaos"). Until built, a page says plainly what is the organization's and what is the project's.
- Document families come back (owner): each document type belongs to a family (internal drawings like DWG, supplier
  documents like A109…); the family tells types apart and recommends a criticality. They were lost when the demo data
  was renewed.
- **The Control room stands above every Settings page** (owner): not one card among them, but the panel at the top
  of the hub (`CONTROL_ROOM`): how the project works, and what makes it work that way (the control function, who does
  what, releasing, adding people), opening on "Open the Control room". Everyone of ours reads it (`read: true`, "See
  how it works"); an administrator or the control function changes it (`mayChangeControlRoom`; read only otherwise:
  switches shown, nothing chosen). Every page below is what it is built from.
- **A person's activity** (owner): in People & access, a name opens `/settings/users/<id>`: who they are, then everything
  they did in the app with its day and time (signed in, opened a document, downloaded, reviewed, released, sent…), read
  from the audit trail (`GET /api/admin/users/{id}/activity`, narrowed by act and project, 50 a page). Opening a
  document is recorded (`DOCUMENT_VIEWED`, once per person and document every half hour). An administrator or the
  control function only, in Settings only, never on the directory; reading it is itself recorded (`ACTIVITY_READ`).
  Lawful as the register's integrity record, provided people are told it is kept (privacy notice), it is read only for
  that purpose, and the organization sets how long it is kept; some countries also ask staff representatives first.
- A form never sits in a box inside a box: a sheet that opens a form becomes that form (`SomeoneJoins`), and a line
  of a table opened for editing goes on as the row itself (grey fields, then the strip with Cancel and the act), the
  new-document form's way.
- Screens and the backend say "the control function" and "whoever holds Manage" (or "whoever plans"), never a job
  title; a function's own name is shown only as read from the data.
- The plan's starter values are added in one go ("Add them"); Controlled changes no longer exist.
- Removing a review route is "Stop using it", asked first; a permission tick asks first, naming everyone it changes.
- Settings pages use the reference boxes (`rounded-md`, `ring-line`, `bg-tint-soft`), the shared control size, and no
  text under 11px.

### Import & export
- A file is always checked first; the check writes nothing and uses the backend's own rules (`POST /documents/check`,
  the same as registering). Problems name the sheet and row the person sees. Writing names its count; rows with
  problems are left out only after it is said and agreed, and they download to fix and import again.
- A person is never given a password chosen by someone else: Team list (and `POST /api/admin/users` with `invite`)
  emails a link to choose their own (7 days, once); with email off, the link is handed back to whoever added them.
- Import & export follows the Schedule look; exports are grouped (the register, Assurance, the record).
- Each import kind offers two downloads: the list as it stands now (the register, the team, the matrix, every Settings
  list) and an empty template. A register taken out and brought back corrects only what changed; what the number is
  built from may be carried as it is, never changed; a row that matches is counted, not listed.
- Nothing is uploaded in Settings: Settings regulates. Lists come in on Import & export or the Schedule (Settings →
  Controlled changes, an upload with approval, is removed).
- Every spreadsheet read (Schedule lists, Import & export) first passes `SheetGuard` (backend):
  it is what its name says (a workbook is a zip, a CSV is text), a workbook unpacks within 200 MB and 5000 parts and
  carries no macros, the virus check finds nothing (scanner down: refused, said so), a sheet spans at most 100,000
  rows and 500 columns. Screens call `POST /projects/{id}/sheets/check` (`lib/documents/sheet-check.ts`).
- Every CSV we write keeps a cell starting with = + - @ as text (leading apostrophe; a lone "-" or a number stays):
  `csvSafe` (frontend), `ReportEndpoints.Csv` (backend).
- A tip is `Tip` (`components/ui.tsx`): dashed frame on the page's surface (light and dark), yellow bulb, "Tip", bold
  lead; an order that works is numbered `steps`, each a link to where it is done, the current one marked. Never a rule
  or a warning. On Import & export it sits right of the title: the setup order, each step opening its import.

### Reports
- No overview tab: a page repeating the tabs' figures was removed (the owner: no use to anyone). Every tab adds
  something of its own.
- DCIOM (governance measures, advice, health score) is on hold by the owner: build nothing of it until they come back
  to it; where the conversation stood is in `docs/gaps/dciom.md`. Where real projects differ from what the Standard
  assumes (plans move, obligations run both ways, waiting is never compliant…) is `docs/STANDARD-CHANGES.md` §58.
- Each chart is drawn as fits its question (`Chart.Kind`): bars per name; columns per period, oldest left (Transmittal
  log per month, Progress per week); a timeline for Activity readiness (each action placed on the calendar, today to
  the look-ahead). Reviews waiting shows the longest waits, each bar as long as the days waited (`Unit` "days"; the
  legend then counts waits, never adds days), or "By reviewer".
- **Progress by week** (`ProgressAsync`): each week (Monday to Sunday, this one so far) as the register stood at its end:
  registered, released (first time / a new revision), delivered on time or late, overdue (against the plan as it
  stands now, only documents registered by then), reviews open by age, sent and received. Worked out from the dates
  kept, so past weeks are there from day one; no snapshot is stored. The figures say how each moved since last week
  (`Figure.Change`, green or red by whether the move is good). The chart shows one of these at a time, chosen in its head.
- **Who owes what** (`ExchangeAsync`): per other organization, what it owes us (asked and not sent, to correct, to
  revise, next revision due, to update when handed back, an answer asked on a transmittal) and what we owe it (to
  check, to send for review, in review, an answer), since when, due when, late or not; read in the supplier's own
  stages (`SupplierStage`). Another organization reads it too, for itself only, in its words ("You owe", "Owed to you").
- Every report prints as shown (Print, in the plate): landscape, menus and controls left off paper (`.report-print`,
  `@page report`).
- Reports is in the menu for everyone who reads the project. Our people read every report; another organization's
  people read Deliveries against plan and Who owes what, narrowed by the backend to their own documents
  (`ReportIds.Outside`, options `Party`); asking for another report gives them the first.
- Each report: the plate is its own title and question, who it is for and when it was counted; tabs are the report
  titles; one Excel button downloads what is shown (no CSV button, no "Download these lines" label; the CSV
  endpoint stays for other tools). Figures, one chart, then the lines behind it, always shown (paged
  by 50), with a link to where the same lines are worked on.
- Every control sits beside what it changes and acts at once: how the chart is cut (`by`: Deliveries "By who sends it /
  By discipline", Reviews "Longest waits / By reviewer", Progress what the weeks show) and its window ("Next 7 · 14 · 30 · 60 · 90 days", "Last 1 · 3 · 6 · 12 months") are side-by-side
  choices in the chart's head, each a link; a bar's name narrows the lines to it (`bar`, `Report.RowBars`), shown as
  "only <bar> ×" on the lines' head; "Find in these lines" sits on the lines' head (Find lit only while new words
  wait, Clear). The download says it carries the lines shown. No form of dropdowns waiting for an Apply.
- Deliveries against plan has "One bar per": who sends it (each organization, and us as one) or discipline
  (`ReportOptions.By`); the lines carry both. Waiting is never shown as good: a review not late yet is blue
  (under way), not green.
- A review's wait is judged by its step's own due day, never a fixed number of days (`LateSegments` / `LateKey`), as
  the reviews' key on Help says it: In time (blue), Due today or tomorrow (amber, at risk), Late (red, past its due
  day), No due day (grey, the step has no days). Reviews waiting colours and counts each wait so (figure "Late");
  Progress by week judges each review open at a week's end by its steps open then, the latest of them.
- Report colours follow the app's key (`lib/core/rails.ts`): blue is under way, never late (in review, not late yet),
  amber is being prepared or at risk, red is late; a state's colour is the same in the chart and in the table's chip
  (`Stage` keeps blue; `TONE_OF` info → moving).
- Progress by week shows one measure at a time (Released first, then Delivered, Overdue, Reviews open, Sent &
  received); no "All" (tried, the owner: a bad idea). Its windows read "8 weeks · 12 weeks · 26 weeks · 52 weeks".
- Printed, a report keeps its chart's colours, every day reads as its date, the count says when it was made, and a
  list longer than a page says "Lines 1–50 of N; the full list is in the Excel" (`.print-only`).
- Another organization reading Deliveries against plan sees its documents by discipline (never one bar of its own
  name), no "Sender" column ("Sent" for delivered), and the plate in its words.
- Bar names start at the same point, left-aligned, with room for the action's name.
- Numbers are never printed on the bars: the legend gives each state's total, the end of each bar its count.
  Dates in the lines read from today ("3 days ago"), the day itself on hover.
- "Register on a date" is a report of its own, worked out by the backend (`AsOfAsync`): each document registered by
  the end of that day, the revision current then (the latest released by then, not void that day), its status, and
  what is current now. A day to come is refused (DATE_TO_COME). Never a made-up answer: no day chosen, nothing counted.
  Its chart is when the register moved on from that day, not a count of what was current (the owner: no use): each
  document once, in the week (month, past 16 weeks) of its first change since: replaced by a new revision, released
  for the first time, put out of use. A column narrows the lines to what changed then; the lines list the changed
  first, in the order they changed ("Changed on"); documents registered since count too (no line: they did not exist
  then). Before that day, at least 8 periods, back to the last change when none moved in those (a year by week, 3 by
  month), left of a dashed line and paler, say what was moving then, every change counted, registrations included;
  each opens the register as it stood at its end (`on=`). So the chart always shows something once anything was
  registered. The legend counts from the day on. Nothing moved since: the chart stays, with "Nothing has moved since
  that day". Nothing registered by then and nothing since: no chart, said so.

### Home
- Home's to-do lists everything the signed-in person has to do, whatever it
  is: reviews to decide or advise, releases, documents returned, things to send
  (asked for, left to them to say who, to dispatch), transmittals to check or
  acknowledge, uploads owed, drafts, and the schedule (their discipline's
  documents to confirm, postponements to confirm, untagged actions, a failed
  schedule read). Every new kind of work gets a row there.

### Pop-up notifications
- Every notification can also pop up in the person's browsers, even when no
  DELIOS page is open (browser push, `public/sw.js`); clicking it opens the
  page it is about. Turned on per browser on Notifications (the browser asks
  first); which groups pop up (Reviews, Documents, Everything else) is the
  person's choice. Nothing leaves only by pop-up: the notification is still on
  Notifications and Home. The installation's push keys are made once and kept.

### Demo data
- `scripts/demo-schedule.mjs` fills a fresh demo through the API following the
  app's real flow (releases say who receives them and are sent; confirmations,
  a postponement, a notice, a review waiting, a draft), leaving each demo person
  something on their Home. Keep it in step whenever a flow changes.

### Assets & tags
- A tag is numbered by itself, as a package is: its scheme (Settings → Numbering, "Asset tags", `@ASSET`), by
  default P1001-TAG-0001; nobody types it, and it never changes. Tags made before keep theirs.
- Assets & tags is a register, the Schedule's way: plate with counts, search and filters (area, system), the table
  (tag, name, area, system, unit, documents), "New tag" folded under it. Each tag has its own page, the action page's
  way: plate, "Documents that describe it" with "Add or take out" opening the register for it
  (`/documents?pick=asset:<id>`; ticked are linked, untick to unlink, then save; backend `POST /assets/{id}/documents`,
  whoever keeps the asset list), and "Edit the tag" folded (the tag itself never changes; retired only when nothing is
  linked).

### Legal hold
- Document Control or an administrator puts a document on hold, and lifts it,
  each time with a reason. While held: it cannot be retired and no revision
  voided (backend refuses with ON_LEGAL_HOLD). New revisions and reviews go on.
  The document page shows a banner with since when, who and why.

### Ending a document
- Hold and End are separate, never shown as a pair.
- **Void** is for one revision (released in error, or never reviewed).
- **Cancelled**: the document will never be produced; only if nothing of it was
  ever released. **Withdrawn**: it was released and is no longer valid;
  everyone sent a revision of it is told to stop using it.
- **Archived** is never chosen per document: documents are archived with their
  project, and come back if the project is reopened.
- The Details tab has "Cancel or withdraw": both listed, the impossible one
  with why (e.g. "Not possible: rev A was released"). Once ended, the same place
  reinstates it, with a reason (not in an archived project; a withdrawn
  document's recipients are told it counts again).
- Void stays on the revision row. A void can be taken back with a reason by
  Document Control, only on the newest revision and not while on legal hold.
- Stamps next to the number (register and document page): cancelled,
  withdrawn, archived, void, legal hold. The state column stays.
- Every reason (cancel, withdraw, reinstate, void, take back, hold, withdraw
  from review) is in the document's History tab, in full and never cut off,
  and where it matters: an end in a banner, a void on its revision's row, a
  lifted hold or a reinstatement in Details beside the reason it answers.
  Taking something back never erases the reason it answers. No list in the
  Revisions tab repeats History or Reviews.

### Schedule & actions
- The schedule (SCH), disciplines per action (DPA) and requirements (RQL) are
  register documents, revised and released on the document page.
- Their Excel is uploaded on Schedule & actions only by Document Control or a
  function with the Plan permission.
- Released revision: "this file is rev X as released" is ticked by default;
  only when unticked is a reason obligatory. No released revision: a reason is
  obligatory. Always logged. Same on all three uploads.
- Releasing a list document reads its Excel automatically (the schedule, when it
  is the project's schedule; DPA and RQL by their type). The three uploads stay,
  for no document, not released, no Excel attached, or a failed read. They are
  the stages Schedule, Disciplines and Requirements themselves, clickable (with
  an upload icon) only for whoever may upload; "open" is an underline, the fill
  stays "where it stands". Everyone else sees the plain row.
- Actions get our own number (A00001…) and keep the planner's ID beside it.
- Actions with no date are always counted on the plan ("N with no date — in the
  table"), never silently left out of the window.
- No "Responsible" on actions: the people concerned are those of the disciplines
  the action is tagged with, found through the distribution matrix (adjust the
  disciplines in the Excel before upload). Description shows only on the
  action's own page, not in the table.
- "Went ahead?" (after the day): With documents / Missing documents / Postponed;
  "not yet" before the day. Going ahead needs the concerned disciplines to
  confirm; confirming with any of that discipline's documents missing always
  needs an explanation (backend refuses otherwise).
- Risk window: the requirements list may give each document "Risk window (days)";
  otherwise the project's (7 by default, changeable). An action is at risk from
  its day less the longest-reaching window of a document still missing (same
  rule on screen and backend: `riskFrom` / `Activity.RiskFrom`).
- Confirmation per discipline: all its documents released at their status →
  confirmed automatically (live before the day; frozen by the system when the
  day passes, kept even if a document later stops counting). Missing documents,
  placeholders included → the discipline confirms by hand from its risk window,
  always with why it goes ahead without them. After the day a confirmation is
  still taken, always with why (and whether the documents came after).
  Document Control can take a person's confirmation back, with a reason; it is
  kept, marked, and the discipline confirms again.
- Each discipline under "Disciplines concerned": its name and ready count with
  one status chip; the documents not ready listed with where each stands; the
  question in plain words ("Does Mechanical confirm going ahead with the action
  without it? Confirm, and say why"); then one row of buttons (Confirm, Notify,
  Request a document), an opened form taking the width under them.
- Automatic notices (worker job, once each): at risk → each discipline still
  short and not confirmed; day passed → the same. Confirmed disciplines and
  postponed actions are not notified. A discipline still silent some working days
  after the day (Settings → How this project works, `ESCALATE_AFTER_DAYS`, 3 by
  default) is escalated once: its people, Manage holders and Document Control
  are all notified. Nothing marks the action "escalated"; the notice is the record.
- Postponed: written with who decided and why; everyone concerned and whoever
  holds Plan are told; a Plan holder confirms it with what changes (a new
  schedule revision to follow); Document Control can take it back with a
  reason. "Postponed" is any published decision that does not proceed
  (`isPostponed`), on every page. Missing documents are explained per
  discipline, not on the "Went ahead?" card.
- Manual notices everywhere use `NotifyPanel`: the people it would go to are
  chosen, any can be removed or added, the message can change, and it shows how
  many notices were sent on that matter and days since the first (automatic
  ones counted). Kept in the notice log. Sent by Document Control, Plan
  holders, or (about a review) whoever started it.
- Requests, confirmations and answers travel as transmittals in one thread
  (Standard §54, `ActionLetters`): a checked request asks its confirmer
  (Request), the confirmation or answer replies to whoever asked (Confirmation /
  Answer, Document Control copied in), a postponement asks whoever plans
  (Request, the concerned copied in) and its confirmation or take-back replies;
  people to confirm likewise. Answering one acknowledges it. Automatic notices
  and escalation stay notifications.
- "Request a document" (concerned discipline or Document Control) opens a
  transmittal to Document Control with the file attached; Document Control
  adds the number to the action. No status or date is asked.
- Under "Disciplines concerned", anyone of ours sees "Is a discipline missing, or
  one that should not be here?" with a plain link "Request a discipline", and under it "Is a document missing from
  this action?" with "Request a document" (a concerned discipline, or Document Control), the links in one column: a transmittal to Document Control; their answer
  (the disciplines saved) is the record. "Disciplines and documents" shows both as a
  list with one edit icon each, on the right.
- A discipline whose documents are all released at their status, on an action
  still ahead, is told so once, automatically ("nothing is asked of you").
  A notice by hand says where the discipline stands: confirmed automatically, by
  hand (going ahead or not, with why), ready, short (still to come, at risk, day
  passed), or the action postponed.
- The transmittal remembers the action and what it asks (a document, or a
  discipline). Until Document Control answers (adds it, or "Nothing to add"
  with why), it is on their Home and at the top of the action's "Disciplines
  and documents"; the transmittal page says where it stands. Whoever asked is
  told the answer.
- "Disciplines and documents" on the action is Document Control's only (and
  an administrator's): it tags the disciplines by hand, and opens the
  register for the action to choose its documents. There, what the action
  needs starts ticked: tick to add (for one of its disciplines), untick to
  take off, then save. The ticks stay through search, filters and pages. The
  register's selection has "Add to action" too, and so has a document's
  "Used in" tab. A document is always needed for its own discipline (its
  metadata), never one chosen when adding it; only actions that concern that
  discipline take it. A document added by hand gets the same purpose and status
  as the requirements list uses when it says nothing (`needDefaults`), due by
  the project's lead before the day.
- With Document Control, only Document Control adds documents and disciplines
  to actions by hand; whoever plans does it only by uploading the lists
  (`fromList`). Not planners by hand, not authors.
- Who adds a document or a discipline to an action, and who adds people to a
  project, are two acts in Settings → Who does what (`ACTION_LINKS`,
  `PROJECT_PEOPLE`): with Document Control or without. With Document Control,
  a tick "Requests need management confirmation" (`CONFIRM:{act}` = ON):
  unticked, Document Control applies it; ticked, Document Control checks it,
  management confirms or refuses with why, and what was asked is applied by
  itself. Without Document Control: the people of a discipline add to actions
  for their own discipline themselves (the planner is told), and management
  adds people. Requests already open finish the way they started.
- Management is the Manage permission (`MANAGE`) on a function (project,
  construction, engineering manager…). When a confirmation is sought, its
  holders are proposed first; anyone on the project can still be chosen.
- A request with confirmation: Document Control checks it on the action
  ("Checked — send to confirm": exactly what changes, and who confirms); the
  person asked confirms or refuses with why under "Your confirmation" on the
  action; confirmed, it is applied by itself. Whether a request needs it is
  fixed when it is raised. Each stage is on Home.
- People with confirmation: someone added (or put back) on the project stays
  off it until management confirms them on "People to confirm"; refused, they
  stay off with why, shown on People & access. Administrators setting a
  project up are not held. Without Document Control, Manage holders add people
  (and reach People & access); with it, Document Control of that project does.
- "Went ahead?" before the day reads "Answered after the day" and asks
  nothing. A postponement is recorded behind "Will it not go ahead? Record a
  postponement": who decided is picked from the people on the project, of
  any organization (the same picker as transmittals), with why.
- Progress on an action never shows a step open between two done: the first
  document's due day belongs to "Every document ready", and "Disciplines
  confirmed" counts automatic confirmations as the card does.
- Filters: a dropdown picked with the mouse applies at once; with the keyboard,
  on leaving it. Apply lights only while typed words or dates wait. Every filter
  is kept through sorting, paging, load more, the key and export.
- Progress on an action: a date still to come is shown as due, never as done.
- The schedule's date reads from today, never "overdue": "40 days ago · lasted
  3 days", "Today", "In 5 days · lasts 3 days".
- Where a document got late: its checkpoints are named for the act (Sending
  for review, each review step, Release, Issue) and their dates say whether it
  happened. The documents' day already leaves the review its time before the
  action: sending for review (or the supplier sending it in) is due on the
  documents' day; released & issued on the action's day. No route is guessed,
  no days counted back. Route steps lists only the review's own steps, each with
  its own due day. Released and issued as one act (the default): one checkpoint
  and one column "Released & issued", "Done <day>" over "Action's day <day>";
  when the project separates them, two columns, Released and Issued.
- Under each stage of Schedule & actions: the revision in force, "Uploaded
  directly" (with the day) when a direct upload is newer, "Not released yet",
  or "None yet".
- An action whose dates the latest schedule read moved carries a "moved" stamp
  in the table and on the plan; its page says "Moved by rev C: was … , now …".
  The stamp goes when a later read leaves its dates where they are.
- Who may upload the lists is one rule, `mayUploadLists` (`frontend/lib/core/permissions.ts`):
  Control or Plan held outright, as the backend checks. Configure does not count.
- "Documents ready" counts only the actions in a window: a month either side
  of today, or the dates the user filtered on. Never the whole schedule.

### Backend — limits and steps that bit before
- **Never hardcode a function or a job title** (owner): no "Document Control", "management", "project manager" in
  backend code, messages or comments. Functions are the organization's data. Say **the control function** (whoever
  holds CONTROL on the project) and **whoever holds Manage** (or another verb); a name shown is read from the data
  (the function's own name). The demo data's starter functions are data, not code.
- An outbox routing key is at most 16 characters; `ControlledVersion.VersionLabel` too.
- Migrations: `dotnet ef migrations add Name -p app -s app -o Platform/Migrations`
  (from `backend/`). Each new table gets `RowLevelSecurity.Enable(migrationBuilder, "<table>")`.
- Row-level security is forced, even for the table owner: a data backfill loops over
  `tenants` and sets `set_config('app.tenant_id', …)` for each.
- Organization defaults are added through `DemoSeed.Ensure*SetupAsync`, which adds only what is missing.
- A function's clearance limits what its holders read (Standard §46); visibility always goes
  through `DocumentQueries.Visible`.
