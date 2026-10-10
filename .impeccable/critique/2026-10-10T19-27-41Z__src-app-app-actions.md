---
target: "http://localhost:3000/actions"
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/user/delios/src/app/(app)/actions"
timestamp: 2026-10-10T19-27-41Z
slug: src-app-app-actions
closed: true
---
Method: dual-agent. Browser skipped: the app cannot run here (localhost:3000 is the owner's machine).

Score 27/40 (Acceptable, unchanged). H1 3, H2 3, H3 3, H4 2, H5 2, H6 3, H7 2, H8 3, H9 3, H10 3.

Fixed: undated always counted; header (in-force date, reader-aware, failed-read warning); colours; 25-step; no-note count; overflow count.
Detector: clean on all 13 files and shared next-step/timeline; verified with --no-config and a seeded bad file.

Priority issues
[P1] "On the day" filter (happened) never added to the shared query (page.tsx:251-267): lost on sort, paging, load more, key, window toggle, export. Fix: query.set("happened"). /impeccable harden
[P1] "No note" count is whole-schedule; its link opens the windowed plan and drops filters. Fix: link with all=1, or count in the same scope. /impeccable clarify
[P2] Regression: Apply stays lit after a dropdown choice (dirty set by form onChange, reset only on q/dates); dropdowns submit on every arrow key (WCAG 3.2.2). Fix: dirty from search/date input only; select submits on change for pointer, on blur for keyboard. /impeccable polish
[P2] Undated actions hard to reach: "in the table" opens page 1 with undated last; empty state says "nothing matches" beside "N with no date". Fix: a No date filter; copy "Nothing dated in these days." /impeccable harden
[P3] Failed-read warning says "dates shown are still the ones before it" when there is no earlier read. Fix: branch on inForce. /impeccable clarify

Personas: Alex - no shortcuts, filter lost on sort/load more. Sam - arrow keys submit, small key chips, bar aria reads empty date when no first-needed date, upload buttons lack aria-controls. DC lead - no-note count changes after click, "and N more" not a link, upload panels do not say when a manual upload is needed now that release reads automatically.
Minor: "(what changed)" opens version list, ready bar amber for 1/20 and 19/20, timeline grid lines still key by label, "Every date in the schedule" shown for custom ranges, success link missing when placeholders registered.
