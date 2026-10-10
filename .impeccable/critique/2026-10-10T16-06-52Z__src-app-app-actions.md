---
target: "http://localhost:3000/actions"
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/user/delios/src/app/(app)/actions"
timestamp: 2026-10-10T16-06-52Z
slug: src-app-app-actions
---
Method: dual-agent. Browser skipped: the app cannot run here (localhost:3000 is the owner's machine).

Score 27/40 (Acceptable, up from 25). H1 3, H2 3, H3 3, H4 2, H5 3, H6 3, H7 3, H8 2, H9 2, H10 3.

Specificity: authored for DELIOS (house sheet, legend-as-filter, bar from first document needed to the work, "what happened on the day" vs "ready", upload tied to a released revision). Still generic: two big view tabs, a row of seven identical dropdowns.
Detector: clean (exit 0) on all 13 files and the shared next-step/timeline. No false positives.

Fixed since 9 Oct: one shared state (Still ahead), plan empty state, house style on version pages, two-choice discipline confirm with per-discipline notify, today marker colour.

Priority issues
[P1] Undated actions vanish from the default plan (page.tsx:126-127, 316): they count as "outside these days"; "N with no date" only shows under every date. Fix: count separately, always show "N with no date - in the table". /impeccable harden
[P1] No path from an upload to its result: Schedule versions (failed reads, moved dates) unreachable from this page. Fix: link "rev X" in the summary line, "see what changed" in the upload success, failed read as a warning in the plate. /impeccable clarify
[P2] Filters behave two ways: dropdowns wait for Apply; key, rows, step act at once; Apply lit when filters exist, not when changed (plan-register.tsx:249). Fix: submit on change. /impeccable polish
[P2] Plate wrong for most readers: "upload it below" shown to people with no upload buttons; in-force date never shown (plan-plate.tsx:14-16). Fix: "Dates in force since {date}"; "Document Control uploads it" for others. /impeccable clarify
[P3] State colours: Done and Ready share a row colour; grey "nothing listed" has no key entry. /impeccable colorize

Cognitive load: 4 failures (chunking - 8 filters; competing elements above the answer; >4 options: state 7, key 6, step 5, columns 10; key out of view while scrolling).
Personas: Alex - plan loads 5 at a time by default, no view shortcut, search syntax only in placeholder. Sam - dropdowns labelled by first option, work block title-only, Pin and remove-filter title-only, "1/2/3" digits read out. DC lead - no count of "went ahead with no note", untagged list capped at 6 with a dead "...", "I take responsibility" reads legal.
Minor: timeline tick keys can collide, 0% ready shows a red sliver, plan empty "Clear filters" drops view, DPA panel says "project manager".
