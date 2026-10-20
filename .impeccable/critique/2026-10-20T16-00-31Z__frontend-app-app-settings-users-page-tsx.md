---
target: /settings/users
score: 27
target_identity: "file:/home/user/delios/frontend/app/(app)/settings/users/page.tsx"
target_fingerprint: "sha256:367b8c08e6119a3548b726b88cd81487281b84e8e7a2f6a52c50f97f537002a7"
target_path: /home/user/delios/frontend/app/(app)/settings/users/page.tsx
timestamp: 2026-10-20T16-00-31Z
slug: frontend-app-app-settings-users-page-tsx
---
# Critique — People & access (/settings/users) and a person's activity (/settings/users/<id>)

Score: 27/40

| Heuristic | Score | Note |
|---|---|---|
| Visibility of status | 3 | Who is on, waiting, refused is clear |
| Match with the real world | 3 | Plain words; "Other projects" column mostly dashes |
| User control | 3 | Change opens in the row, Cancel on the strip |
| Consistency | 2 | Pencil on most rows, a text link "Ask for them to join" on one; two "People & access" back links on the activity page |
| Error prevention | 3 | Take off is asked first |
| Recognition over recall | 1 | A person's name opens their activity, but looks like plain text: nobody finds it |
| Flexibility | 2 | No way to find a person by name; only organization chips |
| Minimalism | 3 | Masthead paragraph is long |
| Error recovery | 3 | |
| Help | 4 | Says how joining works here and where to change it |

## What works
- The masthead says how joining works on this project, with the way to change it.
- One row opens as the form, never a box in a box.

## Problems
- **P1 The activity page is hidden.** The name is the only way in, and it reads as plain text (no colour, no icon). The owner did not know the page existed.
- **P1 The slip's kind reads "Opened and downloaded" on an act that only opened.** The kind is "opened or downloaded"; better, each slip already says its act.
- **P1 The breadcrumb shows the raw id** ("01a13552 5a71 …") on the activity page. An id is never shown.
- **P2 "change it" on the activity page goes to /organization#tracking**, which moved to the organization's Settings (What is kept).
- **P2 Two ways back** on the activity page (breadcrumb and a top-right link).
- **P2 No search** on Everyone: fine for 9 people, not for 90.
- **P3 "Other projects"** is dashes for nearly everyone: the column takes room for little.
- **P3 The row act differs** ("Ask for them to join" in words where others have a pencil).

## Personas
- Control function adding a site engineer: finds Add someone at once.
- Administrator after a complaint about who opened a drawing: does not know there is a page for a person's activity.
