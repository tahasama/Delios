---
target: /settings/functions
score: 22
target_identity: "file:/home/user/delios/frontend/app/(app)/settings/functions/page.tsx"
target_fingerprint: "sha256:50d2009d18cf18045fbce0c68b6dd8233987aadde8bab0dade6ef5acc12a9dcb"
target_path: /home/user/delios/frontend/app/(app)/settings/functions/page.tsx
timestamp: 2026-10-20T11-54-51Z
slug: frontend-app-app-settings-functions-page-tsx
---
# Critique: Functions & permissions (/settings/functions, and the organization's card)

**Score: 22/40.** The detector found nothing. The grid answers "who may do what" well at a glance. The trouble is below it: the same thing is changed in two places that don't match. The verbs are never explained. The function form doesn't follow the reference style.

## Heuristics (0–4)
| # | Heuristic | Score | Why |
|---|---|---|---|
| 1 | Visibility of status | 3 | The ticks are clear. Clearance and "not in use" don't show in the grid. Whether the project has its own copy is only said in the subtitle |
| 2 | Match with the real world | 2 | Twelve one-word verbs (Control, Accept, Receive, Plan) are explained only on hover, on a rotated label. The subtitle says "distribution matrix" |
| 3 | User control | 2 | A rule's **Remove** is a big red button; the delete icon rule is not followed. Name and code can never be changed, and nothing says so |
| 4 | Consistency | 2 | The card heads are small grey capitals, not the reference plate. "+ Add a rule" and "+ New function" are disclosure triangles with a "+". The function's Department / Clearance / in use / Save strip has no heading |
| 5 | Error prevention | 3 | Every tick asks first and names who it changes; Configure is locked on a project |
| 6 | Recognition over recall | 2 | The narrowed rules read "only for A; B" under the name. A rule's scope is a chain of labels with no field names |
| 7 | Flexibility | 2 | A rule can't be changed, only removed and added again. A rule can't be narrowed from the grid |
| 8 | Minimal design | 2 | A table of 5 rows has "5 rows" and "Columns". The Department column is all dashes. A project with nothing to change still shows the full plate text |
| 9 | Error recovery | 2 | A rule added with no verb is refused, but the form doesn't outline "May" |
| 10 | Help | 2 | Nothing says what each verb lets a person do. "Who holds which function → People & access" is not a link |

## P1: two ways to change the same thing, out of step
- The grid ticks give a verb "on every document". "Change a function" adds rules that grant verbs on narrowed documents. They are the same data shown twice. A tick removes the verb from the everywhere-rule only, so a narrowed rule can still grant it. The "◐" mark is the only clue, and it's hidden in the demo.
- **Fix:** one place per function. Its name in the grid opens the function under its line, in place: the rules as rows (Everywhere first, then each narrowed rule with its field names), each with its delete icon, and "Add a rule" as a row of the same table. Same pattern as Organizations and People.

## P1: the verbs are never said in words
- The rotated headers are hard to read and give only one word. A control function deciding to give "Accept" or "Receive" can't tell what it lets people do.
- **Fix:** horizontal short headers (12 fit at 1280px), plus a key under the grid: each verb with its `VERB_BLURB`, always visible. Or a "What each one allows" tip.

## P2: the function's own fields
- Department / Clearance / in use / Save sit under the rules with no heading. They read as part of the last rule. Name and code are passed hidden, so they can never be fixed.
- Clearance (what the function reads) is a real limit, but the grid doesn't show it.
- **Fix:** "The function" band first (name, code once, department, clearance, in use), then "What it may do". Add a Clearance column to the grid when any function has one.

## P2: house style
- Rule **Remove**: big red button → bin icon, asked first.
- "+ Add a rule" / "+ New function" as triangles → the reference row-form way. "New function" belongs on the plate as the page's first act.
- Card heads → the reference plate and sheet bands (DETAIL-STYLE).
- Chips on rules (green outline) look like the ticked grid boxes but mean something else.

## P3
- Drop the "5 rows / Columns" bar for this grid; it's not a register.
- Hide the Department column when no function has one.
- On a project where the switch is Fixed, the plate says it once, and the grid reads quietly (as now).
- "Who holds which function here is changed in People & access" → a link.
- The organization's card: "Projects may change what each may do", "Projects with their own" and "Kept when put back" are three separate cards. They could be one sheet "On projects".

## What works
- The grid itself: one line per function, ticks in their place, people counted.
- Every tick asks first and names how many people it changes (CLAUDE.md rule).
- The project page with the switch Fixed is quiet and plain: read only, no dead buttons.

## Personas
- **Control function on a project (switch Free):** opens the page to let engineers approve civil drawings. Finds the grid, ticks Approve, which gives it on every document. Has to find "Change a function", open Engineer, "+ Add a rule", tick Approve, choose Civil. Two places, no link between them.
- **Administrator setting up the organization:** creates "Site engineer", then can't fix a typo in its name.
- **Someone of ours reading it:** wants to know who can release. Has to hover rotated words to guess which verb is "release".
