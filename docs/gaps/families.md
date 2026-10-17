# Document families — on hold, to research first

Where the conversation with the owner stands (to pick up later, not to build now).

## The idea

Group document types into families, so a family can tell a few things about every type in it:

- the **criticality** its documents usually carry;
- whether its documents must be **signed / stamped and scanned** by an outside body (a control office, an authority),
  or whether **the app's own approval is enough**, legally speaking;
- whose documents they are: our own internal types (three letters, e.g. DWG) and suppliers' types (e.g. C102).

## Why it is on hold

Whether the app's approval is legally enough, and when an outside stamp is required, needs a thorough reasoning and
research (by country, by contract, by kind of document) before the owner can decide. The families were not
repopulated when the demo data was renewed, and were then forgotten.

## What stands today

- Settings → Document families and `lib/settings/families.ts` (list `DOC_FAMILIES`, prop `stamp` NONE / BEFORE /
  AFTER) exist, but **nothing in the app applies the stamp rule**: the backend never reads it. So the plan
  (Assurance → The plan) does not mention families.
- What is used meanwhile: each deliverable type has its own document types (a type names the deliverable types it
  belongs to; several lists of types can exist). That groups internal and supplier types for now.
- Whether families keep a Settings card of their own, and how they relate to deliverable types, is not decided.

## To decide, after the research

1. Is the app's approval enough, and where is an outside stamp or a wet signature required?
2. If a stamp is required: is the revision held until the stamped copy comes back (before), or released with the
   stamped copy owed (after)? Then the backend applies it, and the plan states it.
3. Do families stay a list of their own, or become a property of the deliverable type?
