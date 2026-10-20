---
target: How this project works (/settings/control)
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/user/delios/frontend/app/(app)/settings/control/page.tsx"
target_fingerprint: "sha256:00eed84bd07ab460d17aa2bc9971ce6629440b02127ead99075e8eb50ff3d1fe"
target_path: /home/user/delios/frontend/app/(app)/settings/control/page.tsx
timestamp: 2026-10-20T00-03-37Z
slug: frontend-app-app-settings-control-page-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Unsaved choice not marked; another sheet's Save drops it |
| 2 | Match with the real world | 3 | "Acts that stay where they are", long policy sentences |
| 3 | User control and freedom | 2 | Policies saved with no confirmation; only undo is reset of everything |
| 4 | Consistency and standards | 1 | Not the Control room's Choice; "this project only" yet state names are the organization's |
| 5 | Error prevention | 2 | Per-act selects live though ignored outside CUSTOM; locked "At risk from" shows no lock |
| 6 | Recognition rather than recall | 2 | ~5,000px (8,800 phone), no contents despite anchors |
| 7 | Flexibility and efficiency | 2 | No "only what differs", no jump links |
| 8 | Aesthetic and minimalist design | 2 | Six Save buttons; 3-4 lines per act |
| 9 | Error recovery | 3 | Non-admin refused only at "Save names" |
| 10 | Help and documentation | 3 | Thorough but all inline |
| **Total** | | **22/40** | |

## Design Specificity Verdict
House style right, but a long form: 7 sheets, 6 Saves; three answer methods (radio cards bulk-saved, select + generic confirm, plain inputs) instead of the Control room's one Choice method.
Detector: CLI 0 findings; browser 24 (10 tiny-text 11px allowed; 6 shell; real: 10px `.stencil` headings + "Named on P1001" (globals.css:219), "Find someone" placeholder 2.6:1). No overflow at 390; controls 32px; names present.

## Priority Issues
1. [P1] Not Choice; six forms (how-it-works.tsx:249,285-297,335-363; project-settings.tsx:167). Fix: Choice per answer, saved one by one; switches for stamps.
2. [P1] State names organization's but page says project only; non-admin refused at save (project-settings.tsx:201-231; forms-how-it-works.ts:211). Fix: text + lock for non-admins, or move to organization.
3. [P2] Decided vs inferred (how-it-works.tsx:191; control-activities.ts:423-426; footer :328). Fix: select nothing when unset; acts only under "it depends".
4. [P2] No way to find one answer. Fix: sticky contents with "changed here" counts; "only what differs" toggle.
5. [P3] "At risk from" lock; "Acts that stay where they are" footnote; stale comment page.tsx:22-26.

## Persona Red Flags
- Control function: 5,000px scroll; stamp lost silently; refused at Save names.
- First-time administrator: "not answered yet" with answer chosen; ~15 decisions; reset-all only exit.
- Engineer read-only: no "changed here" in read-only.

## Minor Observations
Missing route verdict sets and intake exception; stacked mode cards vs two-up options; stamp colours described not shown.

## Questions to Consider
- Turn the page into a ledger (answer, source, who/when, change in place)?
- Show per-act rows only under "it depends"?
- State names on a project page at all?
