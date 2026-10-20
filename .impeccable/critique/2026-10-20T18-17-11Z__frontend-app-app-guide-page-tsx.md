---
target: /guide
score: 21
target_identity: "file:/home/user/delios/frontend/app/(app)/guide/page.tsx"
target_fingerprint: "sha256:1e4f055d7f86fca26ed823bfeec5bf79721f0746d66c2cce9b0c4e88a2949e2f"
target_path: /home/user/delios/frontend/app/(app)/guide/page.tsx
timestamp: 2026-10-20T18-17-11Z
slug: frontend-app-app-guide-page-tsx
---
# Critique — Help & orientation (/guide)

Score: 21/40 · Mode: Read (orientation)

| Heuristic | Score | Note |
|---|---|---|
| Visibility of status | 2 | "Workspace now" figures repeat Home |
| Match with the real world | 2 | "Published lists", "schemas", "software vendor", "job title" — words the app no longer uses |
| User control | 3 | Every card is a link |
| Consistency | 1 | Marketing hero, eyebrow, own hex colours, rounded-3xl cards: nothing of the reference style |
| Error prevention | 1 | Two cards lead to pages that do not exist (404) |
| Recognition over recall | 3 | The colour key is the one thing people come back for |
| Flexibility | 2 | No way to jump to a part; 19 cards in a row |
| Minimalism | 2 | 19 identical cards, 10 role cards, counts ("7 areas") that help nobody |
| Error recovery | 2 | — |
| Help | 3 | It is the help page, but help is buried under a product tour |

## What works
- "What the colours say" (the key): complete, read from `rails.ts`, the reason people open this page.
- The roles, each with where approval sits, and the project's own marked.

## Problems
- **P0 Dead links.** "Submission pipeline" and "Review pipeline" (See the whole flow) open a page that does not exist.
- **P1 A landing page inside the app.** Dark hero with an eyebrow ("Product map"), a slogan, its own colours and shadow,
  "Return home", and four figures Home already shows. The reference style (plate, sheets, bands) is nowhere.
- **P1 Stale words and places.** "Settings → Published lists" (now Types & sets), "schemas", "not to the software vendor",
  "issued number ranges"; Numbering and Types & sets are the organization's now, the cards send to the project's pages.
- **P1 The identical card grid.** 19 cards, each icon tile + title + sentence + arrow; the menu already lists the same places.
- **P2 What people need is under the tour.** The colour key, the codes, the roles: help. The cards: a map. Mixed, neither is quick to find.
- **P2 Counts that help nobody** ("7 areas", "6 areas").
- **P3 "Signed in as …"** and "The map only shows…" say what the page already shows.

## Personas
- Someone new on a project: reads a slogan, then 19 cards; two lead nowhere.
- Someone checking what an amber line means: scrolls past the hero to find the key (it is the best part).
