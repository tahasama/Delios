---
target: "http://localhost:3080/import"
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/user/delios/frontend/app/(app)/import"
timestamp: 2026-10-15T15-32-15Z
slug: frontend-app-app-import
---
# Critique: Import & export (/import)
Method: dual-agent (A: design review · B: detector + browser)

## Nielsen scores: 23/40 (acceptable, needs work)
1 Status 2 · 2 Real world 2 · 3 Control 2 · 4 Consistency 1 · 5 Error prevention 2 · 6 Recognition 3 · 7 Efficiency 3 · 8 Minimalist 3 · 9 Recovery 2 · 10 Help 3

## Specificity
The thinking is DELIOS (four import kinds, a template per kind, check before writing, file kept between passes). The look is generic: titled Cards, rounded-xl tiles, raw Chips, no masthead plate, no sheets, no ToneChip/ActionForm. Off DETAIL-STYLE.
Detector: 0 findings in source. Live: 4 on the page (card titles and description 4.39:1, 10px card titles from the shared Card; the columns hint text-[11px] text-slate-400 at 2.5:1, bulk-import-form.tsx:95; a 124-char line at :94). 6 more are on the app shell, every page (sidebar, search placeholder, red 9+ badge).

## Priority issues
- [P1] The import is committed by unticking "Dry run" and pressing "Check file"; good rows are written and bad rows silently left out. Fix: always check first, then one act with the count ("Register 41 documents, leave out 3"), confirm when anything is left out.
- [P1] Line numbers are wrong for the workbook (line = i + 2 over all sheets flattened, ignoring the caption row and skipped rows). Fix: "Sheet DS, row 12"; download the rows with problems.
- [P1] Team list first passwords exist only in the on-screen report; refresh and they are gone. Fix: send invitations (sign-up / reset exist), or at least a report download and a leave warning.
- [P2] The held file carries across kinds; the field says "No file chosen" while the text says "Holding people.csv"; matrix and lists refuse CSV though the label offers it. Fix: clear on change of kind, show the held file with Remove, formats per kind.
- [P2] Off house style and voice: Cards → sheets with stencil heads and a plate; ToneChip; rounded-md ring-line; copy ("Will create placeholder: ENG/DS/ME" → what is registered; "not published/active" → which list; "Latest conformance results" → Assurance; title "Bulk import & export" vs menu "Import & export").

## Persona red flags
- Document Control, 400 documents: wrong lines, no failed-rows file, no "good rows only" with count, no link to the register filtered to what was imported, "Working…" only, audit export cut at 5000 silently.
- First-time admin: jargon (published list, party code, matrix letters), no order said (lists → team → matrix → deliverables), "Administrators only" only inside the matrix explainer.
- Engineer by URL: refusal speaks of "classification" and "document" on a page about neither.

## Minor
Matrix dry run shows green "nothing would change" above "1 with problems". Blank rows reported with three errors. Counts by colour only. Report table toolbar clutter. "Back to register" odd from Settings. Export: 7 ungrouped links.

## Questions
Should export live on each register it copies, leaving this page one job? Does Team list honour "People to confirm"? If checking is always recommended, why optional?
