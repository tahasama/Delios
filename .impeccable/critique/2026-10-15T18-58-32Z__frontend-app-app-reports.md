---
target: "http://localhost:3080/reports"
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/home/user/delios/frontend/app/(app)/reports"
timestamp: 2026-10-15T18-58-32Z
slug: frontend-app-app-reports
---
# Critique: Reports (/reports)
Method: dual-agent (A: design review · B: detector + browser)

## Nielsen scores: 20/40
1 Status 2 · 2 Real world 3 · 3 Control 2 · 4 Consistency 1 · 5 Error prevention 2 · 6 Recognition 2 · 7 Efficiency 2 · 8 Minimalist 3 · 9 Recovery 1 · 10 Help 2

## Specificity
Generic admin dashboard (PageHeader + Card + pill tabs + KPI tiles + stacked bars), not the house look. Detector: 0 in source; live, page-specific: white 10px numbers on bar colours 1.5-2.7:1 (both themes), filter placeholder and "Pick a date" 2.6:1, inactive tab 4.3:1, filter and date inputs without labels, figure tiles flagged as nested cards. Shared Card: 10px title, 11px description.

## Priority issues
- [P0] "Register on a past date" always answers "Nothing was current on that date" (page.tsx:33, historical always []): a false answer to an audit question.
- [P1] Reports hidden from managers: menu needs Control (navigation.tsx:94); backend lets any internal reader.
- [P1] Four of five reports replace their rows with a paragraph sending you elsewhere; bars cannot be clicked.
- [P2] Filter says it filters the chart; it does not. Enter only, no clear, own control size, placeholder cut.
- [P2] Not the house look; white numbers on bars unreadable; ISO dates; tab names differ from titles; countedAt not shown.

## Personas
Document Control: two downloads with unclear scope, no Excel, fixed windows, "0.0 d" turnaround. Manager: cannot find it, action codes without names, no trend. Supplier: raw 404.

## Questions
Should each chart live on top of its own working list? Who takes this to the weekly meeting? Should suppliers get their own deliveries view?
