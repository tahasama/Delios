---
target: /settings/workflow-templates
score: 21
target_identity: "file:/home/user/delios/frontend/app/(app)/settings/workflow-templates/page.tsx"
target_fingerprint: "sha256:ff6e1cfef4e4c907bd20e09d5ae37c9e74fec5a7c07a1a066f6d5709ea72664c"
target_path: /home/user/delios/frontend/app/(app)/settings/workflow-templates/page.tsx
timestamp: 2026-10-20T00-41-08Z
slug: app-settings-workflow-templates-page-tsx-e8984199
---
# Critique: Review routes (/settings/workflow-templates)

**Score: 21/40.** The detector found nothing. The page reads cleanly at a glance, but the summary cards say things that are not true, and the edit form breaks the house rules.

## Heuristics (0–4)
| # | Heuristic | Score | Why |
|---|---|---|---|
| 1 | Visibility of status | 2 | The summary leaves out each step's days and the status it grants; the project/organization level sits in loose text outside the plate |
| 2 | Match with the real world | 2 | "Used for: A" is a bare code. "box" and "step" are used for the same thing. "default" chip vs "Offer this route first" |
| 3 | User control | 2 | "Stop using it" is a plain word beside chips, close to "default"; Edit is a fold inside the card |
| 4 | Consistency | 2 | The card head is tiny grey capitals (not the reference plate). "Save route" vs "Publish route" |
| 5 | Error prevention | 3 | Empty steps are flagged in amber; a verdict set that doesn't fit is warned of |
| 6 | Recognition over recall | 2 | Scope reads as codes; our people show no function; the group heading reads "Unassigned organization" |
| 7 | Flexibility | 2 | No reorder; adding a step is a faint "+" between boxes |
| 8 | Minimal design | 2 | Box in a box in a box: card → Edit fold → "The route" panel → step panel → people list (scrolls, cut in half) |
| 9 | Error recovery | 2 | Messages are fine, but a refused save doesn't point to the step |
| 10 | Help | 2 | The lead says how it works, but the same sentence repeats three times (subtitle, "The route", step panel) |

## P0: says something false
- **"Client approval: by discipline when sent" (amber)**: the step is answered by **Northwater Utility** (stored `PartyCode: NWU`, reason APPROVAL). The summary card ignores `partyId`. This breaks "Screens always show the actual names, on every step".

## P1
- **"Used for: A"**: the criticality code, alone. It should say "Criticality: A — High" (labels from the lists), as the form does.
- **A form inside a box inside a box** (CLAUDE.md: "A form never sits in a box inside a box"). Edit should open the route itself as the form, the new-document way: Cancel / Save on a strip, no fold.
- **The route name is the weakest text on the card**: 11px grey capitals with the description beside it. It should be a title, with the description under it.
- **The summary leaves out what matters**: each step's working days (5, 10), the status it may grant (AFC), "whoever gets there first / all". The form has them; the summary only shows the people.
- **Two levels are loose text** between the header and the cards ("The organization's review routes. Projects may change them…"). They belong in the plate, as on the other cards: organization's · free · own copy.

## P2
- "+ New review route" is a fold at the bottom; it should be the plate's first act (a button), opening the form under it.
- People picker: group "Unassigned organization" for our own people; the second line (function) is empty; the list is cut halfway through a row.
- The words: "box" → "step" everywhere ("Remove this step", "This step advises…"); "default" chip → "offered first"; one button word: "Save".
- "Stop using it" should be an icon (bin-like "stop") with its name on hover, per the icon rule, asked first (it already asks).

## P3
- The step arrow and "+" are very light (slate-300); adding a step is hard to find.
- "What it does to the status" says "Nothing…" in a long sentence even when nothing can be chosen.

## Personas
- **Control function setting up a project**: can read the routes, but would think the client step is unassigned and "A" means nothing.
- **Sender** (sees the routes on Send for review): unaffected here.
- **Administrator on the organization's card**: same board, same issues.

## Strengths
- Steps drawn left to right with advises / decides: the model reads at once.
- Empty steps and a verdict set that doesn't fit are warned of, never refused.
