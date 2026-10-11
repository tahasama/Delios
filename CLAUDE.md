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
| `docs/gaps/*.md` | Known gaps per area |
| `PRODUCT.md` | Product context and users |

## How to work with the owner

- Short, plain replies. No jargon. PowerShell commands one per block.
- Never send screenshots or pictures.
- Never quote a bare document number as a reference.
- Ask before choosing any code (status, verdict, type…). A code never changes once used.
- Nothing is deleted except by the app owner.
- No model names in commits. Commit and push to the working branch.
- Do not run the tests unless asked; do compile (`dotnet build`, `npx tsc --noEmit`).
- Think about the whole flow, not a patch. When the owner reports something
  wrong, revisit the whole flow it belongs to (start → withdraw → send again →
  advise → decide → release → issue), not only the line reported.
- Never remove behaviour that exists without saying so and why.
- No code written inside the page (no inline scripts, no `dangerouslySetInnerHTML`).
  Display preferences (theme, sidebar width) live in cookies the server reads.

## Design — locked in by the owner

- The look of Schedule & actions is the reference for every page, card and
  form, including the hidden ones (panels, popovers, details).
- One control size everywhere, set once in `src/app/globals.css` on `:root`:
  `--control-h` (2rem), `--control-text` (13px), `--control-radius`. Every
  field, dropdown, button and file field stands that height with that text.
- Use the shared pieces only: `btn()` and `inputCls` (`src/components/ui.tsx`),
  `.ask`, `.plain`, `ActionForm`. Never give a field or button its own height,
  padding or text size on a page; never restyle the file button locally.

## Rules that must never break

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
  review page. The review stays in the register as **Withdrawn** with its
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
- Criticality: the document type recommends a level (Settings, on the type);
  it is filled in on create and marked "(recommended)"; the person may choose
  another. Each level shows its meaning and what it decides.

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
  and under "What happened to it" in the Revisions tab on the revision it
  happened to (document-level events go to the revision newest at the time).

### Schedule & actions
- The schedule (SCH), disciplines per action (DPA) and requirements (RQL) are
  register documents, revised and released on the document page.
- Their Excel is uploaded on Schedule & actions only by Document Control or a
  function with the Plan permission.
- Released revision: "this file is rev X as released" is ticked by default;
  only when unticked is a reason obligatory. No released revision: a reason is
  obligatory. Always logged. Same on all three uploads.
- Releasing a list document reads its Excel automatically (the schedule, when it
  is the project's schedule; DPA and RQL by their type). The three upload buttons
  stay, for no document, not released, no Excel attached, or a failed read.
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
- Filters: a dropdown picked with the mouse applies at once; with the keyboard,
  on leaving it. Apply lights only while typed words or dates wait. Every filter
  is kept through sorting, paging, load more, the key and export.
- Progress on an action: a date still to come is shown as due, never as done.
- Under each stage of Schedule & actions: the revision in force, "Uploaded
  directly" (with the day) when a direct upload is newer, "Not released yet",
  or "None yet".
- An action whose dates the latest schedule read moved carries a "moved" stamp
  in the table and on the plan; its page says "Moved by rev C: was … , now …".
  The stamp goes when a later read leaves its dates where they are.
- "Documents ready" counts only the actions in a window: a month either side
  of today, or the dates the user filtered on. Never the whole schedule.
