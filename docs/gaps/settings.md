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
5. ~~**Sign-in & security**~~ Done: the organization's own account (single sign-on: name, provider's address, client
   id and secret, email domains, in use) and "Everyone may sign in with a password" are set there; the sign-in page has
   "Sign in with your organization's account" (its short name, then the provider). Two faults on the way fixed: a
   refused sign-on sent people to a page that does not exist (now the sign-in page, in plain words), and a successful
   one set a session the screens did not read (now taken over as theirs). Not tried against a real provider here.

## Small things seen, not done

- ~~Numbering, "What is numbered": the example showed the old scheme until Save~~ (done: it follows the scheme picked).
- ~~The organization's band on a phone cuts the organization's name~~ (done: its two ways out keep only their icons there).
- ~~Functions step 2 (a project's own rights)~~ (done: where the organization leaves Functions & permissions free).
- ~~A Control room answer made fixed later~~ (decided, owner: what a project changed is never overridden by the
  organization; only a reset from the organization's card touches it, and a reset keeps a copy that can be put back).
- Demo data: schemes seeded with documents are not marked as having given numbers (real use marks them).
- ~~The organization's "Reset to the app's defaults" keeps no copy yet~~ (done: replacing the defaults, from a project
  or back to the app's own, asks why and keeps a copy, put back from the defaults' page).
- ~~A review rejected a day before the action it serves leaves no time to put it right~~ (decided by the owner, 30 Oct
  2026: "their own ways, not our problem"; the organizations plan their reviews themselves, nothing is built for it).

## The organization's Control room (left to do)

- It is drawn for any role: a project draws it for our role there. An organization working mostly in one role could
  choose the role its console is drawn for.
- ~~The risk window has no organization's value of its own~~ (done: both days around an action are on two levels).
- "Who acts as the control function", the schedule's days and how suppliers send are said on the organization's
  console, never changed there: they are each project's.
