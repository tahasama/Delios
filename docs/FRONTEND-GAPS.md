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
