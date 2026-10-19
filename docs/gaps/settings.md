# Settings — what is left

Where the Settings round stopped (both levels, organization and project). Read with `CLAUDE.md` (Settings) and
`docs/STANDARD-CHANGES.md` §61–67.

## Done

People & access, Organizations, This project, The plan (under Assurance), Types & sets, Review outcomes, Forms &
fields, Numbering (both levels, polished), Audit trail. On two levels: Numbering, Revisions, Review routes, Types &
sets (per list), Forms & fields (per form), Functions (the organization's), the Control room (fixed answers read only).
The organization's space: Projects, People, Organizations, Settings; organizations link by themselves once proven.

## Next cards to check, in this order

Each found wrong in the Settings review of 2026-10-16 (`.impeccable/critique/`), and only moved onto the two levels since.

1. ~~**Revisions**: lowercase revision letters are turned upper case on save; zero padding cannot be set.~~ Done: "Starts
   at" says both, as written ("a": small letters, "01": two digits); the backend reads them from it, and a line revisions
   carry keeps how its values are written.
2. ~~**Control room**~~ Done: the four switches work; the flow draws "Released & issued" as one step (two where the
   project keeps them apart) and has a third flow, "Documents a supplier owes us"; the days around an action (needed
   before, at risk from) are set there.
3. ~~**Review routes**~~ Done: an outside organization's step asks "Why it goes to them" (a reason for issue, kept,
   required by the backend: STEP_REASON_REQUIRED); only the two ways the backend runs a step are offered (all of them,
   or whoever gets to it first); "Offer this route first" puts it first among routes as specific; "From which
   organization" lists the organizations taking part, by their code, as a document's originator is.
4. ~~**Functions & permissions**~~ Done: a tick is the permission on every document, what pressing it gives or takes
   (held for certain documents only shows as half, and its question says it gives it on every document); "Review
   routes" and "Read matrix", which the backend never keeps on a function, are not offered (`GRANTABLE`).
5. **Sign-in & security**: single sign-on and "password sign-in off" exist in the backend with no screen.

## Small things seen, not done

- Numbering, "What is numbered": after another scheme is picked, the example beside it shows the old one until Save.
- The organization's band on a phone cuts the organization's name ("Dem…").
- Functions step 2 (a project's own rights): only if a project needs it.
- A Control room answer made fixed later: the project keeps what it held. Whether the organization's answer should
  then reach it is not decided.
- Demo data: schemes seeded with documents are not marked as having given numbers (real use marks them).
