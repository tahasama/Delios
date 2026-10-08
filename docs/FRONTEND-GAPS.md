# Frontend on the backend: what the backend does not give yet

Every screen is the owner's, unchanged: only where its data comes from
changed (checked against `main` with `git diff`). Every page loads on the
backend for Document Control, an engineer and a supplier. Where a screen asks
for something the backend has no counterpart for, it reads as the screen
already reads "nothing" (an empty list), and the act answers
"… is not supported yet."

## The biggest missing pieces
1. **Notifications**: none are kept or sent; the bell shows no count and the page is empty.
2. **Delegation** of a review step (ask, grant, refuse, end).
3. **Holds** on a released revision awaiting an outside approval; **voiding** a revision and its reassessment.
4. **Assets** (the tag list, and linking documents to tags).
5. **Transmittals**: copies (CC), drafts, replies and follow-ups, "notify again", choosing the date sent or received, a letter with no documents.
6. **Requirements calls** to departments, issuing to senders, readiness confirmations.
7. **Uploaded lists for a decision** ("Controlled changes"): the backend's schedule import applies at once.
8. **Releasing without review** for a document type that is not reviewed.
9. **Comments**: taking back or changing one before the step is answered.
10. **Snapshots** of a document at each recorded point (its "as it was" page is empty).
11. **Readers of a closed document**, **legal hold**, **published exceptions**, **number ranges**.
12. **Organization's own form fields** are asked but not stored with the record.

## Added to the backend while connecting
- Admin API for every Settings screen: people, projects and who is on them, functions and the matrix, organizations, value lists, numbering, review routes, the audit trail. Holders of Configure administer; Document Control keeps people, functions, organizations, numbering and routes.
- Web sign-up: an organization registers itself with the recommended starter configuration (switch: `SignUp:Enabled`).
- A revision can start ahead of its files and have them attached while in preparation.
- Editing a document's details (each change audited); withdrawing, cancelling or archiving a document.
- Review views carry who sat on each step and who wrote each comment; holders carry their function code; a project's code can change.
- The organization's own answers with no table (list names, scope statement, state names, form rules, own fields, an organization's contact, a project's type and dates) live in the backend's settings store.

## By area, in detail
- [Reviews](gaps/reviews.md)
- [Transmittals](gaps/transmittals.md)
- [Packages](gaps/packages.md)
- [Actions & schedules](gaps/actions.md)
- [Conformance, reports and the smaller screens](gaps/conformance-reports.md)
- [Registering, import and exports](gaps/register-import.md)

## Everywhere
- Notifications: the bell shows no count; there are no notifications in the backend.
- Two-step sign-in: the sign-in page has no field for the code, so an account with it on is refused with a message.
- An administrator opening a project they are not on (they had to be put on it in People & access).
- A function's clearance level and family-wide matrix rules (the backend matrix has no families).
- Project kind (the project switcher's "kind" line).
- State names, control activities and policies are kept (backend settings store) and the screens read them; the backend itself does not act on: release and issue together or apart, an act carried out by the people instead of Document Control.

## Documents register
- Phases (the phase column and filter are empty).
- Search by asset tag.
- "On hold" revisions; decisions taken by delegation.
- A revision received from another organization and not yet checked (RECEIVED) or returned for a correction (CORRECTING) reads under its backend name: the screen has no name for those two states.
- A supplier sends from its own transmittal ("Send to us"), not from the register.

## Document page
- Assets: no asset tags to link a document to ("Link an asset" answers "not supported yet").
- Naming the readers of a closed (confidential) document.
- The document as it was at each recorded point (the history page lists none).
- History lines show the act and its detail; field-by-field old → new values are in the detail text.
- Holding a released revision while an outside approval is awaited (hold, lift, send back held).
- Voiding a revision, and the void reassessment.
- Confirming and correcting a record; withdrawing an approval; reclassifying a comment.
- Legal hold. Disposal is refused on purpose: only the app owner removes anything.
- Taking back or changing a comment before the step is answered (close it with a resolution instead).
- A document type that skips review cannot be released without a review yet ("Send on for release").
- Asking for a revision to be sent: "leave it to the author" and "an outside party approves it first" are not kept.
- Sending for review: the people on each step are whoever holds the step's function; picking other people per step is ignored.
- Review routes and organizations (parties) are not edited from the screens yet.
- The form's own extra fields (Settings → Forms & fields) are asked but not stored with the document.
- Previous number, legacy scheme and application version are not stored.
- Supplier side: a transmittal "turned back" shows as sent; Document Control returns the revision for a correction instead.
- The checklist before an act shows the permission line only; the backend refuses an act that is not ready, with its reason.

Added to the backend for this page: starting a revision ahead of its files and attaching them after; changing a document's details (each change audited); withdrawing, cancelling or archiving a document; who sat on a review and who wrote each comment; the function each holder holds.
