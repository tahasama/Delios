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
- Never say "escalation" or "escalate" (owner), on screens or in replies: it is a **notification** ("notified again").
- To update the owner's copy: `git pull`, then `docker compose --profile app up -d --build`. The app's own services
  (API, worker, screens, migrations) carry the profile `app` in `compose.yaml`; without it only the dependencies start
  (database, storage, queue…), for running the API by hand. `COMPOSE_PROFILES=app` in `.env` makes it the default.
- Never send screenshots or pictures.
- Never quote a bare document number as a reference.
- Ask before choosing any code (status, verdict, type…). A code never changes once used.
- Nothing is deleted except by the app owner. Exception: an empty package
  that never went out may be deleted by whoever composes it (it holds no content;
  removing a package never removes documents).
- **Two levels of settings** (owner, for every setting): the organization's level is everything the app gives by
  default, adapted by its administrator, and it is the default of every project; the project's level inherits it and
  changes only what the organization left free. **Two Settings with the same cards** (owner): the organization's
  Settings (`/organization/settings`, administrators) open each card on the organization's version; a project's Settings
  open the same cards on the project's version, with fewer rights. An administrator changes the organization's only in
  the organization's Settings; in a project's Settings they act as that project's admin (the control function's
  rights), nothing more, and nothing there changes the organization's. Each card of the organization's Settings carries
  its switch on the page itself (`ProjectSwitches`; backend `Settings/Liberty.cs`, `LIBERTY:<key>`; the separate
  page `/organization/liberty` only redirects; pressed, a switch asks first, "From now on… Instead of…", as the Control
  room's answers, `LibertyRow`, and a refusal is said under it), and lists the projects with their own copy (`ProjectCopies`): there,
  and only there, one may be put back to the organization's, for a mess, always with why, logged (SETTING_RESET), the
  project's control function told. No reset inside a project, ever. **What a project changed is never overridden by the
  organization** (owner): a switch made Fixed later leaves it as it is; only that reset touches it. **A reset keeps a
  copy** (owner): what the project held is kept whole (`Settings/KeptCopies.cs`, `kept_copies`), listed on the card under
  "Kept when put back" (when, by whom, why), and may be put back on the project, with why, its control function told
  (`POST /api/admin/kept-copies/{id}/put-back`, SETTING_PUT_BACK; refused while it has its own copy again, OWN_AGAIN). **Three levels** (owner): the app's
  defaults (with what it fixes) → the organization's (the app's, as its administrator changed them; with what it
  fixes) → the project's (the organization's, as the project changed them where free). Nothing changed: both read the
  app's; the organization changed something: the project reads the organization's. The organization may reset to the
  app's defaults, **keeping a copy of its own** (built: replacing the defaults for new projects, from a project or back to
  the app's own, asks why and keeps what they held first, `Settings/OrganizationDefaults.cs`, `PUT /api/admin/project-defaults`,
  a kept copy with no project, kind DEFAULTS; listed on the defaults' page, "Kept when replaced", and put back with why,
  which keeps what stands in its turn);
  a project goes back to the organization's ("Back to the defaults", Control room). **Fixed** (every project uses
  the organization's; only an administrator changes it, for all) or **Free** (a project may take its own copy; the
  organization's later changes never touch it). Two degrees only, never a third, with one exception (owner, "both"):
  **Fixed, except on the projects named** (`LIBERTY_EXCEPT:<key>`, `PUT /api/liberty/{key}/except`, always with why,
  LIBERTY_EXCEPTION, the project's control function told): only those projects may take their own copy; ended, what
  the project changed stays; counted only while fixed; every check reads it per project (`Liberty.IsFreeAsync(db, key,
  projectId)`, `RoomRefusalAsync(…, projectId)`, `GET /api/liberty?projectId=`, `projectLiberty`). Drawn under each
  fixed switch (`LibertyRow`). A project's pages say it, with its reason ("Free here by an exception: the organization
  keeps … the same on every other project", `ExceptionNote`; each project endpoint's `exception`, `Liberty.ExceptionHereAsync`;
  a Control room answer's `Choice` `exception`). Which projects are exceptions, and why, only an administrator reads;
  anyone else reads only the project asked about. **What a project changed** is read on the organization's Settings (`?project=<id>`,
  `OneProject`, backend `ProjectDifferences`): its own copies, changed answers, exceptions, each opening its card; read
  only, changed in the project's Settings. Made stricter later, what a project
  already changed stays, read as changed before the rule. Where each starts, and why, is in `Liberty.Items`, chosen
  from what depends on it (numbering, revisions, cross-project search and reports, the meanings the app reads, the
  law, security), never from an example. Each list of Types & sets has its own switch; a list a number part reads
  follows the numbering. No switch: the organizations and their identity, sign-in, what is kept about activity, the
  audit trail and the defaults are the organization's; the project itself, its organizations, people, control
  function, distribution matrix and checks switched off are the project's.
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
  Display preferences (theme, sidebar width, a pane's width: `components/resizable-pane.tsx`) live in cookies the server reads.

## Design — locked in by the owner

- The look of Schedule & actions and of the action page is the reference for
  every page, card and form, including the hidden ones (panels, popovers,
  details). It is written down, with the exact classes, in
  `docs/DETAIL-STYLE.md`. When the owner says "apply the same", follow that
  file to the letter; do not restyle the reference pages.
- One control size everywhere, set once in `frontend/app/globals.css` on `:root`:
  `--control-h` (2rem), `--control-text` (13px), `--control-radius`. Every
  field, dropdown, button and file field stands that height with that text.
- The brand's gold is one colour, `gold` / `gold-bright` (`scripts/gen-theme.mjs` → `app/theme.css`), never typed as
  a hex on a page.
- Use the shared pieces only: `btn()` and `inputCls` (`frontend/components/ui.tsx`),
  `.ask`, `.plain`, `ActionForm`. Never give a field or button its own height,
  padding or text size on a page; never restyle the file button locally.
- Every field and dropdown stands on the same hint of grey (owner): `inputCls` and every `.plain` control in a
  register (not only a register's question), its top corners barely rounded; a switch drawn as a plain button stays bare.
- **A field that cannot be changed looks unavailable at once** (owner: "blocked fields must look unavailable"), never
  only under the pointer: no grey behind it, a dashed rule, muted words, no caret, the pointer saying no (`globals.css`,
  `.register .plain:disabled`; `inputCls` likewise). A form opened under a line sits on white, so its grey fields show
  (owner: "fields are the same colour as the background").
- **The menu never scrolls** (owner: "we can't have a scrolled menu, it should be fixed at all times";
  `app/(app)/navigation.tsx`): it fits the window, tightening on a shorter one (`short:` under 880 pixels high: the lines
  under the names go, smaller marks; `tiny:` under 740: tighter still; `tight:` under 680, rows and marks at their closest; variants in `globals.css`;
  checked in a browser to fit, "+ More" open, down to about 540 pixels; owner, after rows too close: "add some space"), scrolling only as a
  last resort on a very small screen. It holds the work only: no "Create document" (the register's "New document" does
  it), no Settings and no Help (owner: both are in the top bar, Settings as a gear beside Help, for whoever a Settings
  page opens to); folding it to icons is the menu's last line, "Fold the menu" (owner: "now we can squeeze the expand
  button into the bar"; it was a round button on the menu's edge). The rest of the
  menu stays as it is (owner: no regrouping of its entries), but for Reviews and Packages, daily work, moved above
  "+ More" (owner: "the separator should be after packages"). **One frame** (owner: "both side and top bar need a proper
  update"): the menu's mark and the top bar are the same height (`h-16`) and closed by one line. **The page you are on is a light row** (owner: the gold, larger tile was bad), its icon the size of
  every other; faint words at least slate-400 on the navy. **"+ More"** is one small line taking almost no room (owner:
  no separator), "− Less" once open, remembered as it was left (cookie `nav-more`, read by the server), open by itself
  while you are on one of its pages, named on hover when the menu is folded. **The top bar** (owner: "icon's order makes
  no sense"): the project's name with its code faded beside it, nothing more (no function, no "we are …": who you are
  and what we are on it, you know already), its width capped; then search · Help · Settings (lit while in them) · the
  bell · your name alone with a small arrow (no initial disc), every tool and the search at the control height
  (`top-tools.tsx`, `TOOL` / `ToolLink`). Light or dark is chosen in your name's menu, three plain choices, Light · Dark ·
  Same as device (`ThemeChoice`); Help is not repeated there. The top bar's menus (`details[data-menu]`, your name's,
  the project list) close on picking, on Escape and on a click outside (`components/menu-closer.tsx`); the project list
  scrolls past a height; the phone's menu closes the same way and carries the search.
- **A page never stands blank while it is read** (owner, "skeleton loaders"): each area's `loading.tsx` draws its outline
  in quiet grey (`components/skeleton.tsx`: `RegisterSkeleton` for the registers, `DetailSkeleton` for one thing's page,
  `PageSkeleton` for the rest, `(app)/loading.tsx` for any page without its own), saying "Reading …" to screen readers,
  still for whoever asked for less motion. A filter changed on the same page keeps what is shown until the new answer.
- **The quick find** (owner, "command menu" with its "shortcut hint"): Ctrl K (⌘ K on a Mac) anywhere opens one box
  (`components/command-menu.tsx`, mounted once in the layout): pages by their name at once (only those the person may
  open, as the menu), and documents, transmittals, actions and packages by number or name through the backend, a
  handful of each (`quickFindAction`, `lib/core/forms-find.ts`: documents by number and title only, never their files;
  each read as the person may read it). Arrows, Enter, Escape, a click beside it. The top bar's search shows the key
  ("Ctrl K"), a click on it opening the box; typing in the search and Enter still searches the register.
- Long titles wrap into lines of even length (`text-wrap: balance` on headings, `globals.css`); body text is left as it is.
- A card's side colour is its own left edge (`border-l-[3px] border-l-(--rail)`), never a bar laid over it: it
  follows the rounded corners. A sheet left open (`register-sheet-open`) rounds its first and last strip seen (a hidden field or a
  mark before it does not count; a form wrapping the strips passes it on), so no band's square corner stands out.

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
- **Delegate and add in copy, in flow** (owner: "delegate existed already but was only visible to the person that has the step…
  we could use the already existing one that appears in the verdict card"; "people need to understand they are not
  delegating, just adding as cc… write cc'd"): **Delegate** is the answer card's one button, opened to the control
  function and whoever holds Manage, of ours, too, who choose **whose step** (a seat on the open step not answered yet,
  their own first when they sit there; `DelegateRequest.FromUserId`, CONTROL_OR_MANAGE) and hand it to anyone of ours on
  the project, the control function included (the matrix's people first, anyone else flagged; nobody already on that
  step, who answers their own seat), until a date, why optional; the control function's in force at once, Manage's
  waiting for the control function where it carries out DELEGATE; both people told. **Add in copy** is a link in the
  review's title, "Add in copy?", as Withdraw and Notify, its form folded under the document (`?open=copy`,
  `change-people.tsx`; owner: "be smart", never "cc'd" on a screen): people added in copy like "Copy to (cc)" (`Reviews/StepPeople.cs`, `GET`/`POST /reviews/{id}/people`, REVIEW_PEOPLE_ADDED), told now
  and of what comes of it, never asked to review, why optional. Adding someone to a step was built and taken out (owner:
  "the same as delegate"): who answers a step changes only by a hand-over. The reviews register has no "Kind" column
  (owner: it always read "decision"; every line is a whole review, which ends in its decision).
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
- **The box decides what a file is** (owner: "it should instead show user why simply"): the PDF box takes a PDF, the
  source file box the editable original; a PDF in the source box, or a source file in the PDF box, is refused in plain
  words naming the right box (`UploadRequest.Slot`, SOURCE_IS_PDF / NOT_A_PDF, the box outlined). On a new document the
  register entry stays and its page says why the files were not attached ("Registered, without its files"). Under each
  box of Edit rev, what it holds now ("Now: <name>", the source file with its kind) or "None yet" (owner).
- **A draft is replaced, never kept** (owner: "those files have no value unless they are past that stage"): while a
  revision is in preparation and nothing has looked at its files (none came on a transmittal or was checked on arrival,
  no transmittal carried them, no review of the revision), a new file takes the place of the one of its kind, record and
  bytes, with no new submission (`DocumentService.ReplaceDraftAsync`, DRAFT_REPLACED "PDF replaced: old → new" in
  History); the bytes and previews go once committed (`DraftReplaced`, the worker); the same file sent again changes
  nothing (SAME_FILES, said, the details still saved). The database allows deleting only such a draft or an upload never
  used (`stored_files_kept_unless_draft`); every other file stays, every revision's. The copy elsewhere keeps what it
  copied (the copier never deletes; a key gone before it was copied is skipped).
- Past that, a new file replaces the one of its kind as a new submission; the other file is carried into it as a record of its own,
  with its own copy in storage (`FileStorage.CopyAsync`): a storage key belongs to one record only (the shared key broke
  adding a PDF beside a source file).
- A fault of ours (a 5xx with no refusal code) never shows the server's own words: "Something went wrong on our side and
  nothing was saved…" (`problemOf`, `lib/client.ts`).
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
  that mean different things; close states take close colours (released emerald / a review's accepted green, done /
  ready, superseded violet). **Accepted by the check is never green** (owner: it is only the first step of a long
  review; near released it would read as approved): fuchsia (`rail-checked`, `STATE_LOOK.ACCEPTED`), in the register, the
  transmittals, a package's lines and the key alike. The states and their classes are listed once in `lib/core/rails.ts` (CSS `.rail-*`), which is
  the key on Help, "What the colours say". Every list of documents takes them, the package lists too (a supplier's
  line by its stage, a delivery line by ready / released short of its status / nothing released); a card (Next step)
  takes none.
- **The stamp is a Settings card of its own** (owner: "an engagement that legally holds"; "make a card in settings";
  "what applies on something applies on everything"): Settings → **The stamp** (`/settings/stamp`) and the organization's
  same card (`/organization/settings/stamp`), one form saved as one (`components/stamp-card.tsx`, `stamp-fields.tsx`,
  `setStampAction`; the keys and defaults in `lib/settings/stamp.ts`, read by the worker the same way,
  `Stamping.StampChoices`). Two levels: the organization's answers are every project's default; where its switch
  (`POLICY_PDF_STAMP`, area "The stamp", Free by default) leaves it free, a project keeps only what differs from them
  (refused otherwise, ROOM_FIXED). The card: **stamped or not** (`POLICY_PDF_STAMP`); **when** a review stamps the revision
  it decided (owner: freedom): released after its review (`STAMP:RELEASED`, on) and returned by it (`STAMP:RETURNED`,
  on: owner, "reject stamp didnt appear"; to its author or to its sender for correction alike); released without a review, nothing to stamp. **One design, whatever the outcome** (owner: "the stamp is unified"):
  a rounded frame, modern (owner: "looks good but old"), in the colour its revision's state has in the register (owner:
  released emerald, returned rose); the reviewing organization's name and the project; **the outcome
  alone** (owner: "show only the outcome… for space management"), a tinted badge, words only (owner: no tick, no
  "Document review", the outcome no larger than needed), its short code people
  cite and its words ("C1 — Accepted"; a code longer than 4 characters only repeats the words, left out); "Reviewed by"
  and "Date" (the standing verdict's, the most severe of the deciding steps) only when every grade given is not shown
  (owner: "reviewed by repeats the steps"); then (`STAMP_SHOW:<what>`) every grade given as a small table, STEP · GRADE
  · BY · ON (on), what it is released for, the document and its revision, the review's number (off), **the time with
  each date** (`STAMP_SHOW:TIME`, off: the date only by default); why, the comments on a last page (`STAMP_COMMENTS`,
  off); and the organization's words at its foot (`STAMP_NOTE`, what the review does not relieve the sender of, as its
  contracts say it; none unless written, 240 characters). **How large** (`STAMP_SIZE`, S · M · L · XL = 0.8 · 1 · 1.25
  · 1.5, Normal by default): frame and words grow or shrink together. **Where it sits** (`STAMP_PLACE`,
  top right by default, or another corner). **Never over the drawing** (owner: "the usual placement might be filled"; "the stamp is automatic to prevent
  falsification"): each page is looked at as a picture (PDFium, `Docnet.Core`, read only; `Reviews/StampPlacement.cs`)
  and the stamp put on the first clear spot: the chosen corner, the others, then along the edges; none, the same search a
  step smaller each time down to S; still none, the spot with the least drawing under it, at S. **Always on its page**
  (owner: "the stamp would definitely find a room… no need to add a page"; `StampPlacement.Choose`). Before the release
  or the send-back, the control function may move it and resize it by hand on the review's page ("Where the stamp
  goes", the first page with the stamp's frame where and at the size the app found room; dragged, its corner dragged
  for the size, half to twice its size; `stamp-placer.tsx`, `GET`/`PUT /reviews/{id}/stamp-place`,
  `Revision.StampX/StampY/StampScale`, STAMP_PLACED with from → to; "Back to the app's place"): only its place and
  size, never what it says; fixed once the stamp is made (STAMP_FIXED). No verification code on it (owner: it adds no authenticity). **The marks across the page**, as they were (owner): superseded, void, on
  hold (`STAMP:SUPERSEDED|VOID|HELD`, on). Beside the form, the stamp drawn on a page as it will read (22.5rem wide by default, owner: "50% wider"), dragged larger by its left edge (owner: "give more by making it
  resizable"; `ResizablePane`, cookie `pane-stamp`; the stamp drawn to the page's scale) (`Stamping.Stamp`,
  `StampFace`; a code with no name reads as words, "No comment", never the app's code). The Control room only reads it, one line on each step that stamps, with "change" to the card; the Defaults for
  new projects no longer carry it. The PDF opened from a document is its marked copy (`openCopy`, `lib/documents/copies.ts`), of its newest
  submission only. **The document's Preview follows the newest revision** (owner), whatever its state, named on its tab
  ("Preview · rev B"): just started, nothing until its PDF is in; prepared or in review, its own newest PDF; returned, its
  returned copy; released, its stamped copy. A file just uploaded shows by itself once the virus check passes it (owner: "the preview does not refresh"): while one of the newest is being checked the page says so and reads itself again every few seconds (`FilesChecking`, three minutes at most), on the document and the review. **The Preview shows the source file too where
  the page can** (owner: "images, excel workbooks"; `components/file-preview.tsx`, `FilePreview`): a picture (JPG, PNG,
  GIF, WebP, AVIF, BMP; SVG stays a download, it can carry code) as itself, an Excel workbook (.xlsx, .xlsm) as its sheets
  (`components/workbook-view.tsx`; backend `Documents/WorkbookView.cs`, `GET /files/{id}/workbook`: each sheet's cells as
  Excel shows them, last calculated values, bold, merged cells, widths; nothing in it runs; the first 2,000 rows and 100
  columns of 30 sheets, said when cut), a CSV file as one sheet (`WorkbookView.ReadCsv`), a Primavera P6 export (.xer) as P6 lays it out (`components/schedule-file-view.tsx`;
  `GET /files/{id}/schedule`, the same reading as the schedule's: each project on its tab, opened on the one the schedule reads (marked "the schedule"
  when there are several, so it counts what the plan counts), its activities under their
  WBS, each folded open or shut, ID · name · type · start · finish, "A" once it happened; what the schedule would make
  of it said above when it would not read it); with a PDF too, "The PDF · The source file · <its kind>" above it, the PDF first, offered whenever both are
  there (owner: "i have no way to visualize one or the other"): a source the page cannot draw says so with its download.
  The bar above carries the file's name, a zoom (owner: "some control like a zoom"; − 50…300% +, the percentage back to
  100%: the PDF opened at it, a picture, a workbook or a schedule scaled), its download, the **Full page** icon (owner: the same Preview, its bar and all, over the whole window in a new tab,
  `/preview?pdf=…&source=…&show=…`, `app/(start)/preview`; the backend still checks every file), and over a PDF (an office file's too) the switch **Dark page** (owner, off by default: the page dark, its text light, hues kept so a stamp stays green or red; the file never changed; cookie `pdf-dark`). Switched on, the PDF is drawn by the page itself (pdf.js, `components/pdf-dark-view.tsx`, nothing in the file runs; its worker copied to `public/vendor/pdfjs`), pages on the app's surface and only the pages darkened (owner: darkening the browser's reader whole turned its own bar and side panel light), under a bar of its own (owner: "where is the bar?"): the pages' panel, page n / N, fit to the width or the whole page, turn, print (the PDF as it is). **Tabs read as tabs in the dark** (owner): the chosen `.segment`, and the chosen side of a `.choice`, stand raised in light. The PDF is never darkened by the theme alone (following the mode, the browser's reader darkened with its bar hidden, was tried and taken out: owner, "bring back this one"). **Every
  other kind the owner asked for** (`docs/gaps/previews.md`): an old Excel .xls as its sheets (values only, ExcelDataReader);
  plain text (.txt, .log, .json, .xml, .md, .yaml…) as text, its first 2 MB (`GET /files/{id}/text`); Word, PowerPoint
  and their kin (.doc/.docx, .ppt/.pptx, .odt, .rtf, .vsdx…) as the PDF LibreOffice makes of them (Gotenberg service,
  `GET /files/{id}/as-pdf`; **on standby** by the owner, compose profile `office`, off by default: offered to download,
  their PDF being the revision's); drawings: DXF drawn in the page, DWG turned into DXF first (LibreDWG, the free route,
  `deploy/dwg`, `GET /files/{id}/as-dxf`; a full DXF the viewer cannot draw is asked again once in its minimal form,
  `?minimal=1`, `dwg2dxf -m`, kept apart; still failing, the viewer's own reason is said; above every drawing, "For viewing only": what the free reader leaves out,
  the revision's PDF being the reference, owner), its layers switched on and off, text in DejaVu Sans, drawn on the theme's surface (light or dark, as the app; `use-dark.ts`); 3D models: IFC (web-ifc
  in the browser, its kinds of element as parts, spaces and openings hidden at first), glTF/GLB, OBJ, STL (three.js),
  turned, moved, zoomed, each part shown or hidden. A conversion is made once, the first time the file is opened, and
  kept in storage beside it (`previews/…`); converters not installed or failing, the file is offered to download with
  why (`Documents/Previews.cs`, `Previews__OfficeUrl` / `Previews__DwgUrl`). A drawing reads "For viewing only · the revision's PDF is the reference" above it
  (owner: the long warning was "too long"), closed by its × for good (cookie `viewing-note`). **Every reader is a switch,
  on two levels** (owner: "all readers in that card, that we can switch on and off"): Settings → **Viewing files**
  (`Documents/Viewers.cs`, keys PICTURES, WORKBOOKS, SCHEDULES, TEXT, DXF, DWG, MODELS, OFFICE, DWG_CERTIFIED; settings
  `VIEWER:<key>`, only "OFF" kept; VIEWER_SWITCHED). The organization's card (`/organization/settings/viewers`,
  administrators; `/organization/settings/drawings` only redirects) lists every reader, free, heavy on the server
  (Office) or paid (a certified DWG reader): one installed is switched at once; one not installed or not built is asked
  of DELIOS by its switch, which opens the ask under its line (`POST /api/admin/product-requests`, PRODUCT_REQUESTED,
  kept above every organization, `product_requests`, backend command `requests`, emailed to `DELIOS_CONTACT_EMAIL`).
  A project's card (`/settings/viewers`, read by everyone of ours) shows only the readers the organization has on, the
  control function switching them off and back on where the switch `VIEWERS` (area "Viewing files", Free by default)
  leaves it free. A reader off: the Preview offers the file to download, saying so, and the backend refuses its preview
  (VIEWER_OFF); the PDF is always shown. Under a DWG that does not open, only an administrator reads "A certified reader
  opens these: see Settings → Viewing files". The viewers' WebAssembly and font are
  copied from their packages at build (`scripts/copy-vendor.mjs` → `public/vendor`, not committed). The review's page shows the same copy of its revision; its document column is dragged wider by its right edge,
  the side cards going under it once there is no room beside it (owner; `ResizablePane`, cookie `pane-review`; a double-click puts it back).
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
- **Packages in packages** (owner: "a lot of orgs, especially clients, ask for an arborescence"; Standard-changes §81):
  a package may sit in another (`Package.ParentId`), of the same kind (PARENT_OTHER_KIND), a supplier's only in the same
  supplier's (PARENT_OTHER_SUPPLIER), the one it sits in still open (PARENT_CLOSED), as deep as wanted, beside its own
  documents. **Its own number, place shown** (owner): the number never changes; the packages above it lead to its name
  (`PackagePath`); moved inside another or to the top while open by the control function ("Where it sits",
  `PUT /packages/{id}/place`, PACKAGE_MOVED with where it was; a supplier's until shared, PACKAGE_SHARED; never inside one
  of its own branches, INSIDE_ITS_BRANCH). **Each delivers alone, counts add up** (owner): every package keeps its own
  check, delivery and acceptance; "Packages in it" on its page (`Branches`, `arborescence.tsx`) lists the packages in it,
  each counting everything under it, headed by the whole (`PackageView.Place`, backend `PackageService.PlaceAsync`:
  path, branches, tally of packages below and still open, documents once each, ready at their package's status,
  released), with "New package in it" (`/packages?category=…&parent=<number>#new`, a delivery branch starting from its
  parent's status, recipients, people and date; a supplier's branch naming only its part, its supplier fixed). **Two ways
  to read it, the same package page** (owner): Packages' **List** shows the packages at the top (each saying how many sit
  in it), drilled into from their pages; **Tree** (`?view=tree`, `PackageTree`) shows every package under the one it sits
  in, folded open, each counting everything under it. A package holding packages is not deleted (HAS_BRANCHES).
  **One package per document** (owner: "adding a document to a branch… didn't work", then "one per tree"): within one
  tree of delivery packages, and among a supplier's packages, a document sits in one package only (`SharingAsync`): a
  rule never takes one another of them holds; added by hand, it leaves the other (which no longer takes it back), one
  already delivered staying where it went (ALREADY_DELIVERED), one sent to the supplier where it was asked
  (SENT_TO_SUPPLIER); held twice from before, it settles on the package's next reading into the lowest that holds it,
  recorded (`HandDownAsync`, PACKAGE_MEMBERS_REMOVED by the system); a package moved into a tree already holding one of
  its documents is refused (IN_BOTH); a supplier's branch deleted hands its documents back to the package it sat in.
  Two separate delivery trees may still share a document.
  Another organization reads only the packages shared with it, and in them only what was asked of it.
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
- Verdicts are one list, **Review outcomes** (`REVIEW_OUTCOMES`), kept in Types & sets like every list (owner:
  Settings is where things are changed); what were verdict lists are its sets (migration VerdictSets), each naming
  the deliverable types it serves. Any codes and names, never a code twice in the list, but each verdict says one of
  four meanings: accepted, accepted with comments (fix next time), rejected (back to the author), for information,
  chosen by the person (never filled in for them); every set in use keeps one that lets a revision be released
  (backend MEANING_REQUIRED, NO_VERDICT_ACCEPTS). The app reads the meaning (`verdictEffect`, props
  proceed/resubmit/information), never C1–C4. A review decides with the set serving its document's deliverable
  type, unless its route names a set (Review routes, "Verdicts"; `ReviewRoute.Verdicts`, by name); a route whose
  set does not serve its documents' type is warned of, on the route and on Send for review, never refused. Each
  review keeps its set (`Review.Verdicts`) and offers only its verdicts. A set a route names is not deleted
  (SET_IN_USE); renamed, the routes follow. `/settings/verdicts` only redirects. A verdict list of before holding a
  code Review outcomes already had stays as it was, read only, for the reviews decided from it.
- Phase is a document's metadata (PHASES, published like any list): asked on the new-document form (row 2,
  column 3), in Details and Edit rev, and when a revision is started (it may move the document to its next
  phase). Each revision keeps the phase it was made in. The register shows, filters and sorts by it.
- **Numbering is the organization's** (owner: one numbering across projects; switch `NUMBERING`, Fixed by default):
  schemes and which scheme numbers what are edited on the organization's Settings card (`/organization/settings/numbering`) by an administrator, for every project
  (backend `NumberingLevels`, `/api/admin/numbering`); Settings → Numbering reads them, saying so. Where the switch is
  Free, the control function changes them on the project, its first change making its own copy (`NUMBERING_OWN`,
  `NumberingScheme.ProjectId`); reset only from the organization's card (`POST /api/admin/numbering/projects/{id}/reset`,
  its schemes and routing go, numbers given stay). A scheme that gave a number (`Used`, marked when it gives one) keeps its parts and
  delimiter: renamed, re-noted or retired only (SCHEME_IN_USE); never used, it is changed entirely or deleted. To number differently (owner): a new scheme, chosen for what it should number, then the old one retired once it
  numbers nothing; its opened row says so in that order (a Tip). A scheme
  still numbering something is not retired or deleted (SCHEME_ROUTED); a retired one numbers nothing (SCHEME_RETIRED).
  A part reads a list, a fixed text, the running number (1–9 digits), or who sends / receives it; the organization's
  numbering reads only the organization's lists (LIST_NOT_ORGANIZATIONS).
- **Revision naming is the organization's** (switch `REVISIONS`, Fixed by default), as numbering: edited on the
  organization's Settings card (`/organization/settings/revisions`, `/api/admin/revisions`, administrators); Settings →
  Revisions reads it (`/api/projects/{id}/revisions`). Free: the control function changes it on the project, its first
  change making its own copy (`REVISIONS_OWN`, `RevisionScheme.ProjectId`), one default per level; reset only from the
  organization's card (revisions already named keep their values).
- How revisions are named is Settings → Revisions (`RevisionSchemeEndpoints`): schemes of lines, one line per
  phase, as many as wanted, plus one default line for any phase without its own (no phase published: that one
  line names every revision). A line counts in letters or numbers, with a prefix, a start (empty: A or 0) and
  letters skipped. The start as written also says how values look: "a" small letters, "01" two digits (the backend
  reads it; no separate fields). One scheme is the default; any deliverable type may follow another. A revision is named by
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
- The menu and page are named **Schedule**, at `/schedule` (each action keeps its own page at `/actions/<code>`; `/actions` redirects); the rules below still say
  "Schedule & actions" for the same page.
- Schedule & actions is one page for everyone, narrowed by the backend to what is
  theirs (`OutsideViewAsync` / `Narrow` in `ScheduleEndpoints`): our people see every
  action; another organization's people see the actions needing a document they may
  see (their own, and those shared with them), and in each only those documents. Our
  disciplines, confirmations, notices and notes are ours: not shown to them; a
  decision reads without who or why. `/needed` and `/actions` only redirect to `/schedule`.
- A notice about a supplier's missing document proposes that supplier's
  people (chosen, marked recommended); they are sent to the document, since
  the schedule is ours only.

- Released and issued are one act unless the organization sets POLICY_RELEASE =
  SEPARATE: a release needs someone to send to (an open request naming people
  or organizations, or the people named on the release form); the backend
  refuses otherwise (ISSUE_REQUIRED). The release sends it.
- Release is offered only for a decided revision (never in Prepare). The review's page offers it too (owner): decided and
  not released, the control function reads it under the plate with "Release rev X" (or "Send rev X back" after a
  verdict asking for changes), opening the document's release form (`#step-release`). Document
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
  before). `RevisionReading` (backend, `AwaitingCheck`). With no control function on the project, whoever the
  transmittal it came on was for checks it (anyone of ours when it named nobody; `ControlService.ArrivalAsync`,
  `TransmittalPage.MayCheck`), and it waits on their Home; the Control room draws "Checked by whoever it was for".
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

- **One transmittal for every ask** (owner, Standard §74): asks are written on the New transmittal form (an action's
  "Request a document" / "Request a discipline", "Ask for someone to join" where it is asked of someone, `?join=1`,
  asking documents back): what the ask fixes is filled in and shown, never chosen (owner: "prefill what is obvious, to
  prevent mistakes"): kind and type, "Sent to" where the ask names who answers (`RecipientPicker` `lockedTo`; copies
  free), the subject, the message's first line (a discipline: which, added or taken off). Put on at once (no
  confirmation), joining is no letter and stays in People & access. A request transmittal names its decision for the
  person asked (backend `Transmittals/Asks.cs`, `TransmittalPage.Ask`): buttons leading to where it is decided (owner:
  "the buttons navigate to where decision is made"), the choice made (`?decide=<key>&as=<choice>#decide-<key>`: the
  row ringed, Refuse's why open); anyone else reads who it waits for, or the answer with its reply. Postponements and a
  package's shortfall are still sent by their own acts (their letter is written by the app).

### Organizations working together (docs/ORGANIZATIONS.md, Standard §55)
- Another organization works on our project in one of three ways: **collaborator** (its own DELIOS,
  linked; its people use their own sign-in), **guest** (accounts we make), **not on DELIOS** (a code; one of
  ours records for them). Nobody is forced to register. A collaborator is never chosen by hand: it is a party
  linked to its organization. **Linking is automatic** (owner): never "Invite them to link" by hand on the
  organization's list. Once an organization on DELIOS is proven to be one others recorded (a claim confirmed by its
  guest's email link, vouched for by whoever recorded it, an agreed merge, or a guest making their own DELIOS with the
  account made for them), every organization that listed it is linked with it by itself and every guest account made for
  its people moves to it (`Organizations/ClaimLinking.cs`): same email, password and two-step sign-in, signing in at home
  and switching into the projects they were on, as a collaborator; the account with the host stays, standing for them,
  with everything it did. The host's administrators are told; nothing is asked of them. **Sign-up with a guest's email**
  (`GUEST_ACCOUNT`): the screen offers to take the account along, proven by that account's password; that person is the
  new organization's administrator. Either side ends a link, with why.
- A project belongs to the organization that opened it; its data stays there (`TenantScope` is the only
  way across). Each project says which organizations take part, their role, and the function a
  collaborator's people start with (`ProjectParty`).
- A collaborator's administrator puts their own people on our project: we get an account standing for
  them (`User.HomeTenantId`, no password, no sign-in name), linked to theirs (`AccountLink`). They sign in
  at home and switch in and back (`POST /api/auth/switch`; the 7 days run from the sign-in). Switched off
  at home, or the link ended: those accounts stop.
- **The organization's space** (`organization/layout.tsx`; owner, after Autodesk's account admin and GitHub's
  organization): the band, then four tabs under it (`org-tabs.tsx`): **Projects · People · Organizations · Settings**;
  no side menu, no overview of tiles. `/organization` opens on Projects (ours with Open a new project, and other
  organizations' we take part in, with our people on them). What waits for our answer shows as one amber banner above
  every tab: invitations answered there, merges and claims one click away. Settings holds every card of how the
  organization works, drawn like a project's hub (masthead with fixed / free / own copies, the Control room panel drawn as the
  navy console as on a project, the cards by group, each chip saying where its switch stands), Who we are on DELIOS
  (`/organization/settings/identity`) and What is kept (`/organization/settings/tracking`) among them. People (`/organization/people`) and
  Organizations (with those whose projects we work on, and the links refused or ended) are each one list. On
  Organizations a name opens its card under its line, in place (`?open=<id>`, `party-card.tsx`). Its dates are per
  project (owner), never summed: one line per project it worked on with us (role, contract, joined, last active, the
  project's start → planned end, where it stands). Joined is the earliest of being put on the project and its people
  first coming or acting there (backend `PartiesAsync`); no people count on the list (owner: pointless). **People**
  is everyone with an account here (owner): ours, accounts we made for other organizations, and those from their own
  DELIOS (segmented choice); each line: organization, projects with function, account since, last sign-in, and "May
  sign in", a switch acting at once (`setSignInAction`, `PUT /api/admin/users/{id}`; a linked account signs in at home).
  Its name opens its card in place: every project with function, department and since when (confirmed, else first put
  on it; backend `DirectoryEndpoints.SeenAsync`); the card shows no sign-ins or acts (owner: we are not monitoring
  people), the list keeps "Last sign-in". **The organization's level controls everything** (owner): a person's name opens
  them under their line as one panel ready to change, never a form behind a card (`savePersonEverywhereAction`): name
  and email (a linked account's are its own organization's), administrator (ours), and on every project their function,
  department and whether they stay on it, plus another project to put them on; "Can sign in" is the switch on the line
  only. A project's People & access does the same for that project only. Lines keep their order when switched (by name, never by state). No "other
  organizations' projects" on People. An organization is suspended by its "Active" switch on its line,
  the one place it is switched on the organization's list (`setPartyActiveAction`; its people's sessions stop); one
  switch, one label, everywhere ("Active", also on a project's Settings → Organizations). No eyebrow above a plate's title; the Projects plate has its two
  acts and four figures (open, suspended, archived, people). A project is **Active**, **Suspended** (`ON_HOLD`: nobody
  opens it until activated; its documents stay) or **Archived**, chosen right on its line (Where it stands, Active · Suspended · Archived), then only why is asked under the line; its
  dates read "start → planned end".
- The organization's page (`/organization`, administrators): projects ours and joined, people, organizations
  we work with, invitations (also on Home), defaults for new projects. Its projects, people and organizations
  are links (open or switch into a project; People & access; Organizations).
- **The organization's Control room** (owner: "is it on purpose it does not look like the project's?"):
  `/organization/settings/flow`, the same console as a project's, its flows, steps and panels shared
  (`settings/flow/stages.ts`, `step-panel.tsx`), drawn for any role, set to what every new project starts with
  (`PROJECT_DEFAULTS`, saved by the same `Choice`s with `target=defaults`). Each step's panel carries "Projects may change
  it": the switches of the answers it holds (`room-switches.tsx`); what only a project knows (who acts as its control
  function, its schedule's days, how its suppliers send) is said, changed on the project. The hub's panel is the navy
  console with four facts and "Open the Control room"; the console's masthead links the two pages below.
- **Defaults for new projects** and **What projects may change** are pages of their own (owner: "I did not say remove
  them… not reduced to 2 buttons no one sees"), each a card of the organization's Settings, group Organization, with its
  figure (where the defaults come from; n fixed · n free). Defaults (`/organization/defaults`, `PROJECT_DEFAULTS`):
  every answer a new project starts with on one page, in the app's one way of answering (owner: "rework… as the app's
  styling"): each a `Choice` (`setRoomAnswerAction`, `target=defaults`, the same as the organization's Control room),
  saved one at a time after "From now on… Instead of…"; an answer we changed carries "ours" with the app's own beside
  it, one projects may not change "the same on every project". The plate (Projects' way): its line linking the Control
  room and What projects may change, its two acts on its right, each opening a sheet under it that is its question
  ("Start from a project", `?open=from`; "Back to the app's own", `?open=reset`, saying nothing of ours is kept), and
  four figures (where they come from, answers of our own, who carries the acts out, projects may change n of m). The
  side panel listing the app's own answers is gone: each answer says it where we changed it. The Projects plate's
  "Defaults for new projects" opens it. The defaults hold only the answers that
  page shows (`isDefaultsAnswer`: who carries each act out with its confirmations and acts left out, how a project
  works, the days before a silent discipline is notified again): never the stamp, how other organizations' documents
  come in, who answers for an organization; "Start from a project" takes only those, asked first ("From now on…
  Instead of…"), and a new project is given only those. An act changed on its own makes the answer for every act "it
  depends on the act", the others written down as they stood (nothing moves by itself). What projects may change
  (`/organization/settings/may-change`): every switch in one list, by card, each card's link above its switches (the
  same switches sit on each card too). The defaults keep only what differs from the app's own; copied when a project
  opens, never changing one already open; a joined project follows its owner. A project marks only an answer "changed
  here" (or "the organization's" where fixed); an unmarked answer is the defaults', said once at the head of each
  sheet. It has "Back to the defaults" (what the project is, and checks ticked off, stay).
- Not on DELIOS, with "Their email for transmittals" (`Party.ContactEmail`): our transmittals to them go by
  email with their files (`EmailReplies`), each with a reply address of its own (`replies+<key>@…`,
  `ReplyAddress`, kept outside organization fencing). A reply from that address only is taken in: it waits on
  the transmittal ("Replies by email") and on Document Control's Home; Document Control records it as received
  (a transmittal following ours, its files checked as anything that arrives) or sets it aside with why. Nothing
  is filed by itself; mail from anyone else is answered with how to reply; mail to no transmittal is dropped.
  No open project mailbox.
- Roles on a project (CONTRACT_ROLES): GENERIC, EPC, EPCM, PMC, DESIGN, OWNER, CM, CONTRACTOR, SUBCONTRACTOR,
  SUPPLIER, INSPECTOR (docs/ORGANIZATIONS.md). New ones only with the owner's approval.
  Roles stay exactly as they are (owner, settled): our role does not shift the project's starting defaults, no new
  roles are added, and what a role's verdict is worth is not a setting.

### Settings
- **Settings are read by everyone of ours** (owner: "access without the editing liberty"): the Control room, Types &
  sets, Numbering, Revisions, Review routes, Forms & fields and Functions & permissions open read only for whoever may
  not change them (`SETUP_PAGES` `read: true`), each saying who changes it; editing stays with whoever the backend
  allows. People & access, Organizations, This project, the Audit trail and the organization's Settings stay closed
  (people's details, contacts, activity); the Project directory says who takes part. Another organization's people open none.
- Every setting is the project's: the hub says "How <project> works… What you change here changes this project
  only" (owner's answer). Nobody is left lost: the menu's Settings link shows exactly when a Settings page opens for
  the person (`SETUP_PAGES` + `maySetup`, layout `canSettings`); a page they may not open says plainly who changes it
  and leads back to Settings (`settings/no-access.tsx`), never a red "Administrators only" dead end.
- The hub has a Tip, "Setting up a project? Do it in this order": organizations, people, lists, numbering,
  revisions, verdicts (Review outcomes), review routes; each says done or to do, with what it found, and opens its page (a page
  the person may not open is named, "an administrator does this"). It goes once everything is set up. Each card
  carries a real figure, and what still needs doing reads "To do · …" in amber (an empty essential list, a
  deliverable type with no numbering, no revision scheme, a verdict without a meaning, only you on the project).
  Group icons take one neutral tint.
- **Where a project's site is** (owner): each project keeps its **country** (`Project.Country`, ISO two letters, or none),
  its **time zone** and its **days off each week** (`WeekendDays`), asked when it opens and on its line (organization's
  Projects, This project; `PlaceFields`, `readPlace`); a new project starts with the organization's (Defaults for new
  projects' place is on the Calendar card; `Settings/ProjectPlace.cs`, org settings `PROJECT_TIME_ZONE` /
  `PROJECT_WEEKEND` / `PROJECT_COUNTRY`, `GET`/`PUT /api/admin/project-place`, PROJECT_PLACE_SET), never changing one already
  open (on the organization's Calendar card, "Where a new project's site is"). Nothing set: UTC, Saturday and Sunday, no country.
- **The calendar** (owner: "how about we create a calendar"; holidays are a calendar, never a list of Types & sets):
  days nobody counts are kept on it (`Settings/Calendar.cs`, table `days_off`): the organization's **public holidays**
  (each with its name and the country it is kept in, or every country) and a project's **own days off** (a site
  shutdown, a local holiday; where the switch `CALENDAR`, area "Calendar", Free by default, leaves it free, ROOM_FIXED
  otherwise). **One month at a time** (owner: "dont add a calendar for each month, apply the regular calendar", the date
  picker's way): ‹ month › stepping through the span, "This month" back to today's, the organization's arrows going on into the
  year before or after (`components/calendar.tsx`, `MonthsCalendar`): days off each week shaded,
  holidays rose, a project's own amber, the schedule's action days highlighted (a bar under the day), today ringed; each
  day is a square (96 pixels by default, 40–200) (owner: "double the height", then "we forgot the width"), each month exactly its seven
  days wide, the whole calendar made larger or smaller by "Size − +" beside "Names in the days" (owner: "i cant find the resize"; "Normal" puts it back) or dragged by its corner, a marked handle at the month's own corner (cookie `calendar-day`; double-click
  puts it back); "Names in the days", a tick (cookie `calendar-names`, on by default), writes each day off's and each
  action's name inside its days, as many lines as the day holds; a
  click on a day opens it under the months (what it holds, each action linking its page) and, for whoever keeps that
  calendar, claims it (its name; the organization's also its country) or unclaims it, asked first (DAY_OFF_MARKED /
  DAY_OFF_UNMARKED). **The organization's Calendar card** (`/organization/settings/calendar`, administrators): its
  holidays a year at a time (`?year=`, `&month=`); **a country's public holidays filled in** (owner: "some recognise national
  holidays"; the `date-holidays` package, `lib/settings/national-holidays.ts`, in English): the country chosen on the
  calendar (kept in the address, `?country=`, ALL for every country; none: where a new project's site starts), its
  year's public holidays are drawn dashed on the calendar until marked (a click on one opens it with its name filled in)
  and listed under it with "Mark these N", asked first (`POST /api/admin/calendar/days/many`, each logged
  DAY_OFF_MARKED, those already marked left); a project's calendar draws its country's the same way (`knownBetween`),
  counted only once marked; the organization's calendar
  draws no actions (they are a project's); how dates read, where a new project's site starts, and its switch. **A project's
  Calendar card** (Settings → Calendar, read by everyone of ours, changed by the control function): where the site is
  (`PUT /calendar/place`), its country's holidays and its own days off. **The calendar is a tab of the Schedule** (owner:
  "make it a tab as the plan and the table"; `/schedule?view=calendar`, tabs The calendar · The plan · The table, the plan
  in the middle and shown first; `/calendar` only redirects there, no menu item): read only, drawing the actions the
  Schedule's filters leave (another organization's people see only theirs, as on the Schedule), the months centred,
  its key ending with "… in Settings → Calendar" for whoever opens that card. A project's calendar spans **from the month it starts
  to the month it finishes** (owner; This project's dates, `PROJECT_INFO`; no end: twelve months on), widened to the
  months of its first and last actions (owner: "show more months"); an action's name written in a day opens the action. Every count of working days (review steps, an answer's due day, warnings, a discipline notified
  again) skips the days off each week and these (`WorkingCalendar.HolidaysAsync` → `Calendar.DaysOffAsync`).
- **The app speaks English only**: every word is written in place; another language means moving each sentence into a
  file of words per language, screens and backend alike (owner asked, not decided).
- **A new email counts once its owner opens the link sent to it** (owner): an administrator changing someone's email
  (organization's People, a project's People & access) sends a link to the new address and a word to the old one; the
  account keeps its email until the link is opened (`EmailConfirmation.SendChange`, the same `/confirm-email` page,
  EMAIL_CHANGED; refused if the email changed since or the new one is taken). Email off: the link is handed to whoever
  asked. Nobody changes their own email.
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
  doing the work carry its acts out themselves (as when the Control room says so). **Stand-ins** (owner, one rule,
  backend `Identity/StandIns.cs`, `/api/me` `noControl`, `standsInForControl`): what arrived (its check, registering
  what came unplanned, keeping files with it) is whoever the transmittal was for (anyone of ours when it named nobody);
  what we exchange with other organizations (a supplier's package, asking for its documents, handing them back and
  forth, replies by email) is anyone of ours who may send or register; a delivery package is those putting it
  together. Ending a document is already its registrar's too; legal hold an administrator's.
- People & access, in the reference style: masthead (on the project · waiting · refused, and how joining works here),
  "Someone joins <project>" ("Add someone", "Ask for someone to join"), "Waiting to be confirmed" (with Remind), and
  Everyone (organization and project as search fields that apply at once, `JumpPick`, owner: chips grow with every
  organization; a field to find a name or email; "Other projects" only when someone shown
  is on another; acts as icons: activity, change, ask for them to join; each person's Change: function, department, name and email unless
  linked, "Can sign in" on every project, "Take off <project>", asked first). A linked account (works here from its
  own DELIOS) changes only its function and department here. The organization's own extra fields on a person (Forms
  & fields) are no longer asked when adding (they were checked on the screen only).
- **Lists on two levels, list by list** (owner, Types & sets): the organization's lists are the default every project
  reads, changed on the organization's Settings card (`/organization/settings/types`, `/api/admin/lists`, the same board
  `settings/config/board.tsx` with `level`). A project's first change of a list copies **that list only**, and only where
  the organization leaves it Free (`LIST:<key>`; `ProjectLists.EnsureOwnAsync(db, project, list)`, `Project.OwnListKeys`,
  `ValueEntry.ProjectId`); a Fixed list is read only on a project (backend LIST_FIXED), and Project types and Contract
  roles describe the projects themselves, the organization's only (ORGANIZATIONS_LIST). Each list says on the project
  where it stands: its own copy, the organization's and free (copied on its first change), or the organization's. The
  organization's card lists the projects keeping their own copy of a list; one list goes back to the organization's
  there only, for a mess, with why, logged (SETTING_RESET), its control function told. A copy never becomes the default
  for new projects. Projects that had copied everything keep each list as their own (migration ListsPerProject). Which lists a request
  reads is set once per request (`DeliosDbContext.UseListsOf`, query filter on `ValueEntry`): the project of the
  page (header `X-Delios-Project` from the `edms_project` cookie), else the person's first project.
  `/api/projects/{id}/lists` (`ProjectLists.cs`, `lib/settings/forms-lists.ts`). Only whoever acts as the control
  function on that project changes them; on a project with none, only whoever opened it (`Project.OpenedById`);
  nobody else (backend CONTROL_ONLY). Everyone of ours reads them. Every change is in the log.
- A value or a list **never used** on the project (no document, revision, review, transmittal, package, action,
  route, rule, numbering or other value carries it: backend `UsageAsync`) may be changed entirely or deleted. Once
  used: renamed or retired only (backend VALUE_IN_USE); anything else is a new value or a new list. A list the app
  runs on is never deleted. Project codes (filled by itself) read only. The "Used" column says where each value is used, or "never used".
- **List → sets → values** (owner, Types & sets; `ListRules`, `ValueSet`, `ValueEntry.SetId`): a list holds sets, each
  naming the deliverable types it serves; the **default** set serves every type no other active set names, unless it is
  given types of its own, then those only (it is theirs like any other, owner: renamed, given types, switched off, deleted
  when never used; switched off, the types no other set names find nothing in that list), so a document always finds exactly one set (a list
  with one set uses it). Two active sets of a list never serve the same type (SETS_OVERLAP). A code is unique across all
  sets of its list. Deliverable types, Project codes, Project types and Contract roles hold one set (ONE_SET_ONLY).
  A value, a set and a list of one's own are switched off and on (a value then reads OFF: not offered, kept on what
  carries it); the app's lists are not switched here, their field is left out in Forms & fields (APP_LIST_STAYS). Never
  used: a value or a set is deleted (SET_IN_USE otherwise); a list only if it is one's own (the app's stay).
- Counts only where they help (owner: too many overwhelm): Types & sets counts its lists on each tab, the values in use on
  each list of its menu and, under a list of several sets, on each set (one set alone repeats nothing), and the retired
  values; none on its plate or "In use / All". Project codes are not on Types &
  sets: filled by the app, one per project, shown on This project.
- Types & sets shows the sets: nothing is chosen on arrival (Numbering & identity's lists, and "Choose a list on the
  left"); choosing a list opens its sets. In the menu a list counts its values in use, a set too when the list has several ("· off" when
  switched off); "New set" (name, the deliverable types it serves). The set shown has its bar, on every list: name, whom it
  serves, its +, its switch, its pencil (name, types), delete while never used (a list of one set: + and its name only).
  Every list has its default set as a real set (`ListsAsync` makes one missing). Values are the set's; a value is added to the set
  shown (`?vs=<set>`), its + on the set's bar (the list's head only for a list of one set). The list's name and where
  it stands share one line. Which values: the segmented choice (`.seg` / `.segment`, In use · Retired · All, with counts).
  "Used" names what uses a value ("recommended by document types: Calculation"), only real references (`Pointers`).
  The bottom bar for ticked values: Retire, Bring back, and for those never used, Move to another set and Delete.
- **Every dropdown is the app's** (owner: "all drawers, lists of choices adopt this styling", the numbering's): `Select`
  (`components/select.tsx`) replaces every `<select>`: the chosen one ticked and bold, the one under the keys shaded,
  groups under their names, a field to narrow a list longer than 12. **Every list that opens from a field is drawn over
  the page** (owner: "drawers are blocked by their card… some show to the side and create an horizontal scroll";
  `components/floating.tsx`, `Floating`, on the page's body): under its field, or above it when the window has no room,
  held inside the window's width, followed as the page scrolls; a click outside it or Escape closes it. `Select`,
  `JumpPick`, `Choice`, the recipient picker, "One of ours?", the date filter and the Filters menu use it (`SearchPick`
  and the register's column menu were already so). Never an `absolute` list under a field again. The native select stays hidden in the form holding
  the value (name, `form`, `required`, `defaultValue`, `value`, `onChange` work as before; a pointer pick applies a
  filter at once, a keyboard one on leaving). Never a bare `<select>` again. The search fields' lists (`SearchPick`,
  `JumpPick`, the recipient picker, "One of ours?") take the same look, and every one lists on a click and narrows as
  one types (Functions' long lists and "One of ours?" included).
- **Never pills inside a register** (owner: "we are very satisfied with the current styling"): a register's state
  reads as coloured text, as it was (transmittals' status, `STATUS_INK`). **One colour per state in a register** (owner:
  "In preparation" and "Accepted" were both amber): the revision states and a supplier's stages, read in the same
  column, each have their own hue, text, side colour and pill alike (`lib/core/state-look.ts` `STATE_LOOK`; a state
  meaning the same in both, in review or released, reads the same). A state in the register opens its own line on Help
  (`/guide#state-<code>`), lit (`.state-line:target`), with what it means and how it gets there: document states,
  revision states (no revision yet included) and a supplier's stages. The states stay where they are (owner, settled): fixed by the app, explained on
  Help, named on the organization's States card; they are not a list of Types & sets.
  Outside registers every state is its pill in the app's tones (`Chip`, `TONE`; `ToneChip` draws a `Chip`, and keeps
  its round shape only inside a register's lines, `inRegister`: packages, package and delivery lines, report lines);
  no chip carries colours of its own (the old -100 / -300 fills were brought onto the tones).
- **On/off is a switch** (owner, everywhere): `components/switch.tsx` (`role="switch"`): `Switch` acts at once,
  `SwitchControl` / `SwitchField` are a form's field (can sign in, in use, pop-ups, stamps, confirmation needed, only
  moves forward, shown in the register…). Never a "Switch off" button or an on/off chip beside a button; a choice among
  several, or a confirmation, stays a tick. Acts whose icon says them are icons (owner: "obvious icons instead of long
  buttons everywhere"): add, change (pencil), download, export, print, columns, notify (bell), take off (×), delete,
  retire, order, open the PDF, the source file; their words on hover and for screen readers (`title`, `aria-label` or
  `sr-only`). Colour only where it tells them apart (owner: "clarity purposes only"): Excel's green, the PDF's red, a
  red ×. Save, Cancel, Close, a page's first act and any act an icon would not say plainly keep their words.
- **Forms & fields on two levels, form by form** (owner; backend `Settings/FormRules.cs`): the organization's forms are
  the default every project reads, changed on the organization's Settings card (`/organization/settings/fields`,
  `/api/admin/forms`, the same board `settings/fields/board.tsx` with `level`), opening a project and adding an
  organization there only (ORGANIZATIONS_FORM on a project). Where the organization leaves forms Free (switch `FORMS`,
  one for all forms), a project's first change of a form copies **that form only** (`FORMS_OWN` names the forms it
  keeps; an old "1" was every form); Fixed, a project reads them only (FORMS_FIXED). Each form says on the project where
  it stands, in the three sentences of the lists. The organization's card lists the projects keeping their own form and
  puts one form back, for a mess, with why (SETTING_RESET). A field answered on any project reading the organization's
  form keeps what it asks. The control function changes a project's forms (on a project with none, whoever opened
  it), everyone of ours reads them (`GET /api/projects/{id}/forms`; the organization's, `GET /api/forms/{form}`). The backend refuses what a form insists on, for every way it arrives (a form,
  an import, a draft sent): documents (registered and changed), revisions started by hand, transmittals sent, packages,
  tags, opening a project and adding an organization (FIELDS_REQUIRED, `fields` outlined). On the review form, "Copied in"
  is must · asked · not asked like any field (not asked: nobody is copied in). **A field of one's own** is one row,
  added and changed with the same form (owner): what it is called, the kind of answer, the list it is chosen from (open
  only when the kind is "chosen from a list", then required: never two fields), must it be filled, the note under the box, a column of the
  register. Never answered: changed entirely, or taken off (bin). Answered at least once (`FormRules.UsedAsync`): only
  retired (no longer asked, its answers stay on their records; brought back), its kind and list fixed (backend
  FIELD_IN_USE). Chosen from a list, it offers the values of the set serving the document's deliverable type (backend
  VALUE_NOT_FOR_TYPE), kept with the record (`Extras`), shown and changed in Details / Edit rev, a register filter
  (`own.<key>`) and, if chosen, a column. A list is never added to a form by itself. A number part reading a list of
  one's own (`LIST:<key>`) takes the answer to the document form's field chosen from that list.
- **Forms follow the sets**: a document is offered, for each list, only the values of the set serving its deliverable
  type (new document, once the type is chosen; Details and Edit rev by the document's own type), read from the backend
  (`GET /api/values/serving`, `lib/settings/serving.ts` `forType`); the backend refuses any other (VALUE_NOT_FOR_TYPE,
  `Catalog.IsOfferedFor`), and its defaults (confidentiality, retention) come from that set too. Values already carried
  are still read by their names.
- **Filters follow the sets** (owner), on every page with filters (register, Schedule, Transmittals, Reviews, Assets &
  tags, Distribution): a filter on a list offers every value of every set, under each set's name and whom it serves
  (`lib/settings/in-sets.ts` `setGrouping`, drawn by `components/filter-options.tsx`). Which filters show is each
  person's choice, the "Filters" menu (`components/filter-menu.tsx`, cookie `edms_filters_<page>` read by
  `lib/core/filter-choice.ts`); a filter holding a value always shows. "More filters / Less filters" is gone.
- A refused form keeps everything written (`ActionForm` gives it back after React empties it), to put right and send again.
- Types & sets: the menu card is as tall as the window under the top bar (`set-nav.tsx`): the title scrolls
  away, then only its table and its list of lists scroll.
- Groups (`ListRules.Groups`): Numbering & identity, Classification & keeping, Review & issue, File formats, Schedule
  (no "Other": activity decisions in Schedule, control outcomes in Review & issue, generic title words in Numbering &
  identity). A list of one's own is a document field and goes only in the first two (LIST_NOT_HERE); in Numbering &
  identity it may also go into the numbering: a number part reads it from the document's answer (`LIST:<key>`,
  `FieldSources.ListPrefix`); the Numbering builder offers the app's numbering lists and these, nothing it cannot build. Project codes are used by every document of their project.
- **Organizations, two levels** (owner): Settings → Organizations is the **project's**: one field to find an organization,
  always there (our list first, then any DELIOS knows; choosing it adds it to the project), and beside it one button
  "Create an organization" that opens the form (guests, or not on DELIOS). No two-button steps, no project code repeated on
  every line. **In our list is on the project** (owner, "1+1=2"): the search shows one in our list as "in our list" (never
  added twice) and any other with "+ Add". Below, "Organizations on <project>": every organization in our list but us
  (backend `ProjectPartiesAsync`, what the project says of each kept in `ProjectParty`). Adding one (found or created) on
  a project asks its **role with us** (required) and contract number with it; nothing is added on a click alone. Its
  **name opens a drawer** (from the right) with what it is (identifier, how it works with us, domain, its people here) and its
  **role with us** (client, supplier…), then: role here, contract number (once), who of
  theirs answers for it here and backup (`PARTY:<id>`), their function (from Who may do what). The list of every
  organization and its details is the **organization's** (`/organization/organizations`, administrators): the same
  button and two ways, plus "Works on": optionally the project(s) the organization added or created is put on. An
  organization with its **own DELIOS** is never changed by us: its line there is read only (name, code, identifier,
  domain), we see it and link with it; only "In use" is ours.
- People of another organization keep **their own function**, always shown with their company ("ACME / Lead Engineer",
  `User.HomeFunction`), never confused with ours, for display only. What they may do on our project is **their function**,
  one we define in Who may do what (e.g. "SMYU-guest": read, upload into its placeholders, transmit, RFI) and assign in
  the organization's drawer ("Their function"; a guest's one account gets it in People & access). Never "start as". A **guest
  organization has one account** (backend ONE_GUEST_ACCOUNT): the person who stands for it and acts as its document
  control; when it gets its own DELIOS, it claims. One not on DELIOS has nobody signing in.
- **Claiming an entry** we or others recorded (owner): never on the claimer's word. The guest who stood for it confirms by
  a link sent to their email (`/confirm-claim`); with no guest (not on DELIOS at all), the organization that recorded it
  vouches, or refuses with why. Until then nothing passes: no documents, no account, no access (`OrganizationClaim`).
  Confirmed, the link and the guest accounts follow by themselves (above).
- An organization is always told (notification and email, as always): put on a project (`TellJoinedAsync`: one with its
  own DELIOS through its administrators there; one whose people have accounts with us through them; one not on DELIOS at
  its email for transmittals), and when it is first recorded (one not on DELIOS at that email; one on DELIOS by its
  invitation to link; a guest's people by the link to choose their password).
- **Organization's list** (owner's "idea1"), People & access's way: plate (with their own DELIOS · with accounts from us ·
  worked for by one of ours · working on <project>); "Organizations we work with" one sheet (`OrganizationJoins`):
  **Add an organization** (one DELIOS already knows, any list's, found by name or code, `GET /api/admin/organizations/on-delios`,
  taken as it is; one with its own DELIOS is invited to link at once, their administrator accepts then puts their
  people on; any other asks how it works with us) or **Create an organization** (code, name, **country + identifier**, the best it has:
  company registration, else tax number, else professional register such as an order of architects, else a public
  body's; or why it has none; its email domain; how it works with us). Before creating, look-alikes are named (backend
  LOOKS_LIKE: same identifier, same domain, or a name reading the same once legal forms and punctuation are left out):
  "Is this the same as…?" → "Yes, add that one" or "No, it's a different company" (kept in the record). Every
  organization: a pencil opens its line (name, code, identifier, how it works with us: once each; domain; who answers
  here; linking; "Listed twice? Merge it with its other line" asks a merge, shown only when another line could be it). "Working on <project>": which of them work on
  the project (role here, the number of their contract with us, the function their people get), "Add one to <project>",
  each line opened by its pencil. The identifier's number is named by its kind (Registration number, Tax number, Number
  on the register, Government identifier). Names of buttons are plain acts, never "on DELIOS".
- How they work with us, in plain words (`PARTY_KINDS`): "Works from its own DELIOS" (collaborator, never chosen by
  hand), "We give its people accounts" (guest), "One of ours works for it" (not on DELIOS). For the last, "Their email
  for transmittals" is required, and "Who of ours works for it" is a **person** (`Party.CarriedByUserId`; nobody chosen:
  the control function, its people named), never a function.
- Demo data is dummy data: never flag it, chase it or build errands around it (no "no identifier yet" warnings).
- Asking for someone whose email belongs to an organization on DELIOS brings **their whole organization** onto the
  project (`BringOrganizationAsync`): added as DELIOS knows it, invited to link through that address, taking part with
  the function asked as its people's start; their administrator accepts, then puts them on. The control function does it.
- The identifier (country + kind + number) is unique across DELIOS (`reserved_values` ORG_IDENT, IDENTIFIER_TAKEN) and
  changed once. **Our own organization** on its page ("Who we are on DELIOS"): its identifier; its email domain, proven
  by a link sent to an address of ours there (`/confirm-domain`, never a public mail provider, one organization per
  domain); proven, it **claims** the entries others made for it at that domain (they become it, under its code and name).
  **Merges** of duplicates: asked with why (by an organization holding either), agreed by every side that answers for
  them (an organization on DELIOS for itself, else whoever first listed it), refused with why; then the app's owner
  carries them out (`merge-organizations [<id>]`, backend command). Nothing is deleted: the merged one's code and name stay
  reserved and point to the one kept.
- Organizations: the list is the organization's, shared by every project; who takes part in a project (role, the
  function a collaborator's people start with) and who answers for each there (`PARTY:<id>`, a project setting, so
  Document Control keeps it) are the project's. Who answers is optional and never blocks a save. Its code, name and
  how it works with us change once each (above). An organization is never removed: "In use" unticked switches it off (no longer offered; its people no longer
  sign in; everything done under it stays). The "Remove this organization" button (which always failed) is gone.
- **A failed read is never read as "nothing"** (owner, after the critique): on the organization's pages, where every
  switch stands, the projects keeping their own copy and the defaults are read with `libertyOrFail`,
  `orgSettingsOrFail` / `projectDefaults({ orFail: true })` and the copies readers, which throw; the page then says it
  could not be read (`organization/error.tsx`), never "0 fixed", "None" or "the app's own". "Their own copy" counts each
  project once, functions included ("3 projects, on 5 cards").
- Layered settings: built as the two levels above (the switches). Being moved onto them card by card: the switches
  and the organization's Settings first, then Numbering (done), Revisions (done), Review routes (done), Types & sets (done, per list), Forms & fields (done, per form), Functions & permissions (done, owner: "we should be able to change functions on a
  project level": the functions themselves, name, code, clearance, in use, are the organization's, created and changed on
  its Settings card `/organization/settings/functions` by an administrator; what each may do is the organization's unless
  its switch `FUNCTIONS` (owner: Free by default) leaves it Free, then the project's control function changes it on the
  project's page, its first change copying every function's rights onto the project (`Project.OwnFunctions`,
  `PermissionRule.ProjectId`; `Identity/ProjectFunctions.cs`, `PUT /api/projects/{id}/functions/{fid}/rules`); Configure
  stays the organization's (CONFIGURE_ORGANIZATIONS). Rights are read per project: the query filter on rules follows the
  project in hand (`DeliosDbContext.RulesProject`, set with its lists), and every check across projects reads each
  project's own copy explicitly. The organization's card lists the projects with their own and resets one, its copy kept),
  the Control room (done: an answer whose switch is Fixed is read only on a project, "the organization's", backend
  ROOM_FIXED via `Liberty.RoomItemOf` / `RoomRefusalAsync`, accepted only when it equals the organization's default;
  the risk window likewise; a project keeps the answers it already held). Until a page is moved, it says plainly what is the organization's and what is the project's.
- **Document families organise, they regulate nothing** (owner): they group the document types, whatever their codes
  (ours like DWG, a supplier's like C102), and help with recommendations. A family is a value of the set `DOC_FAMILIES`,
  kept in Types & sets like any other, coded as the organization likes; a type names its family on the type (else a code
  whose first letter is a family's code falls in it). Read on Help (`/guide#families`, each family with its types);
  no Settings card (`/settings/families` only redirects). No outside stamp rule: the stamp is the review's (above).
- **Every Control room switch is read by the backend** (owner: "make them work", not removed). Sending a review to its
  reviewers (`REVIEW_ISSUE`): with the control function, a review sent for review waits, no step open
  (`ReviewService.AwaitsIssue`), until they send it on (`POST /reviews/{id}/issue`, REVIEW_ISSUED); they are told, it is
  on their Home ("Send for review", "Send to reviewers"), whoever sent it is told when it goes. Sending a document out
  (`ISSUE`): with the control function, a transmittal carrying our revisions is theirs to send (backend CONTROL_SENDS);
  others ask for it to be sent from the document. Starting a revision nobody asked for (`AUTHORIZE_REVISION`): after a
  revision released as it stands (no comments to take in, not for update, not with its supplier), a new one needs "what
  changes, and why" (REASON_REQUIRED) and, with the control function, is theirs to start (CONTROL_STARTS). When an action
  has what it needs (`POLICY_READY`): ISSUED (the app's) counts a document released and issued (where release and issue
  are apart, once a transmittal carried it out); STATUS counts the newest revision a review decided, with the status it
  carries (`Readiness.ThereAsync`); readiness is read again on a send, a decision, and when either policy changes. These
  three acts are left to the people doing the work unless the project says otherwise (`ProjectAnswers.WorkByDefault`,
  `workByDefault`): projects go on as before until they choose.
- The Control room's flow draws released and issued as one step, "Released & issued", unless the project keeps them
  apart (POLICY_RELEASE = SEPARATE: Release, then Issue), and has three flows: documents we produce, we receive, and a
  supplier owes us (asked, received, the control function's check, review, kept or back with them). The three are by who
  produces the document (owner: keep them, nothing finer): ours, another organization's (the deliverable type needs
  an originator), a supplier's asked from its package (a placeholder). The flow is a **console** (owner: "an actual control room, the steps are
  portals to the regulators, not a diagram"; no gradient; no black, grey or white): one solid brand-navy panel, the
  flows as tabs on one line (owner: never more; a short name each, `tab`, in the role's words, the full title on
  hover and at the head of the line under them), one line "title · from → to", each step a station in brand blue with its state's colour as a status light
  across its top, (owner: no readouts on the stations). The lines stay (owner): an arrow on to the next station,
  a dashed drop to a road that ends (below its station, rose, "ends here"). **Nothing is "optional"** (owner: "a huge
  hit to our integrity"; optional would mean it may always be skipped): a step always happens, or happens under a
  condition, of two kinds (`When` in `scene-deck.tsx`). **Set here**: the project's configuration decides (thin solid
  line, a switch mark; drawn "on" or "off" as it stands where it is known for the whole project, dimmed when off, else
  "When …" with what it depends on): Review where some document types are not reviewed, Confirmed / Refused (joining),
  the client's two ways (on DELIOS or not). **If it happens**: an event brings it on, then it is never skipped (dotted
  amber line, a bolt): Voided, Approved outside / Not approved (when the decider asks), Going without, At risk,
  Withdrawn, Cancelled, Legal hold, Archived. A way the project did not choose (placeholders or as they come) is not
  drawn at all. No panel of lights above the flows (owner: "serves absolutely nothing", removed). The flows' tabs are
  one recessed strip, the open one raised in light; the key is five short words (its state, set here, if it happens,
  ends here, shown below); a "Set up in" tile has no underline, its border fades in on hover. Never an "Escalated" step (owner): telling
  a silent discipline again is a notice, its days a setting on "Disciplines confirm"; the action stays open and overdue,
  with no explanation of its own; what another organization sends is checked before it is registered (Documents we receive); the lit station is ringed in light blue. The key stays under the console (owner: "critical"):
  its state, set here, if it happens, ends here, shown below. Under it, "The days
  around an action" (needed before its day, at risk from) sets the project's lead and risk window once its schedule is
  named (`PUT /schedule/days`, the risk window following the organization where fixed; every action read again).
  **The days around an action on two levels** (owner: "need both org and proj levels"; `Actions/ScheduleDays.cs`): the
  organization's ("needed before the action's day", "at risk from"; org settings `SCHEDULE_LEAD_DAYS` / `SCHEDULE_RISK_DAYS`,
  `GET`/`PUT /api/admin/schedule-days`, on its Control room and on Defaults for new projects) are every project's
  default, read live (as the stamp's); a project keeps only what it changed (the same keys on the project), where its
  switch leaves it free (`LEAD_DAYS`, new, and `RISK_WINDOW`, Free by default; an exception counting), set before its
  schedule is named too, "changed here · the organization's: N" beside each, and "Follow the organization's days
  again" (also done by "Back to the defaults"). Nothing set anywhere: the app's 7. Every reader goes through
  `ScheduleDays.ForProjectAsync` (the 14 two screens fell back to is gone); numbers other than 7 kept on a schedule before
  read as the project's own until it next sets its days.
- **The Control room stands above every Settings page** (owner): not one card among them, but the panel at the top
  of the hub (`CONTROL_ROOM`), drawn as the console itself (owner: navy, `scene-deck`, to stand out): what it is, the
  four facts that say how the project works (control function, who does what, releasing, adding people), and "Open the
  Control room" as a full button at the control height. No flows on it (tried, the owner: removed). Everyone of ours reads it (`read: true`, "See
  how it works"); an administrator or the control function changes it (`mayChangeControlRoom`; read only otherwise:
  switches shown, nothing chosen). Every page below is what it is built from.
  **The flows follow our role on the project** (owner; This project, "our role", CONTRACT_ROLES, named on the masthead
  with "change"; after researching the roles, owner: "PMC do not approve, that's in the very name"): each role orders
  the flows, words them, and says whose word is final (`ROLE_WORK` in `flow/page.tsx`, any other role `GENERIC_WORK`).
  Final with us: OWNER, EPC, EPCM (approves on the owner's behalf, the owner having the last word on what it reserves),
  DESIGN (approves what contractors and suppliers send against its design; its own design is approved by the client),
  SUPPLIER (its customer approves what it sends). Recommends: PMC (reviews and recommends, the owner decides), INSPECTOR
  (comments; certifies its own scope only, the client decides). Passes on: CM and CONTRACTOR (check first, then the
  designer or the client's engineer decides), SUBCONTRACTOR (the main contractor decides). Where ours is not final, the
  flow draws who decides after our review ("<decider> decides"); where someone approves what we send, "<approver>
  approves it" is a step, not optional. "Documents our client asks of us" is drawn for roles with a client (DESIGN,
  CONTRACTOR, SUBCONTRACTOR, SUPPLIER), in the client's own words. The rest follow (packages, an action, someone joins, keeping & ending). "<Client> asks"
  draws both ways it is asked (owner): their placeholder, filled on their own DELIOS (switched into their project;
  their check before it counts), or asked outside it and recorded here (registered, released and issued to them on a
  transmittal following theirs).
  **Working in someone else's project** (owner): it is one project, with its creator's data and numbering, which is
  what is exchanged; we fill its placeholders there (never "attach files" that would sit apart from its numbering and
  revisions). Each organization's register holds what it accepted (the check is what lets anything in); nothing is
  copied into ours by itself. **Equivalence** (owner, built): what arrives unplanned is matched by hand to one of ours
  ("One of ours?" on the transmittal, chosen from the register, never typed: owner, numbering is never manual; if it
  exists its content goes into it, a new submission of the revision being
  prepared, else its next revision; not while in review), or made a document under our numbering; either way their
  number is kept beside ours one to one (`Documents/Equivalents.cs`, `number_equivalents`; Details "Also known as",
  recorded by itself when matched or registered, never typed; taken back with why by the control function), the
  register finds it under both, and the same number of theirs proposes the same document next time. "None of ours? Make
  it a document" opens the new-document form filled with what is known (`/documents/new?item=<transmittal>:<item>`: who
  it comes from, the deliverable type requiring an originator, its type, title, the package's order); saved, it registers
  that item (`POST /transmittals/{t}/items/{i}/register`), its files the first revision. **Nothing is asked of what is
  sent** (owner): a file attached from outside has no number, and the system cannot tell a controlled document from a
  loose attachment, so no number, revision or other metadata is asked when it is recorded or sent; whoever checks
  refuses a transmittal lacking what it needs, by hand. **Taken as they come** is a project's **exception**, never the
  default and never drawn as its equal (owner): by placeholder is the way; the Control room offers "Make this project an
  exception" (`Packages/Intake.cs`, `SUPPLIER_INTAKE` = AS_RECEIVED, `AS_RECEIVED_FILING`, `PUT /intake`, an administrator
  or the control function, with what they are filed under and the warning ticked; one way or the other, MODE_IN_USE once
  either is in use). Nothing puts a project on it by itself (migration IntakeExceptionOnly took back what a package had
  said). As they come: no placeholders are asked, nothing is matched or registered by hand (INTAKE_AS_RECEIVED); the
  other organization sends each with its own number and revision where it gives them (one that came without cannot be
  accepted as it came: CAME_WITHOUT_NUMBER, returned with why); the check
  accepts all (they are in the register exactly so, `Document.AsReceived`, series `AS_RECEIVED`, their next revision
  superseding one we never took further, never one of ours: AS_RECEIVED) or returns all with why. A red warning
  (`components/as-received-warning.tsx`) says it on the package, the transmittal, the document, the register ("as
  received" stamp) and the Control room: numbering, revisions, states and outcomes, search and reports, archiving.
  **Covers everything** (owner: "does it finally cover EVERYTHING?"): every list the app reads is a tile on the step
  that reads it (control outcomes on the check, activity decisions on an action, generic title words on registering,
  preservation formats on keeping); "Keeping & ending" draws kept (retention, confidentiality, what is kept about
  people's activity read only, the checks switched off), legal hold, withdrawn / cancelled (ending under Kept),
  archived with the project; assets & tags and every form are linked. Left out on purpose: the organization's own
  (sign-in & security, the audit trail, the switches, defaults for new projects), each person's (pop-ups), families (read on Help).
  **The Control room simplifies the work, never adds clicks** (owner, after looking at how flow designers
  work: a step chosen on the flow opens its properties beside it). Its flows: documents we produce, we receive, a
  supplier owes us, our client asks of us (roles with a client), packages we deliver, an action on the schedule,
  someone joins the project, keeping & ending. The chosen step's
  panel says what happens (one plain sentence), **Who does it** (fixed acts in words; the project's acts as one
  `Choice` each), **How it works here** (its questions, confirmations, days, the stamps it puts on the PDF, each a `Choice`;
  the steps that stamp read the stamp in one line, changed on its card; Review carries
  which set of Review outcomes each route decides with, one `Choice` per route, `setRouteVerdictsAction`;
  what its state is called and who acts as the control function, with where they are changed), and **Set up in**
  (tiles: each list with how many values in use, or "not set up yet" in amber, the pages it reads and the form it asks; a tile only
  its keepers open is shown unlinked, never hidden). One method for every answer (`flow/choice.tsx`): its answers
  side by side, what the one in force means under it, another chosen asks "From now on… Instead of…" before saving
  (`setRoomAnswerAction`, `setScheduleDaysAction`); a number of days is its field on the same line with Save beside it
  (owner: "no need for a full form for working days"), Save lit only once it differs; read only for whoever may not change it, locked where the
  organization keeps it. The masthead names who acts as the control function. **No second page of answers** (owner:
  "How this project works" is gone, `/settings/control` only redirects to the Control room): every answer is changed in
  the Control room and read as written sentences in the plan (the masthead's "Read it all as the plan"). Under the
  console sit what holds for the whole project (`flow/project-wide.tsx`): "Who acts as the control function"
  (`#control-people`, named there) and "Back to the defaults". What the states are called is the organization's card
  (`/organization/settings/states`, administrators), read on a project: every state Help shows, by group (`STATE_GROUPS`):
  the document's (planned, active, withdrawn, cancelled, archived), its latest revision's ("No revision yet" included)
  and a supplier's stages (`docStateName`, `stateName`, `supplierStageName` read them everywhere); two of one group never
  read the same, the app's own words aside.
- **A person's activity** (owner): in People & access, a name opens `/settings/users/<id>`, and so do the clock icon on
  each line and "See what <name> did" in the opened line (owner: "I didn't know this page existed"): who they are, then everything
  they did in the app with its day and time (signed in, opened a document, downloaded, reviewed, released, sent…), read
  from the audit trail (`GET /api/admin/users/{id}/activity`, narrowed by act and project, 50 a page). Opening a
  document is recorded (`DOCUMENT_VIEWED`, once per person and document every half hour). An administrator or the
  control function only, in Settings only, never on the directory; reading it is itself recorded (`ACTIVITY_READ`).
  Lawful as the register's integrity record, provided people are told it is kept (privacy notice), it is read only for
  that purpose, and the organization sets how long it is kept; some countries also ask staff representatives first.
  What is kept is the organization's choice (organization page, "What is kept about people's activity",
  `Settings.Tracking`; shown read-only in the Control room): acts on documents always; opening a document
  (`TRACK_READING`) kept unless switched off; **a file downloaded always** (owner, security review: the files are
  protected; `Tracking.Reading` holds only DOCUMENT_VIEWED), and watched: one person past 200 files in an hour, our
  administrators are told once that hour, by notification and email, with a link to their activity (`Audit/DownloadWatch.cs`,
  DOWNLOADS_MANY, read with each download on its index actor · action · at); read as two kinds, Opened and Downloaded
  (owner: opened is not downloaded; `AuditKinds` READING / DOWNLOADED); sign-ins always kept for security, shown on a
  person's activity only when switched on (`TRACK_SIGN_INS` = ON).
  **Reading is kept outside the locked chain** (owner: every reader waited behind every other act of the organization):
  opened, downloaded and a person's activity read (`AuditKinds` READING / DOWNLOADED, `AuditLog.OutsideChain`) are written
  by `audit_note`, with no lock and no link to the row before, each sealed by its own hash (`audit_events.chained` false);
  every act that changes something stays in the chain (`audit_append`, one writer at a time). Same table, append-only,
  the same readers; `audit_verify` checks the chain and each reading row's own seal.
- **Audit trail** (Settings, administrators) keeps its logbook look (owner: the agreement was on content, not styling):
  the day as a rule, each act a slip, the kinds beside it. Shared with a person's activity (`components/logbook.tsx`).
  Beside the log: the whole log, then each kind of act with its count and every act it holds (plain words, counts), so
  nothing done in the app hides behind a heading; Find (words, project, dates). Every narrowing is answered by the
  backend (`GET /api/admin/audit` `kind`, `action`, `projectId`; the activity endpoint the same), paged by 50 ("Earlier
  acts"). Kinds are worked out once in the backend (`AuditKinds`, every code the app writes named there), each slip in
  its kind's side colour (`AUDIT_RAIL`, the "Audit trail" area of the key); plain words for every act in
  `lib/settings/activity-words.ts`. Who opens their activity; every title opens its page (a revision or a file its
  document, `documentId` from the backend; an action, a package, a review, a list in Settings…: `activityLink`). Only
  the side takes the kind's colour; the title stays ink. A detail kept as data reads as the fields that changed, "was →
  now" (`readableDetail`), never as raw data (owner: "never display json"), wherever a detail shows (logbooks, a
  document's History): "<what>: […] → […]" too, a list of records as added / taken out / changed, each by its name,
  one line per field under it (owner: "don't condense, no fancy transformations": a code reads as itself, only not
  in capitals). An id is never shown: the backend puts each id in a detail as the name it stands for
  (`AuditKinds.NamesInAsync` / `Readable`, on every audit reader), and new details are written with names. Home's Log tab is the same logbook for its project (backend `GET /log`),
  read by everyone of ours on the project (owner): the control function and administrators every act, anyone else only
  the acts on what they may open (a document, its revisions, files and reviews by its clearance, a transmittal they may
  open; a document named inside a detail they may not open reads "a document you may not open"; `ActivityEndpoints.Readable`,
  the journal beside Home the same), the names opening a person's activity only for those who read it; another
  organization's people never. The project's work only: sign-ins, opened and downloaded, and people and
  settings are left out (the administrators' trail). Its menu is on the left (`LogbookSide categoriesOnly`: the kinds,
  not every act; then Find), the days beside it, the page's right column away while the log is open.
  The log's menu: Find first, on a white box (words; the day and Show on one line; no labels), then the kinds, which
  scroll on their own without a bar; on the Audit trail and a person's page each kind folds open on its acts.
- A form never sits in a box inside a box: a sheet that opens a form becomes that form (`SomeoneJoins`), and a line
  of a table opened for editing goes on as the row itself (grey fields, then the strip with Cancel and the act), the
  new-document form's way.
- Screens and the backend say "the control function" and "whoever holds Manage" (or "whoever plans"), never a job
  title; a function's own name is shown only as read from the data.
- No ready-made codes offered by a button (owner): the "starter profiles" ("Add them") are removed. Lists are filled by
  the organization itself, typed on Types & sets or imported.
- A project's **Type** is chosen from the organization's list **Project types** (`PROJECT_KINDS`, Disciplines, types &
  sets, Numbering & identity), kept like any list; it describes the project only. The backend refuses a type not in it
  (KIND_UNKNOWN); a retired type stays readable on the project that carries it (`lib/settings/project-kinds.ts`).
  Controlled changes no longer exist.
- **The plan is a document, not a setting** (owner): Assurance → The plan (`/conformance/plan`), the project's document
  management plan, read by everyone of ours and printed. It says how each thing is done, why, by whom, where and when,
  in 16 chapters (who takes part, who does what, a document's life, registering, numbering, revisions, review, release,
  transmittals, other organizations, the schedule, who sees what, keeping and ending, what is recorded, how it is
  checked): each with why, the steps (who, what, when, its state's side colour), the facts it runs on, and "the app
  makes sure of it" (`prevented.ts` by area); "Set in" links on screen only. Every sentence is read from how the
  project is set up (`GET /management-plan`, `PlanEndpoints`, for what only the keepers read elsewhere); what is not set up is said
  where it belongs. Nothing on it is typed and nothing repeats a Settings page. Scope is said once (This project); the
  target once (Assurance, "How it is measured", `MEASURE`; the checks run when someone runs them, so no interval). The
  organization's name is its own. No exceptions register (it changed nothing): a check switched off, with why, is the
  departure that applies. `/settings/dmp` only redirects.
  **A plan, never a manual** (owner): it is the app's plan for this project, made of its switches, settings, the inputs
  its forms ask and its flows; nothing the app does not do (no hardcopies, no matrix typed by hand). Each line states a
  choice of this project or a rule that always holds, with who and when; a line naming a button, tab or click is
  manual and belongs in Help. It includes what each form asks where the organization decided otherwise (Forms &
  fields: made required, left out, added), the acts left out, each reason's expected answer, delivery packages, and
  how fine the matrix is cut. A setting the app does not apply is never stated.
  **Plan v1** (owner: "I like it; if the next one doesn't work we fall back to it") is commit `ef95589`
  (`frontend/app/(app)/conformance/plan/`, `backend/app/Checks/PlanEndpoints.cs`): restore those files from it.
- **Assurance tabs share one top** (owner: tabs must not jump): `conformance/head.tsx` (`AssuranceHead`): the same plate
  "Assurance", its figure, its acts (Print where the tab prints, Run the checks), the tabs on the same line, then one
  line saying what the tab is; a click changes only what is under them.
- **Review routes on two levels** (switch `ROUTES`, Free by default): the organization's routes are edited on its
  Settings card (`/organization/settings/routes`, `/api/admin/routes` writes, administrators) and offered on every project;
  a project changes them where free (`/api/projects/{id}/routes`, the control function), its first change making its own
  copy (`ROUTES_OWN`, `ReviewRoute.ProjectId`); Send for review offers the project's routes. Reset only from the
  organization's card (reviews already sent keep their steps).
- A route names, like its verdicts, the **set of Review advice** its advising steps answer from (owner; `ReviewRoute.Advice`,
  by name; none: the set serving the document's deliverable type), kept on each review (`Review.Advice`, `AdviceCodes`):
  advisers are offered only its advice (backend refuses another, VALUE_NOT_PUBLISHED); renamed, routes follow; a set a
  route names is not deleted (SET_IN_USE). Review routes page (owner, "the overall styling"): the plate with "New review
  route" (`?new=1`), one sheet per route (advice, verdicts, what it takes in words, never a bare code; each step with who
  really answers it, an organization by its name, its working days and what the decision may release at), the pencil
  opening the route as its own form (`?edit=<id>`, Cancel / Save on one strip), each step's working days typed in its own
  box.
- **Several steps may decide** (owner; `RouteStep.Decides`, the last always does): each deciding step answers in turn
  even after a rejection, and the most severe verdict of them all stands (rejected over accepted with comments over
  accepted, read from the meaning; `Severity`), the later of equals; the status released at, and who receives it, are
  the last step's. A decider before the last carries "issued for" like an adviser.
- **Who answers a step** (owner): three choices side by side, any of them, at least one (backend STEP_ANSWERER_REQUIRED):
  the organization (none: ours), the function, the people (a search field, never pills), each narrowing the others, and
  the route's discipline narrowing the people; or "Recommended for each document" (`RouteStep.FromMatrix`): the
  distribution matrix's people for each document's discipline, narrowed by the choices, proposed on Send for review and
  confirmed by the sender. "The matrix" is Who may do what: whoever may review the document (approve it, on a step that
  decides) by their function's rules for its facts, its discipline first; never a person's department alone (which
  recommended nobody). On Send for review every step names at least one person (owner; backend STEP_PEOPLE_REQUIRED,
  the form says which step), but an organization answering as itself; a step is no longer filled behind the sender. Another organization's people may be
  named (they answer here); one that answers as itself (recorded by one of ours) names nobody (STEP_PARTY_AS_ITSELF).
- A route's working days are only filled in by default (owner, never limited or enforced): five in all, each decider
  given more than each adviser (2 + 3); days typed by hand are kept.
- What a route takes is enforced: no other document is sent on it (backend NO_ROUTE); Send for review offers only the
  routes that take every document chosen (owner: the lines saying why one is not offered were removed).
- A form whose submit sits outside it (`ActionForm` with `id`, `hideSubmit`, a button `form=…`) has an id used nowhere
  else on the page, and no hidden field named "id" (it hides the form's own id): either leaves the button without its
  form and the save silently does nothing (the route form, `route-form-<id>`, `routeId`; an organization, `partyId`).
- The route form (owner: "everything blended in one big chunk", then "follow our app's styling") reads in the sheet's
  own bands, never brand fills or rings: The route · Which documents take it · Its steps, then the step opened under its
  band "Step N · <title>" (what is chosen there is that step's only); "Routes in use" heads the routes below; a route
  being changed is marked "being changed". "The status it releases at" is a dropdown (`SearchPick`), never pills.
- A revision whose files are not through the virus check is refused in plain words by what happened (`FilesNotReady`):
  still being checked (about a minute; if it stays, the worker or scanner is not running), refused (its Preview says
  why: replace it), or no file yet.
- **What the virus check cannot look into is refused** (owner: "refuse them with explanation"): a file locked by a password
  (a zip, a PDF that needs one to open) or holding more than the scanner opens (clamd `AlertEncrypted`, `AlertExceedsMax`,
  compose and Kubernetes), never passed as clean; said in plain words on the file and in the document's Preview
  ("<name> was refused: It is locked by a password… Send it without the password", `FileScanning.CouldNotCheck`,
  `refused` in `lib/documents/checking.ts`). A PDF that opens without a password, however it limits printing, is checked.
- One status chosen on the last step: every document the route accepts is released at it, shown fixed on the verdict
  form ("the route releases at IFC, not IFA"), nothing to choose or confirm; several: the decider chooses. "It stays at
  <status>" is asked only when what the revision carries is one the step may give (owner: a verdict was blocked by a
  tick about IFA when only IFC was offered).
- On the route form each step says what it does, "Advises · Decides" (a choice on the step opened), the last always
  "Decides" (a route always ends with a decision). "Which documents take it" reads "Deliverable type", never "Produced by".
- Why a step another organization answers goes to them is never asked on a route (owner): set by itself from what the
  step does, "For approval" when it decides, "For review" when it advises (`ReviewSets.StepReason`, the codes APPROVAL /
  REVIEW), refused only when neither is published (STEP_REASON_REQUIRED).
- **Every search field lists on a click and narrows as one types** (owner, everywhere): `SearchPick` (its `browse` no
  longer differs) and the transmittal recipient picker; "Choose, or type to narrow". `SearchPick`'s list is drawn over the page
  (a portal on the page's body, placed under its field, or above it when the window has no room), so no card or
  scrolling row cuts it (owner: "drawer is blocked by card", the steps of Send for review).
- A route's step is answered by all its people (any order) or by whoever gets to it first (`StepModes` ALL / ANY): no
  other kind is offered. A step another organization answers goes to them on a transmittal whose reason is set by itself
  (above). "Offer this route first" puts it first among
  routes equally specific. "From which organization" chooses among the organizations taking part (a document's
  originator is an organization's code).
- **Functions & permissions, one place per function** (owner, after the critique): the grid's ticks give a permission
  on every document (half mark: held for certain documents only); a function's name opens it under its line
  (`?open=<id>`): every rule it holds, every document first, each narrowed one with its fields named, a bin to remove
  (asked first), "Add a rule"; in the organization's Settings also the function itself (name, code read only, clearance,
  in use). "New function" is the plate's act (`?new=1`), opening the added one. "What each permission allows" is always
  written under the grid (`VERB_BLURB`). No department on a function (never kept by the backend; the field is gone).
  The opened function shows only what the grid cannot (owner, "redundancy"; then "useless… i'd rather see the form
  directly"): its rules for certain documents only, if any, and the form to add one, open at once; in the
  organization's Settings also the function itself. The form never repeats the grid's ticks, nor lists them (owner:
  pills tried, then "remove the pills, no need"): it asks only which documents, and "Only on these documents" moves
  everything its ticks give from every document to the documents chosen (`narrow`, asked first, naming them). A
  permission is given in the grid only. Nothing else: no "none yet", no line on what is the organization's. A name opens only when there is something
  there (whoever may not change it, on a function with no such rule, reads a plain name).
  **On a project every function is changed, Configure excepted** (owner: "project level should be able to edit that by
  default, except the admin function"): Configure, the administrators' permission, is neither given nor taken on a
  project; the backend leaves it out of what comes and keeps it where the function held it (`ProjectFunctions.RulesAsync`).
  The switch starts Free (migration FunctionsFreeByDefault took away a Fixed kept from before).
- Removing a review route is "Stop using it", asked first; a permission tick asks first, naming everyone it changes.
- **Two levels of settings** (owner): the organization's (`/organization`, its portal) and the project's (Settings).
  Every project, opening one, archiving and reopening are the organization's: **Projects** (`/organization/projects`,
  administrators), People & access's way: plate (open · archived, one short line, its acts on its right: "Defaults for new projects" on
  its own, never inside a sentence, and "New project"); "New project" opens one sheet under it (`?new=1`: band, grey
  fields, "Where approval sits under each role", whose people it starts with, Cancel / Open project; it starts from the
  organization's defaults); the table, code and name opening a project one is on, a pencil opening its line
  (`?edit=<id>`: name, code, type, our role, start, end, scope, description; Cancel / Save). The description (optional,
  a few lines, `PROJECT_INFO`) is asked when a project opens too, and shown under its name. Archive and Reopen sit in the opened line
  and always ask why (backend REASON_REQUIRED, kept on the project: `StatusReason`, by whom, when, shown on its line).
  Settings → **This project** (`/settings/projects`) is the project one is in only: what it is, and the same line to
  change; no "Open a new project" there.
- **Unique across DELIOS, never reused** (owner): a project's code and name, an organization's code and name, a
  contract number belong to one thing in every organization's data together (`Organizations.Registry`,
  `reserved_values`, no row-level security, filled from what exists after migrating). A value once used stays with what
  used it, even after a change, so the records carrying it keep meaning it. An organization has **one code and one
  name everywhere** (`OrganizationIdentity`): given ACME, it is ACME in every list that holds it; another organization
  adds it under the same code and name, and a code or name of another is refused. Changed **once** each, for a mistake
  (backend CHANGED_ONCE; numbers already given keep the old code), carried to every list holding it; an organization on
  DELIOS alone changes its own (THEIR_OWN). A project's code changes once in its life (CODE_CHANGED_ONCE); its name as
  often as needed, each name kept its own. "How they work with us" changes once. The **contract** is between two
  organizations: the one signing it (the project's) is known by the project's code, the other by its contract number
  (`ProjectParty.ContractNumber`, Organizations, "On <project>"), unique on DELIOS, changed once.
- **Security & privacy** (administrators; owner: what is kept about activity "does not deserve an entire card": it is the
  same card, its sheet under the sign-in's, `/organization/settings/tracking` only redirects there) is the organization's, on its Settings (`/organization/settings/security`; owner,
  after the critique; `/settings/security` only redirects there, and a project's Settings carry no such card):
  two-step sign-in asked of everyone or not; the organization's own account (owner: "explain the work with a progress
  diagram", then "look like what we have in the app") drawn as the app's own stage path (`StagePath`, as under a
  document's title): Register DELIOS · Type its details · Switch it on · People sign in, a short line under each (`SsoSteps`), said plainly as only for an organization whose people have a
  work account elsewhere; its form only once set up or asked for ("Set it up", `?sso=1`), never filled by the browser
  (autoComplete off), the address the provider sends people back to given in it, for step 1; the organization's own account
  (single sign-on, OpenID Connect: name on the button, provider's address, client id and secret kept encrypted, email
  domains, in use: with none, only an email the provider says it verified is trusted, its account names only at the
  domains set; an account standing for another organization's person is never entered by it); "Everyone may sign in with a password", which may be limited to administrators only once that
  account is in use (backend SSO_NOT_CONFIGURED otherwise; turning the account off opens passwords again): until then the
  switch is not offered, the line says why; a new account's "In use" starts off. The sign-in
  page folds "Sign in with your organization's account": its short name (shown to the administrator), then the
  provider. Nobody is created by signing in. A refused sign-on comes back to the sign-in page in plain words
  (`sso_error`); a successful one's session (the backend's cookie) is taken over by the screens (`proxy.ts`).
- Settings pages use the reference boxes (`rounded-md`, `ring-line`, `bg-tint-soft`), the shared control size, and no
  text under 11px.

### Import & export
- A file is always checked first; the check writes nothing and uses the backend's own rules. Problems name the sheet and
  row the person sees. Writing names its count; rows with problems are left out only after it is said and agreed.
- **The deliverable list on two pages** (owner; backend `Documents/DeliverableImport.cs`, `POST /imports/deliverables/check`
  and `/write`, one call each, never one per line; screens `lib/documents/forms-deliverables.ts`,
  `app/(app)/import/deliverable-import.tsx`): the file is read into lines and checked, then every line says what it
  would do (New document · Update, each field "was → now" · No change · Problem, with why; every line of the file is
  listed, owner) before anything is written. One way to take a line off (owner: "I don't understand the switch, the leave
  out, the keep"): its red × ("Take this line off the list"), back from "Taken off the list" with Put back; "Take every
  line with a problem off". **Correcting a line is the document form itself** (owner: "the edit must be the very
  create/update document form"): its pencil opens the form under the line (`LineForm`; fields read once for the template
  and the form, `lib/documents/deliverable-fields.ts`: the same fields, order and names as registering, each list
  offering only the values for its deliverable type, a field the backend names outlined; on an update what the number is
  made of shown locked). The table is the register's (`DataTable`, its head ticking all, owner); lines ticked bring up the register's dock
  at the bottom (owner: "use the bottom bar like we have in register"): Change them together (the same form, empty:
  only what is filled in changes; lines of one deliverable type, opened just above the dock), Take them off the list,
  Tick the problems, and clear. Every change is checked again at once (no "check again" button); then
  one act writes the whole list, or nothing (a line that no longer passes undoes the rest, said line by line). A new document has **no number** (numbering is never
  manual): it is given one when registered; a line with a number updates that document of this project, never creates
  one (a number not in the register, or on two lines, is a problem). What the number is built from never changes, and a
  document's details change only while a revision is prepared (DETAILS_NEED_A_REVISION, as by hand). **The file is the
  project's**: the template carries the project's code on its hidden sheet `DELIOS` (with which field each column holds),
  and a file made for another project is refused whole before a line is read (ANOTHER_PROJECT); a CSV may name its
  project in a Project column, one project only. The template follows the app (`lib/documents/deliverable-workbook.ts`):
  a sheet per deliverable type with the document form's fields (Forms & fields: left out, insisted on shaded, the
  organization's own words, its own fields after), each list offering only the values of the set serving that type;
  the empty template has no number column, "the register as it stands" has it first. Anyone of ours who may register
  documents brings one in (owner: our people add and update documents as they wish); the backend checks each line as
  registering or changing it by hand would. The columns AssetCode, ContractRef and ReceivedDate were dropped: the tag was
  never kept, ContractRef said the same as PO, and the received date is never asked on registering.
- **Settings lists are the project's** on its Import & export (owner): a workbook of the lists as this project reads
  them, written through the project's lists (`PUT /projects/{id}/lists/{set}/values`): each list is the organization's
  until the project changes it, by hand or by import, its first change making the project's own copy of that list; a
  list the organization keeps the same on every project is left as it is, said once per sheet. The control function
  brings it in (CONTROL_ONLY), as it changes the lists by hand.
- **Every import on two pages** (owner: "not just deliverables, all of imports"): the team list, the distribution matrix
  and the Settings lists go the deliverable list's way (`app/(app)/import/lines-import.tsx`, `lib/documents/forms-lines.ts`):
  every line listed (New · Update with "was → now" · No change · Problem with why), its pencil correcting it in place, its
  × taking it off the list, the register's tick-all and dock (change them together, take them off, tick the problems),
  checked again at once; one act writes the whole list or nothing. The backend writes it whole: each line through the
  very endpoint used by hand, in one transaction (`Platform/Batch.cs`; `POST /admin/projects/{id}/members/many`,
  `/admin/functions/rules/many`, `/projects/{id}/lists/values/many`), the check being the same run undone (`dry`). The old
  way (write the rows that pass, leave the others out, download the rows with problems) is gone: a line with a problem
  is corrected or taken off. A person on the team list who has an account already is put on the project, or their
  function and department changed. **A department is always chosen from the project's disciplines, never typed**
  (owner): the team list's line offers them as a dropdown, a value that is none (by code or name) is a problem, and the
  backend refuses it everywhere a membership is set (`MemberAsync`, DEPARTMENT_UNKNOWN; what someone already held stays
  until changed). Each kind shows its register document (chosen in the register as the schedule's
  lists) and "Bring in <number> rev X" reads its released revision's file into the same second page; what was brought in
  last, and from where, is kept (`POST /lists/sources/{kind}/brought`), and a revision released since is on Home ("list
  released", LIST_TO_BRING_IN) for whoever brings it in.
- A person added is never given a password chosen by someone else: Team list (and `POST /api/admin/users` with `invite`)
  emails a link to choose their own (7 days, once); with email off, the link is handed back to whoever added them.
  **An administrator may set someone's password** (owner: "as apps like this do"), on the organization's People, in the
  person's opened panel ("Set a password", typed twice; `setPasswordAction`, `PUT /api/admin/users/{id}` `password`):
  administrators only (ADMIN_ONLY), never one's own (OWN_PASSWORD: "Forgot password"), never a linked account; the person
  is told at once by email and on Notifications, signed out everywhere, logged (PASSWORD_SET).
- Import & export follows the Schedule look; exports are grouped (the register, Assurance, the record).
- Each import kind offers two downloads: the list as it stands now (the register, the team, the matrix, every Settings
  list) and an empty template. A register taken out and brought back corrects only what changed; what the number is
  built from may be carried as it is, never changed; a row that matches is counted, not listed.
- Nothing is uploaded in Settings: Settings regulates. Lists come in on Import & export or the Schedule (Settings →
  Controlled changes, an upload with approval, is removed). **One exception** (owner): the organization's own lists come
  in on the organization's Types & sets card (`/organization/settings/types`, "Bring the lists in from a workbook",
  administrators; `LinesImport kind="org-sets"`, `POST /api/admin/lists/values/many`, the workbook `template-sets?level=organization`):
  the same two pages, written whole or not at all, every project reading a list getting the change, a project's own copy
  never touched.
- Import & export (owner): the import (what is brought in, the file) and "Take a copy out" side by side; once a list is
  checked, its lines take the page's whole width in a card of their own under them (`#import-results`, filled by
  `InSlot`, `components/slot.tsx`); the setup Tip's steps
  stand side by side as a path (`Tip row`); every import's lines in tabs by outcome (All · New · Update · No change ·
  Problem), as the Schedule's check.
- Every spreadsheet read (Schedule lists, Import & export) first passes `SheetGuard` (backend):
  it is what its name says (a workbook is a zip, a CSV is text), a workbook unpacks within 200 MB and 5000 parts and
  carries no macros, the virus check finds nothing (scanner down: refused, said so), a sheet spans at most 100,000
  rows and 500 columns. Screens call `POST /projects/{id}/sheets/check` (`lib/documents/sheet-check.ts`).
- Every CSV we write keeps a cell starting with = + - @ as text (leading apostrophe; a lone "-" or a number stays):
  `csvSafe` (frontend), `ReportEndpoints.Csv` (backend).
- A tip is `Tip` (`components/ui.tsx`): dashed frame on the page's surface (light and dark), yellow bulb, "Tip", bold
  lead; an order that works is numbered `steps`, each a link to where it is done, the current one marked. Never a rule
  or a warning. On Import & export it sits under the title, its steps side by side (`row`): the setup order, each step
  opening its import.

### Reports
- No overview tab: a page repeating the tabs' figures was removed (the owner: no use to anyone). Every tab adds
  something of its own.
- **A report is counted by hand, for everyone, as the checks are** (owner: "the refresh in assurance and reports is 100%
  manual"; "mostly the control function… once a week per project"): counted the first time it is asked a way (its
  window, how its chart is cut, its day), then kept in the database for everyone (`ReportCount`, `report_counts`, one per
  report, way asked and audience: ours, or one other organization's own count), unchanged whatever happens on the
  project, until anyone who reads it presses **Count again** (`POST /reports/{id}/count`, `CountAgainButton`), which counts
  it for everybody. The plate says when and by whom ("counted 3 days ago by …; it stays so until counted again"). The
  Excel download carries the same count. Words searched and a bar chosen narrow the kept count, never count again. The
  screens keep it under `reports` only (no other change clears it). Each of our readers sees only the lines on what they
  may open (`ReportEndpoints.ReadableAsync`: a document above their clearance, a transmittal they may not open, left
  out; the control function and administrators read every line); the figures and the chart stay the project's counts.
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

### Help & orientation
- `/guide` (owner), in the reference style: a plate with jumps; **the colours**: eight areas four by two, all open
  (owner: opening one by one is clicks for nothing; no strip of colours: distracting); **the codes**: one line each, Do the
  work's way, in the register's own column words (Document state, Revision state, Review verdict, Review advice,
  Released for, Criticality, Confidentiality, Refused titles): the two states open **the states** below (each state's
  pill, what it means, how it gets there, the organization's names), every list opens its values in Types & sets
  (`?set=<list>`) for whoever reads Settings. `/guide/codes` is gone (owner: it repeated Types & sets; it only redirects
  to `/guide#states`), and the register's codes link the same way; an address's part
  lands under the sticky top bar (`:where([id])` scroll margin, globals.css); **roles on a project** (every role an
  organization can play on any project, `?role=`), ours marked "us", one another
  organization plays here marked by a dot (its key shown only then), each with what it does, where approval sits, what
  it sends, what comes to it, what its verdict is worth (`lib/settings/role-word.ts` `ROLE_WORD`, read by the Control
  room's flows too) and who plays it here, as plain tabs on one line (owner: "simplistic tabs, inline", the document
  page's); no "Reading a number" (owner: not needed, Numbering is read by everyone); then Do the work (the Project directory among them: who takes part, who to ask), See the
  whole flow for the control function, and **How it is set up**: the Settings pages the person opens, read only for
  whoever may not change them. Help repeats nothing a Settings page shows (owner: "we need no more redundancies"): what
  values a form offers, the routes, what you may do are read on their pages. No banner, no
  figures, no grid of cards; never a link to a page that does not exist. A project's role does not start a matrix of
  its own (the matrix written per role in `profiles/roles.ts` is applied nowhere): Help never says it does.

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
- A document's recorded points (History, "as it stood") keep only what changed since the point before (owner: never the
  whole document again on every change; `DocumentSnapshot.IsChange`, `SnapshotChanges`: fields changed, records of a list
  by their id), a whole point every 20; read back whole, as before (`GET /documents/{id}/snapshots` rebuilds them).
  Points kept whole before stay as they are.

### Schedule & actions
- The schedule (SCH), disciplines per action (DPA) and requirements (RQL) are
  register documents, revised and released on the document page.
- The schedule is read from a Primavera P6 export (.xer) too (owner: "extract data from it directly in addition to the
  excel upload"; backend `Actions/XerReader.cs`): its TASK table, the planner's ID its `task_code`, start and finish as P6
  shows them (actual, else early, else remaining, else planned), WBS summaries left out; no column is chosen (P6 names
  its fields the same in every export); an export of several projects (a baseline among them) is read for the one chosen
  on the upload ("Which P6 project is the schedule", offered once the .xer is picked, with each one's activities,
  `app/(app)/actions/schedule-file.tsx`; ours by its code chosen first), the choice kept for the schedule's next
  revisions (`ScheduleColumns.Sheet`), else the one whose P6 ID is our project's code, else refused naming them. The file is sent whole (server actions take 100 MB,
  the upload endpoint 140 MB in base64). On upload
  (`.xer` beside `.xlsx` and `.csv`, `SheetGuard` reading it as text) and on release (a revision's `.xer` first, as only it
  carries the WBS and what happened, then `.xlsx`, then `.csv`). The disciplines and requirements lists stay Excel or CSV.
  **The latest read stands** (owner: "the later is always the higher hand"): a list is read from its register document's
  file (the native file of its released revision) or from a file uploaded on the Schedule, whichever came last. **The file
  it was read from is downloadable as it is** (owner): an upload is kept exactly as it came (`ControlledVersion.ObjectKey`,
  `lists/<project>/<version>/<name>`), a release read names its revision's file (`FileId`, `ScheduleImport.FileId`); a
  download icon beside what is in force under each stage (`GET /schedule/lists/{kind}/source`, `…/source/file`, our people,
  logged DOWNLOAD; screens `app/api/schedule/lists/[kind]/route.ts`).
- **What the planner's file says is kept as the planner's word** (owner): each action keeps where it sits in the WBS
  (`Activity.Wbs`, top down, and `WbsOrder`, P6's order; from an .xer) and whether its start and finish happened
  (`StartAchieved` / `FinishAchieved`: P6's "A", "Achieved", from an .xer's actual dates or an Excel date written
  "… A"). Achieved is the planner's word on the work, never ours on its documents ("achieved does not necessarily mean
  our done"): it changes no state, readiness or "Went ahead?", and reads "A" beside the date (plan, table, action page,
  "as the planner says"). Where the schedule has a WBS, the plan and the table follow the planner's order (sort `wbs`),
  each WBS level a band across the plan (owner: the P6 preview's look, "cleaner"; its code, name and how many actions it
  holds, folded open or shut), indented, the bars as they are. Each plan row: our number, the planner's ID beside it,
  muted, the title under; the names take 16rem and the bars the rest (owner: "give enough space for the bars"). A
  schedule read before its WBS was kept is read again by itself (owner: "users shouldn't have to do that"; no button):
  each read keeps the version of the reading that made it (`ScheduleImport.ReadWith`, `ScheduleImporter.ReaderVersion`,
  raised whenever the reading keeps more), and the released revision's .xer read by an older one is read again only
  when needed (owner: "no full historical reprocessing merely because code was deployed"): the first time someone opens
  that project's schedule (`AskCatchUpAsync` on `/plan` and `/plan/page`, message `schedule.catchup`, `CatchUpAsync` in
  the worker), unless a list was uploaded since or it is no P6 export (then marked read, never asked again). Schedules
  nobody opens are never read again. The plan says when no action has a WBS (an
  Excel schedule carries none), and offers "Group by WBS" when sorted another way. The plan opens on two months around today, held inside the schedule's own span
  (owner, "that applies as general": near or past its end, the window ends on the last action's day; near or before its
  start, it starts on the first's), and "Show every date" draws the actions' own days only, never stretched to today; says "the schedule
  runs <first month> → <last month>", and draws today only when inside; a read says its months too. The calendar tab
  opens the same way. The Schedule's heading says the days around an action in force (a document needed N days before
  its action's day, at risk from M), linking the Control room where they are set.
- Their Excel is uploaded on Schedule & actions only by Document Control or a
  function with the Plan permission.
- Released revision: "this file is rev X as released" is ticked by default;
  only when unticked is a reason obligatory. No released revision: a reason is
  obligatory. Always logged. Same on all three uploads.
- **Each list's register document is chosen, never designated by the app** (owner): the control function ticks it in
  the register, opened for it (`/documents?pick=src:<list>`, one tick, "Use it for the …"; backend `Actions/ListSources.cs`,
  `list_sources`, `PUT /lists/sources/{kind}`, LIST_SOURCE_SET; one document holds one list, DOCUMENT_HOLDS_ANOTHER_LIST).
  The same for the schedule's three lists and Import & export's four (deliverable list, team, matrix, Settings lists).
  Until one is chosen, the app's old rule finds it (the schedule document named, else type SCH; DPA and RQL by their
  type), said "found by its type, not chosen yet". **The latest stands**: a list comes from its register document's
  released revision or from a file uploaded, whichever came last; whoever uploads vouches it matches the released
  revision, or says why. **The control function or whoever holds Manage reads it again from the other source**
  ("Read it again from the other source", always with why; `ListUploadRequest.From` DOCUMENT / UPLOAD, LIST_SOURCE_SWITCHED;
  Manage sees the Schedule's list panels for this only, never to upload).
- **Every schedule upload is checked before it is applied** (owner: every import shows what it would do first):
  `POST /schedule/lists/check` reads the list exactly as applying it would, in a transaction always undone, and lists
  every line (an action new, changed field by field "was → now", removed, or no change; for the requirements, each
  discipline's need), with why the file cannot be read, in tabs by outcome (All · New · Changed · Removed · No change);
  then "Apply it" sends the same file (`CheckedListForm`). **The schedule's lines are not corrected or taken off here**
  (owner, kept: the planner's file is the planner's word, corrected in P6 or the file and sent again; actions are never
  added or changed one by one in DELIOS). **The disciplines per action and the requirements are ours** (owner: "you
  didn't do them like the others"): every row of the file is listed with what it does and what is wrong (backend
  `ListSheetView`, rows mapped to the comparison, problems by the line the reading names; rows waiting while others have
  problems read "Waits"), its pencil correcting it in place, its × taking it off, tick-all and the dock; checked again at
  once; applied, the list as corrected is sent as a CSV (a row taken off left blank so every row keeps its line; the
  requirements' inherited action and department written out on every row), kept as the file read, and why it differs
  from the file is asked (no longer "as released"). Read again from the other source, it is applied as it is.
- **Each list's source is a card of its own** (owner: "more visible"; `components/list-source-card.tsx`, the same on the
  Schedule and Import & export): its register document with its side colour (released emerald, nothing released amber,
  none chosen grey), "found by its type, not chosen yet", what it was read from last, and "Choose it in the register".
  The download of what a list was read from finds the released revision's file for reads kept before the file was named
  (`LatestAsync`, by "<number> rev <value>"); with no file it says so in plain words, never as data.
- Releasing a list document reads its Excel automatically (the schedule, when it
  is the project's schedule; DPA and RQL by their type, or the document chosen for them). The three uploads stay,
  for no document, not released, no Excel attached, or a failed read. They are
  the stages Schedule, Disciplines and Requirements themselves, clickable (with
  an upload icon) only for whoever may upload; "open" is an underline, the fill
  stays "where it stands". Everyone else sees the plain row.
- Actions get our own number (A00001…) and keep the planner's ID beside it.
- The plan's foot counts what is drawn in garnet, of what there is ("50 of 159 actions in these days").
- Actions with no date are always counted on the plan ("N with no date — in the
  table"), never silently left out of the window.
- No "Responsible" on actions: the people concerned are those of the disciplines
  the action is tagged with, found through the distribution matrix (adjust the
  disciplines in the Excel before upload). Description shows only on the
  action's own page, not in the table.
- "Went ahead?" (after the day): With documents / Missing documents / Postponed, or "Went ahead" (nothing
  listed: no document is listed for it, so nothing says what it had; never "With documents"); "not yet" before the day. Going ahead needs the concerned disciplines to
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
- **Automatic notices go at the project's notify hour, only on the days something was written down for it** (owner:
  "09:00, and add it to settings as a choice"; "the changes are the ones who tell us"; `ActionNotices`, setting
  `NOTIFY_AT`, 0–23 on the project's own clock, 09:00 by default; the Control room's "At risk" step, the organization's
  Control room and Defaults for new projects, its switch `NOTIFY_AT` as every answer). Nothing sweeps the schedule and
  nothing asks whether a day has something (owner: "most of it are states"): what changes an action (its documents,
  confirmations, decisions), a review step, or how a project counts its days (settings, days off, the project) sends,
  with its save, the notice days it moved (`NoticesMoved`, queue `delios.notices`); the worker writes them on the rows
  (`Actions/NoticeDays.cs`: `Activity.NoticeOn`, the risk window opening, the day after the day, the day of notifying
  again; `ReviewStep.WarnOn`) and each project's next moment (`notice_alarms`, no row-level security, its day at the
  notify hour), and sleeps until the earliest of all (`NoticeAlarmBell` rings it when an earlier one is written). On
  that moment it reads only what falls that day, then writes those days again. A day with nothing written runs
  nothing. A failure tries again in an hour. Once each: at risk → each
  discipline still short and not confirmed; still silent some working days after the day (the Control room, Disciplines
  confirm, `ESCALATE_AFTER_DAYS`, 3 by default) → its people, Manage holders and the control function notified again;
  a review step due today or the next working day (`ReviewWarnings.WarnProjectAsync`). Confirmed disciplines and
  postponed actions are not notified. No notice for "all ready" or "day passed" (states, shown on the action and
  Home). The automatic confirmation on the day is written in the first day's notices after it. A schedule read by an
  older reading is read again when someone opens it, never on a clock.
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
  still ahead, reads so on the action ("nothing is asked of you"); no notice is sent (owner: a state).
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
- The plan is drawn as a planner's chart (owner): each month a column, every other one lightly shaded, a plain line
  between them and between actions; each action's lead-in (from the day documents are needed: the earliest listed document's due day, else the project's
  lead before its day, so it shows before any document is listed; backend `PlanAction.NeededFrom`) a lighter bar, its work
  (start → finish) a solid one in the same hue, a day of work with no finish a diamond; corners barely rounded.
- An action whose dates the latest schedule read moved carries a "moved" stamp
  in the table and on the plan; its page says "Moved by rev C: was … , now …".
  The stamp goes when a later read leaves its dates where they are.
- Who may upload the lists is one rule, `mayUploadLists` (`frontend/lib/core/permissions.ts`):
  Control or Plan held outright, as the backend checks. Configure does not count.
- "Documents ready" counts only the actions in a window: a month either side
  of today, or the dates the user filtered on. Never the whole schedule.

### Backend — limits and steps that bit before
- **A page never reads its lines one by one** (owner: "check every aspect for computing time, target the heaviest"): a
  list's lines come from the backend in one read, worked out in a few queries whatever their number. A package's
  documents with what its pages show (`GET /packages/{id}/lines`, `PackageService.LinesAsync`, `packageLines`), never
  each document, its context and its reviews (it was three calls or more a document, and recorded every one as opened
  by the reader); who a review still waits on comes with its row in the reviews list (`ReviewRow.WaitingOn`). A package
  in no tree reads no other package (`PlaceAsync`, `SharingAsync`, `HandDownAsync` look once for packages under it). The
  Packages list reads every package with what its view shows in a few reads (`PackageService.ListedAsync`, `Packages/PackageViews.cs`;
  only a package in a tree reads its tree). Several documents a form starts with come in one read (`GET /documents/many?ids=`,
  `backendDocuments`, not recorded as opened): New transmittal, Send for review, a supplier's sending, an action's links;
  who may review is asked once per kind of document (`eligiblePeople`).
  The same everywhere a page holds many of a thing: a document's reviews (`GET /reviews/many?ids=`, `backendReviews`), the
  Schedule's list documents (`planLists`), Start a review (`preparingOf` / `preparingRevisions`), where a document got late
  on an action (`LatenessAsync`, every need at once), the transmittal page's "one of ours?" (every loose number at once);
  documents added to and taken off an action are one call, all or none, readiness worked out once
  (`POST /activities/{id}/needs/many`). An action's page reads only its own action (`planActionRead`), never the whole plan.
  Every check run on each opening has its index (whether someone opened a document in the last half hour: `audit_events`
  actor · entity · at; the audit trail by act: action · id).
- **A file the browser runs never imports `lib/client.ts`** (it is server-only: the production build fails, `npx tsc`
  does not see it): types and plain helpers a client component needs live in a module of their own (the list sources'
  in `lib/actions/list-source-kinds.ts`, re-exported by `list-sources.ts`). Before pushing a client component that
  imports from `lib/`, check the chain.
- **Kept answers, cleared by what changed** (owner: "huge misuse of Next.js built-in functions… whatever and whenever an
  activity happens, it triggers whatever needed to be updated, partially"): a read that says what it depends on
  (`api(path, { keep: { areas, doc?, fallback? } })`, `lib/core/kept.ts`) is kept by Next.js (`force-cache` with
  `next.tags`), keyed by the person's session (Next keys a kept fetch by its headers: nobody reads another's kept
  answer), labelled `p:<project>:<area>`, `area:<area>`, `doc:<id>` and `all`. Every save in the backend names the
  labels it touched (`Platform/ScreenChanges.cs`, an EF Core save interceptor: a row's project, its own or through the
  review, transmittal, package, action or revision it hangs from; an area by the part of the app it lives in; settings,
  lists, people, functions and organizations clear `all`; audit, notifications, sessions and the outbox clear nothing):
  on a screen's own act they come back on the answer (`X-Delios-Changed`) and `api()` clears them at once (`updateTag`,
  read-your-own-writes); every change, once committed (`ScreenChangeCommits`, never before: a read in between would keep
  the old answer), is also posted to the screens' route `/api/screens/changed` (`ScreensNotifier`,
  gathered a quarter of a second; `Screens__Url`, the shared `SCREENS_SECRET`; Caddy refuses it from outside), which
  clears them for every other session (`revalidateTag(tag, { expire: 0 })`). A write around the save (an `ExecuteUpdate`)
  names its labels itself (the virus check finishing a file: its document). **Nothing expires** (owner: "the same old image unless something
  changed"): a kept answer stands until a change names one of its labels; an answer the backend works out against today
  (areas plan, reviews, transmittals: an action at risk, a step late, an answer overdue) is kept per day of its project
  (`dayOf`, header `X-Delios-Day`, the project's own midnight); what a page words from a date needs none. Kept in Valkey,
  not in the screens (owner: "copies in Redis"; `frontend/cache-handler.mjs`, `SCREENS_CACHE_REDIS`, database 1;
  `cacheMaxMemorySize: 0`): it survives a restart and is shared by every screens server; each label keeps when it was
  last named (`next:tags`), written by the screens' own acts and by the backend itself (`ScreensNotifier`,
  `Screens__CacheDb`), so a change made while the screens are down is never missed; a screens server finding Valkey
  again after losing it leaves every older answer unused (`next:epoch`). Valkey stays within 512 MB (`volatile-lru`: kept
  answers, which carry an end of 30 days unused, go first; the labels' times and the access numbers carry none and stay).
  Valkey unreachable: nothing is kept. Kept: every read a page draws from (owner: reports, cleared only by
  Count again, the register,
  documents, transmittals, packages, assets, reviews, Assurance and its plan, the Schedule and the calendar, Home and its
  log, every Settings and organization page: a settings read keeps `areas: []`, cleared by `all`). Never kept, read fresh
  every time: notifications and the account (saved without telling the screens), sign-in and security, what waits for a
  result (a file's virus check, a sheet's check, an upload, a document's snapshots), the audit trail and a person's
  activity, the notice log, and the Excel downloads. A failed sign-in counted or a lock clears nothing
  (`ScreenChangeWatcher.Bookkeeping`); a row hanging from an action, wherever it is kept, also clears the plan. Opening a
  document is still recorded once every half hour, sent after the page is drawn (`apiAfter`, Next.js `after`;
  `POST /documents/{id}/viewed`). The search index is told which organization changed (`Search/SearchSignal.cs`, through
  Redis), never asking every few seconds; it catches up once an hour, on its own index (documents tenant · updated · id).
 (owner: "we do not want any surprises"): the Schedule carries up to 20,000
  actions in one answer (`ScheduleEndpoints.MaxActions`; a P6 schedule runs to thousands) and past that says how many
  there are in all (`PlanView.Total`, `planTotal`, a line above the Schedule); Assets & tags counts up to 20,000 tags
  and draws the first 500, saying so; the Packages list reads up to 5,000. Never `Math.min(...list)` over a list that
  grows (it overflows on thousands): fold it.
- **Never hardcode a function or a job title** (owner): no "Document Control", "management", "project manager" in
  backend code, messages or comments. Functions are the organization's data. Say **the control function** (whoever
  holds CONTROL on the project) and **whoever holds Manage** (or another verb); a name shown is read from the data
  (the function's own name). The demo data's starter functions are data, not code.
- **The person's own address reaches the API** (the sign-in limit counts per address): the site's Caddy sets it, the
  screens pass it on, the API's Caddy trusts the private network (`trusted_proxies`), and the API walks back through
  every hop of ours (`ForwardLimit = null`). Lost, every sign-in came from the screens' address: one limit for everybody.
- An import reads what it compares once, never once a line, and keeps what it adds in hand: a query does not see what
  this request added and has not saved (two lines naming one new tag made it twice, and the save failed).
- **An act is done once, however often it is sent** (owner, "idempotency keys"): every `ActionForm` carries a `formKey`
  made in the browser when the form is drawn, renewed once it went through (kept after a refusal, the backend having
  kept nothing); server actions pass it on as `idempotencyKey: once(formData, "<act>")` (`lib/core/once.ts`, one name
  per call when a form makes several), and the backend's `IdempotencyFilter` answers a second press or a retry with the
  first answer. On: registering a document, starting a revision or a review, the review's answer, release, send-back,
  sending to reviewers, the dispatch outside, withdrawing from review, the check on arrival, transmittals (composed,
  received, issued, notified again), packages and a supplier's sendings, an action's decisions, postponement
  confirmations, requests' check / confirm / answer, notices, asking someone to join. The same key on a different
  request is refused in plain words (IDEMPOTENCY_KEY_REUSED: "This was already sent from this form…"). A new act that
  must never happen twice gets the filter and the key.
- **Limits per person** (owner, "rate limiting"; `PlatformSetup`, `AddRateLimiter`): beside the doors (sign-in,
  password reset, email links, two-step codes, the organization's own sign-in), every call is counted per person signed in
  (else per address), 600 a minute (`RateLimits:PerMinute`), and the heavy ones tighter, 120 a minute
  (`RateLimits:HeavyPerMinute`, policy `heavy`): a file's bytes and every preview of it, exports, list files, uploads
  asked, search (the quick find). Work never feels them; a runaway script or a stolen session is slowed at once (the
  download watch still tells the administrators). A refusal is said in plain words (429, TOO_MANY_REQUESTS, "Too many
  requests in a short time. Wait a moment and try again.", with Retry-After). Tests raise both (`DeliosFactory`). A new
  call that sends files or many lines takes `.RequireRateLimiting("heavy")`.
- **What the code scan (Semgrep) found is answered in the file** (owner, 27 Oct 2026): base images and CI actions are
  pinned (Node at a patched release, `node:22.23.4-alpine`; each GitHub action at its commit, its version beside it),
  every container runs as a user of its own or says why not beside it (`# nosemgrep: <rule>` with the reason: Postgres
  and ClamAV start as root only to drop to their own user), and the assistant's skills are left out of the scan
  (`.semgrepignore`).
- **Known weaknesses in our packages are checked by themselves** (owner, "security checks"; `.github/workflows/security.yml`):
  on every push touching the server or the screens' packages, and once a week (a weakness may be published about a
  package already in use; the build's clock, not the app's). A high or critical one stops the check; moderate and low
  ones are listed in its log. A weak package brought by another is raised under `overrides` in `package.json` when its
  newer version still works for it (today `uuid` ^11.1.1 under `exceljs`, whose own fix would have downgraded it; drop the
  override once `exceljs` asks for a safe `uuid` itself). Today: none found.
- An outbox routing key is at most 16 characters; `ControlledVersion.VersionLabel` too.
- Migrations: `dotnet ef migrations add Name -p app -s app -o Platform/Migrations`
  (from `backend/`). Each new table gets `RowLevelSecurity.Enable(migrationBuilder, "<table>")`.
- Row-level security is forced, even for the table owner: a data backfill loops over
  `tenants` and sets `set_config('app.tenant_id', …)` for each.
- Organization defaults are added through `DemoSeed.Ensure*SetupAsync`, which adds only what is missing.
- **Only our own people keep the organization** (security review, Standard-changes §79): an account of another
  organization never counts as administrator, control function or Manage holder for `/api/admin` and `/api/organization`
  (`Keepers.OursAsync`); a function holding Configure is given by an administrator only (ADMIN_ONLY,
  `Keepers.FunctionConfiguresAsync`: memberships and join requests); only an administrator sets someone's password (the person told, signed out).
  Write a permission check with brackets around every `||` inside a rule's condition.
- **Clearance is the one confidentiality rule** (owner): a document above a function's clearance is read by its people
  only if named on it, its registrar, or sent it; every function, the control function too. No level is "restricted"
  any more (the `restricted` prop is not read). The document page shows "Who may read this" when some function on the
  project has a lower clearance (`aboveSomeClearance`, backend).
- A function's clearance limits what its holders read (Standard §46); visibility always goes
  through `DocumentQueries.Visible`.
- **What another organization reads of a document** (security review, Standard-changes §82): `DocumentQueries.Visible` says
  which documents; `Documents/OutsideReading.cs` says what of them. Of one of ours, only the revisions a transmittal
  carried to them (`SentRevisions`), and of those only the files of their newest submission, never a draft replaced
  while it was prepared, nor what was said of it (`OutsideReading.AsSent`): the document's view, `/documents/many`,
  `/revisions/{id}`, every file and preview (`ReadableAsync`), and its context (no review, history only of those revisions, only the transmittals they may open,
  only supplier packages shared with them; none of its recorded points, "as it stood", which hold every revision). Of their own (originator), everything. A review only of their own document
  once decided, or with a step they answer (`OutsideReading.Reviews`: the review, `/reviews/many`, the reviews list);
  hand-overs are ours only. The register and `/documents` read one of ours at its newest revision sent to them, no
  verdict, decider or packages (`Register.RowsAsync(…, access)`). `/api/parties` gives them only their own organization.
  Settings (`Settings.cs` `Readers`): `/api/settings` whole for an administrator and whoever keeps a project
  (`Keepers.KeepsAProjectAsync`: control function, Manage), what applies on projects for the rest of ours (never
  `PROJECT_DEFAULTS`, `LIBERTY…`, the new projects' place), only the words (`STATE_NAME:`, `SET:`, `DATE_FORMAT`, the
  stamp's) for another organization's people, the same on a project's settings; `/api/liberty` none to them. The organization's controlled lists
  (`/api/controlled`, no project) are an administrator's only. Any new reader of a document's parts goes through these.
- **Answers the same for everyone of the organization** (owner: "shared reference data", "one read instead of 200"):
  read once in each backend process for all who ask, until how the organization works changes
  (`AccessVersions.SharedAsync`, under the same number as access): the values of lists (`/api/values`, read on every
  page) and which set serves which type (`/api/values/serving`), per project lists. Never an answer that depends on
  who asks (most Settings pages say who may change them: theirs stay per person).
- **Who you are and what you may do is kept until it changes** (owner: "literally static once done"): each project's
  access (`ProjectAccessLoader`) and `/api/me` are kept in each process's memory under the organization's number in Redis
  (`Platform/AccessVersions.cs`, `access:v:<tenant>`), raised once committed by every change that clears `all` on the
  screens (people, functions, rights, projects, organizations, settings, lists; `ScreenChangeWatcher`): a raised number
  leaves every older copy unused. Every request still reads the number (one Redis read, never the database) and the
  backend still checks every act. Never longer than 15 minutes (`KeptAtMost`), a safety net should a number fail to be
  raised; Redis unreachable, nothing is kept. Sign-out and a session ended are checked by the session itself, never kept.
- **The notices job reads once a pass** (`ActionNotices.ProjectAsync`): what was already sent about the actions it
  reads, and the days off, once per project, never one query per action and discipline; it reads only the actions whose
  notice day has come (`NoticeOn`), never the whole schedule.
- **Packages move on a change, never on a reading** (owner): a document registered or changed in what a rule reads, a tag
  linked, a package made, moved, given a rule or ended sends `PackagesMoved` with its save; the worker takes in what
  rules admit and hands documents down trees (`PackageService.RestateAsync`). Opening a list or a package changes
  nothing; a list reads its trees once (`TreeFactsAsync`, `PlaceOf`). Supplier documents in none of their packages are
  filed by hand only, **Fill the package** on a supplier's package (`POST /packages/{id}/fill`, PACKAGE_FILLED).
- **Files are never read** (owner: "never ever read the files, ever ever, forbidden forever, unless I get back on that
  with a client's request"): search is a document's number and title only; text extraction and OCR cannot be switched
  on (`ExtractionModes.Forbidden`, CONTENT_NOT_READ). The extraction code stays, locked off (owner: "it may be helpful
  for future AI integration").
- **Files are kept encrypted** (owner, security review: "those files should be PROTECTED"): every file is sealed by the
  app before it is stored (`Documents/FileCipher.cs`: a key of its own per file, kept in its header under the
  installation's key, AES-256-GCM, pieces of 64 KiB each checked, the last marked), so the store, its disk and every
  copy hold only sealed bytes; the key lives apart (`Storage:EncryptionKey`, FILES_KEY in .env, made by deploy/init-env;
  lost, nothing can be read again: kept also in a password manager or a safe). `FileStorage` seals on keeping an upload
  (in from its waiting place, through a temporary file), on putting what the app makes (stamped copies, previews,
  lists, replies by email) and opens on every read; a copy in the store keeps its seal; files kept before stay as they
  were and are read so. **Nobody downloads from the store** (no signed download link any more): the bytes come through
  `GET /files/{id}/download`, which checks who asks (`ReadableAsync`) and opens them, and the screens pass them on
  (`app/api/files/[id]/route.ts`). Uploads still go to the waiting place by a signed link, through the screens' server.
- **Each key holds no more than it needs** (owner, security review): the app's storage key reads, adds and removes files
  and never administers the store (no bucket made or removed); the copier's only reads (`STORAGE_COPIER_KEY` /
  `STORAGE_COPIER_SECRET`, SeaweedFS identities in compose). The app holds no key to the backup copy.
- **Converters on a closed network** (owner, security review): the DWG reader, LibreOffice (Gotenberg) and Tika sit on
  the compose network `converters` (internal: no way out), reached only by the API and the worker, never reaching the
  database or the store. The files' store and their copier are pinned to a version (`seaweedfs:4.48@…`,
  `rclone:1.75.2@…`), changed only when we choose.
- **Downloads are prepared in the background** (owner: "people should expect big files to take time"): every link or
  GET form to an export, a list or a report's Excel is fetched by `components/downloads.tsx` while the person works, a
  tray saying so; from code, `startDownload(href, label)`. Exports match their lines in one pass (lookups, never a scan
  per row).
- **Kept until it changes, on the backend too**: the lists (`Catalog.LoadAsync`, not while the request changes a list),
  which lists a request reads and how dates read (`PlatformSetup`), counts of acts (`Audit/AuditCounts.cs`, topped up
  with what was written since), when people were last seen (`people_seen`, written by `audit_seen` with the act).
- **Recorded as it happens, never swept for** (owner: "record the thing using the trigger that happens anyway"): a fact
  derived from many rows is written by the act that makes it true and read back, never worked out by going back over
  records on a page's reading. Where the app writes rows carrying a version stamp (documents, revisions, transmittals,
  reviews, packages), the database records the fact in a table of its own (`Platform/Recorded.cs`): `revision_facts`
  (a transmittal other than a review's first carried it: released with none is "not sent yet"; trigger
  `record_carried` on `transmittal_items`), `transmittal_facts` (first answered or followed by someone else; trigger
  `record_answered` on `transmittals`), `document_facts` (released and at what, the newest revision's verdict and
  whether it waits to be released, its last file, when it first went out: what the register filters and sorts on,
  worked out again for that one document by `refresh_document_facts` whenever its revisions, reviews, files, transmittal
  lines or newest revision change), `values_used` (how many documents carry each discipline and document type, counted
  up and down by `count_values_used`: the register's filters, `GET /register/used`). Read only by the app; `rebuild-recorded` (backend command, by hand) writes them
  again from what exists. Opening and downloading are only said (who, what, when): no history point is taken for them.
  **The Schedule reads where each action stands from what it keeps** (`Activity.NeedCount`, `MetCount`, `RiskFrom`,
  `LastMetAt`, written by `Readiness.RestateAsync` when one of its documents or needs changes, or the days around an
  action do; `ScheduleEndpoints.RecordedFacts`): its needs are read only for the actions shown (`RowsAsync`,
  `InFullAsync`). Another organization's actions are still read with their needs, narrowed to what it sees.
- **Nothing runs on a clock to find out what happened** (owner: "we do not send spies… we go outside and inform that it
  just happened"): the outbox's relay runs in every process and sleeps until an act of that process, once committed with
  a message, rings it (`OutboxWake`; on start it sends what was left waiting, a failure tries again after 5 seconds);
  the checks run only when someone runs them (`CheckScheduler.RequestAsync`, no daily job); each stored file is copied to the
  second place as it is stored, by the copier, never the app (owner, security review): `FileStorage` keeping, putting or
  copying a file says its key on a Valkey list (`Documents/FileBackup.cs`, `files:to-copy`), the copier waits on it
  (`deploy/file-backup`, its own image: rclone with Valkey's client, both pinned) and copies that one file, never
  overwriting, never deleting, putting it back on the list when a copy fails; its full comparison runs once a
  week as the safety net (`FILE_BACKUP_EVERY` 604800; alert past 8 days); notices fall on days written
  by what changed them (above). What stays timed is a fallback, never the way to learn of a change: access kept 15 minutes at
  most, the search index's hourly catch-up (OpenSearch only, off by default), a page re-reading itself
  while a file it waits for is checked (three minutes at most). A state is never kept fresh by a
  clock: it is read when looked at, or written by the act that changes it.
