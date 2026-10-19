---
target: Forms & fields (/settings/fields)
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/user/delios/frontend/app/(app)/settings/fields/page.tsx"
target_fingerprint: "sha256:5f4263c76441e6241c1969cb54fb3ea9d2dbe0200b090b47df88f01186ccb101"
target_path: /home/user/delios/frontend/app/(app)/settings/fields/page.tsx
timestamp: 2026-10-19T23-50-36Z
slug: frontend-app-app-settings-fields-page-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Must/Asked/Not asked saves at once with no saved sign; own copy vs organization's is a grey sentence |
| 2 | Match with the real world | 3 | Raw `SUPPLIER_CODES` on the Supplier row; a few jargon slips |
| 3 | User control and freedom | 2 | First click on a project silently copies the whole form; only an administrator undoes it |
| 4 | Consistency and standards | 2 | Choice bar ~40px against 2rem everywhere else |
| 5 | Error prevention | 2 | No "From now on… Instead of…" before the copy; turning off criticality says nothing of what follows |
| 6 | Recognition rather than recall | 3 | Renamed field shows no original name |
| 7 | Flexibility and efficiency | 2 | One reload per click; no comparison with the organization's |
| 8 | Aesthetic and minimalist design | 2 | "Always asked" twice on fixed rows; five fixed rows first |
| 9 | Error recovery | 2 | A refused click on the bar has nowhere to show why |
| 10 | Help and documentation | 3 | Good explanations; "Add a field" is a bare + |
| **Total** | | **23/40** | |

## Design Specificity Verdict
Mostly authored for this product (three answers per field, domain-specific reasons); layout is a generic menu + table board; ownership and click consequence left as grey text.
Detector: CLI 0 findings; browser overlay 40 (31 tiny-text 11-11.5px allowed by project rule, 7 low-contrast mostly in shell, 4 undersized: 10px `.stencil` table headers = real breach, shared style). 390px: page 22px wider than screen (fields table, board.tsx:139).

## Priority Issues
1. [P1] One click copies the form on a project with no warning (board.tsx:230-238; status at :136/:143; menu :126-127). Fix: Choice-style confirm on first change; ToneChip for where it stands; mark own forms in menu.
2. [P1] Phone breaks, bar wrong height (.seg globals.css:537-559). Fix: 2rem segment; stack rows below md; explanation under h2.
3. [P2] Repeated/raw text: "Always asked" twice (board.tsx:215,228); SUPPLIER_CODES fallback (board.tsx:84); Supplier row contradicts "always". 
4. [P2] Choice bar a11y/reading: aria-current="page"+disabled (board.tsx:233); Must=Asked look; dead bars for read-only; no consequence for turning off criticality.
5. [P3] Rename row loses context (board.tsx:193-206); no renamed mark.

## Persona Red Flags
- Document Control power user: 12 clicks = 12 reloads, no diff with organization's, raw key.
- First-time administrator: switch below 1100px board; bare +.
- Project control function: can't see own forms; one click forks; dead bars when fixed.

## Minor Observations
Review-only empty text on every form; Answer column hidden on phone; "Not asked at all" offered when adding; greyed "Which list".

## Questions to Consider
- Should taking the project's own form be one click?
- Fold the five fixed fields into one line?
- Per-field fixed/free instead of one switch for all forms?
