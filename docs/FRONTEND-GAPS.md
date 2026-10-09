# Frontend on the backend: what the backend does not give yet

Every screen is the owner's, unchanged: only where its data comes from
changed (checked against `main` with `git diff`). Every page loads on the
backend for Document Control, an engineer and a supplier. Where a screen asks
for something the backend has no counterpart for, it reads as the screen
already reads "nothing" (an empty list), and the act answers
"… is not supported yet." The per-area pages below were written before the
latest additions; where an item there is listed above as added, it is done.

## Still missing
Nothing. The two screen items that were left are now in:
- **Two-step sign-in**: the sign-in page asks for the code, and walks through first-time setup with recovery codes.
- **Comments on the review page**: write, change and take back your comments until you answer; Document Control
  or the revision's author can change whether an open comment stops the release.

Not built on purpose: a document number on its own, before registering (a number is given only when a document is
registered).

What behaves differently from the old app, and why: [BEHAVIOUR-CHANGES.md](BEHAVIOUR-CHANGES.md).

## Added to the backend while connecting
- Admin API for every Settings screen: people, projects and who is on them, functions and the matrix, organizations, value lists, numbering, review routes, the audit trail. Holders of Configure administer; Document Control keeps people, functions, organizations, numbering and routes.
- Web sign-up: an organization registers itself with the recommended starter configuration (switch: `SignUp:Enabled`).
- A revision can start ahead of its files and have them attached while in preparation.
- Editing a document's details (each change audited); withdrawing, cancelling or archiving a document.
- Review views carry who sat on each step and who wrote each comment; holders carry their function code; a project's code can change.
- The organization's own answers with no table (list names, scope statement, state names, form rules, own fields, an organization's contact, a project's type and dates) live in the backend's settings store.
- Notifications, and an email outbox with sending switched off (`Email:*` in `deploy/.env`).
- Review delegation; changing or taking back a comment; releasing a type that is not reviewed.
- Voiding and its reassessment; an outside approval before use, with holds; legal hold; readers of a closed document; previous number, legacy scheme, application and own fields on a document; a snapshot of the document at each change.
- Transmittal copies, drafts, letters with no documents, chosen dates, answers and follow-ups, telling again, opening counts, arrival notes and who something received is for, own fields.
- Asset tags and their links to documents; published exceptions; number ranges; calls to departments, readiness, lists issued to senders, telling departments; uploaded lists waiting for a decision.
- Packages with several reasons, own fields, filling by asset tag and a reason to delete; confirming and correcting records, withdrawing an approval, reclassifying a comment.
- Files kept with something received after it was recorded; returning what arrived when no "return" outcome is published.
- A route's own verdict list; people named on a route's step; the warning the working day before a step falls due.
- Who still holds a replaced revision without being told (Exposures), and telling people with an account at release.
- A function's clearance (the most confidential level it reads without being named).
- Numbers drawn from ranges issued to a party; "VOID" and "ON HOLD" copies of the PDF; an administrator joining a project they are not on; project type on the project; matrix rows by document family.

## By area, in detail
- [Reviews](gaps/reviews.md)
- [Transmittals](gaps/transmittals.md)
- [Packages](gaps/packages.md)
- [Actions & schedules](gaps/actions.md)
- [Conformance, reports and the smaller screens](gaps/conformance-reports.md)
- [Registering, import and exports](gaps/register-import.md)

## Everywhere
- Two-step sign-in: the sign-in page has no field for the code, so an account with it on is refused with a message.
- An administrator opening a project they are not on (they had to be put on it in People & access).
- A function's clearance level and family-wide matrix rules (the backend matrix has no families).
- Project kind (the project switcher's "kind" line).
- State names, control activities and policies are kept (backend settings store) and the screens read them; the backend itself does not act on: release and issue together or apart, an act carried out by the people instead of Document Control.

## Documents register
- Phases (the phase column and filter are empty).
- A revision received from another organization and not yet checked (RECEIVED) or returned for a correction (CORRECTING) reads under its backend name: the screen has no name for those two states.
- A supplier sends from its own transmittal ("Send to us"), not from the register.

## Document page
- History lines show the act and its detail; field-by-field old → new values are in the detail text.
- Confirming and correcting a record; withdrawing an approval; reclassifying a comment.
- Sending for review: the people on each step are whoever holds the step's function; picking other people per step is ignored.
- Review routes and organizations (parties) are not edited from the screens yet.
- Supplier side: a transmittal "turned back" shows as sent; Document Control returns the revision for a correction instead.
- The checklist before an act shows the permission line only; the backend refuses an act that is not ready, with its reason.

Added to the backend for this page: starting a revision ahead of its files and attaching them after; changing a document's details (each change audited); withdrawing, cancelling or archiving a document; who sat on a review and who wrote each comment; the function each holder holds.
