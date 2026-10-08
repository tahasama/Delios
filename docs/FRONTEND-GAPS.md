# Frontend on the backend: what the backend does not give yet

The screens are the owner's, unchanged; only where their data comes from
changed. Where a screen asks for something the backend has no counterpart for,
it is listed here, by screen. Nothing on a screen was removed: an empty value
reads as the screen already reads "nothing".

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
