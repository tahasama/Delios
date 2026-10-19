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
2. **Control room**: four switches the app never reads (issuing to reviewers, issue, authorizing a revision, "ready
   when"); the flow for a supplier's documents (placeholder, check, who holds it, hand-back) is not shown; release and
   issue still drawn as two steps when they are one act; no default lead days.
3. **Review routes**: a step answered by another organization loses its "reason for issue" on save; two step types
   that do not exist are offered; "Offer this route first" does the opposite; "From which organization" never matches.
4. **Functions & permissions**: a tick can give a permission while saying it takes it away; two columns ("Review
   routes", "Read matrix") are refused by the backend, silently.
5. **Sign-in & security**: single sign-on and "password sign-in off" exist in the backend with no screen.

## Small things seen, not done

- Numbering, "What is numbered": after another scheme is picked, the example beside it shows the old one until Save.
- The organization's band on a phone cuts the organization's name ("Dem…").
- Functions step 2 (a project's own rights): only if a project needs it.
- A Control room answer made fixed later: the project keeps what it held. Whether the organization's answer should
  then reach it is not decided.
- Demo data: schemes seeded with documents are not marked as having given numbers (real use marks them).
