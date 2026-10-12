# Working on DELIOS — read this first, every session

## Where what we agreed is written

Read these before changing anything they cover. When a decision is made in
conversation, write it into the right one in the same commit as the code.

| File | Holds |
|---|---|
| `CLAUDE.md` (this file) | How to work with the owner, and the rules that must never break |
| `docs/STANDARD-CHANGES.md` | What the original Document Management Standard must change to match what we built. Every new rule about controlling information goes here. |
| `docs/REVIEW-MODEL.md` | The review model: routes, steps, advice, verdicts, release |
| `docs/BEHAVIOUR-CHANGES.md` | What behaves differently since the screens moved onto the backend |
| `docs/DETAIL-STYLE.md` | The reference style (Schedule & actions, the action page): what "apply the same" means |
| `docs/gaps/*.md` | Known gaps per area |
| `PRODUCT.md` | Product context and users |

## How to work with the owner

- Short, plain replies. No jargon. PowerShell commands one per block.
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
- Do not run the tests unless asked; do compile (`dotnet build`, `npx tsc --noEmit`).
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
- One control size everywhere, set once in `src/app/globals.css` on `:root`:
  `--control-h` (2rem), `--control-text` (13px), `--control-radius`. Every
  field, dropdown, button and file field stands that height with that text.
- Use the shared pieces only: `btn()` and `inputCls` (`src/components/ui.tsx`),
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
  person may choose another.
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
- Every document registered with an outside organization as its originator is
  filed in that supplier's package, one per supplier and purchase order, made
  by itself with the first document (`SupplyFiling`). Document Control (and
  above) looks after it: renames it any time; renumbers it, or deletes it while
  empty, only until it is shared or sent; adds or takes out documents through
  "Add or take out documents": the register opened for the package
  (`pick=pkg:<number>`, filtered on that supplier and order), tick to add,
  untick to take out, then save. One already sent to the supplier stays (backend
  SENT_TO_SUPPLIER; its tick is locked).
- A supplier package has two pages. Ours (Document Control and above): plate,
  counts (sent to supplier, received, held by them / by us, approved first
  time), "The package" with one row of icon buttons (Share once, Send to
  <supplier> (n), Add or take out documents, Narrow by a rule, Edit, Delete
  while allowed, Delivery list), and the documents with where each stands and
  what is next for us. Nothing is uploaded on our page: no file fields, no
  "enter and send for review" (what reaches us outside the system is recorded on
  a transmittal, "Received from outside the system"). The supplier's page: only
  what was sent to it, in its words, the comments to take in, a file field
  beside each document it holds, and "Send to <us>".
- "Delivery list" downloads the package's own lines (`/api/packages/<n>/list`),
  never the schedule's requirements list.
- "Share with <supplier>" is pressed once, for good: until then the supplier
  does not see the package. Once shared, it sees there only the documents asked
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
  list (`packageStage`): not shared, nothing sent yet, sent to supplier / to be
  transmitted, partly received / partly transmitted, received / transmitted,
  complete; with how many are not sent to the supplier yet. The list and the
  package page count the same way (`packageCounts`).
- Document Control (and above) only, on supplier packages; delivery packages
  keep their owners.
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
- A supplier's document reads in its own states (register, document page,
  package, the supplier's panel): Sent, Received, Accepted, Returned (by
  Document Control's check, with why), In review, Released & issued, Returned
  (rejected by the review); who holds it is said beside it. `supplierStage` and
  `RegisterEndpoints.SupplierStage` work it out the same way.
- A planned date says what it means today, the same everywhere (register,
  document Details, package lines, the supplier's schedule; `plannedState`):
  ready (released), submitted (received, accepted, in review), overdue · N
  days, due today, at risk · N days left (inside the risk window), in N days.
- A supplier sees, of our schedule, only "Where your documents are needed"
  (`/needed`, in its menu as Schedule; `/supplier-schedule`): the actions that
  need its documents, and in each only its own documents, with their stamps
  in its words and the planned-date state. Never other documents,
  disciplines, confirmations, notices, or why an action moved; a postponed one
  reads "date to be confirmed". Our schedule pages stay ours.
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
- The form asks the family (data or information), then a reason of that family
  (`REASONS_FOR_ISSUE` prop `family`). No "sent by" and no date: it is the
  person signed in, today. "Received from outside the system" (Document Control)
  is a tick, and only then are who sent it and when asked.
- Information reasons: REQUEST, RFI, ANSWER, CONFIRMATION (family Information);
  an existing demo gains them with `seed-demo`. A reason with no family is data.
- A new transmittal lets Document Control ask placeholders not asked yet, one
  supplier's at a time ("Ask placeholders of a supplier").

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
  postponed actions are not notified. A discipline that never answers stays open.
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
- "Request a document" (concerned discipline or Document Control) opens a
  transmittal to Document Control with the file attached; Document Control
  adds the number to the action. No status or date is asked.
- Under "Disciplines concerned", anyone on the project sees "Is a discipline
  missing from this action? Request it": a transmittal to Document Control
  asking for that discipline.
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
  happened. Before a review exists, sending for review is due the route's days
  working days before the day it is needed (the route that serves the
  document, in the project's calendar). Route steps lists only the review's
  own steps. Released and issued as one act (the default): one checkpoint and
  one column "Released & issued", "Done <day>" over "Needed by <day>"; when the
  project separates them, two columns, Released and Issued.
- Under each stage of Schedule & actions: the revision in force, "Uploaded
  directly" (with the day) when a direct upload is newer, "Not released yet",
  or "None yet".
- An action whose dates the latest schedule read moved carries a "moved" stamp
  in the table and on the plan; its page says "Moved by rev C: was … , now …".
  The stamp goes when a later read leaves its dates where they are.
- Who may upload the lists is one rule, `mayUploadLists` (`src/lib/permissions.ts`):
  Control or Plan held outright, as the backend checks. Configure does not count.
- "Documents ready" counts only the actions in a window: a month either side
  of today, or the dates the user filtered on. Never the whole schedule.
