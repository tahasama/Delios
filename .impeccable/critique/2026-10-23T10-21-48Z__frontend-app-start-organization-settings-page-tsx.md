---
target: "http://localhost:3080/organization/settings"
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/user/Delios/frontend/app/(start)/organization/settings/page.tsx"
target_fingerprint: "sha256:42711e3cd1981102548f8ac91c9473f3cc20fe9bbe4aa8a5c5519dde3c99ac66"
target_path: /home/user/Delios/frontend/app/(start)/organization/settings/page.tsx
timestamp: 2026-10-23T10-21-48Z
slug: frontend-app-start-organization-settings-page-tsx
---
Method: dual-agent, source only (app not runnable here: docker build has no network; no browser overlay).

Score 24/40 (H1 2, H2 3, H3 2, H4 2, H5 2, H6 3, H7 2, H8 3, H9 2, H10 3).

Specificity: navy Control room deck and Fixed/Free/own-copy wording are DELIOS's own; card grid generic, lacks the project hub's figures, amber To do and setup Tip. Detector: 0 findings (19 files + shared imports).

Priority issues:
1. [P1] Backend failure reads as false facts: every reader catches to [] (lib/organization/liberty.ts:15, lib/settings/api-admin.ts); no loading.tsx / error.tsx under (start)/organization/settings. Fix: separate failed from empty, error message in the plate, loading state.
2. [P1] Free/Fixed switch acts on one click, emerald when Free (switches.tsx:33-37, components/switch.tsx). Fix: Choice-style "From now on… Instead of…" at least for Fixed-by-default switches; owner question on green for Free.
3. [P1] "Their own copy" counts project-card pairs, misses function copies (page.tsx:29-30). Fix: distinct projects incl. functionCopies; "n with their own" on Functions card.
4. [P2] No setup order Tip or amber To do at organization level. Fix: port from (app)/settings/page.tsx.
5. [P2] Misplaced/duplicated signals: deck's "Who does what" shows defaults' date; BadgeCheck on Identity and Functions; States uses Types icon; Audit trail card leaves the org shell (/settings/audit).

Personas: first-time admin (no start point, "Fixed · all 3" unclear, deck vs Defaults card); Document Control lead (no cross-card view of diverging projects, wrong count); screen-reader/keyboard (no focus-visible on cards page.tsx:136; switch aria-label names the act; org-header.tsx:16 text-slate-400 11px ~2.6:1).

Minor: "1 settings" plural (page.tsx:63,68); chip whitespace-nowrap may overflow; plate-name vs plate-title mixed; empty TODAY map in [slug]/page.tsx:10.

Questions: Defaults card vs Control room difference on screen? Should freeing Numbering weigh as much as a reset? Liberty page or setup page?
