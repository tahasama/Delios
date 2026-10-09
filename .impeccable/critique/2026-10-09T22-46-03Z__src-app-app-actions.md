---
target: schedule/actions
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/home/user/delios/src/app/(app)/actions"
timestamp: 2026-10-09T22-46-03Z
slug: src-app-app-actions
---
Method: dual-agent (A: a4fd32568871ab013 · B: aae923d625da6c096). Browser skipped: app cannot run here.

Score 25/40 (Acceptable). H1 3, H2 3, H3 3, H4 1, H5 2, H6 3, H7 3, H8 2, H9 2, H10 3.

Specificity: schedule + activity page authored for DELIOS (house sheet, legend-as-filter, What happened vs State). Requirements + Schedule versions are generic SaaS cards (Card/PageHeader, shadows, icon tiles, 5-tile grid).
Detector: 2 gray-on-color in schedules/[id]/page.tsx:91,96, both false positives (one-line lookup maps). Shared components clean.

Priority issues
[P0] Activity page state contradicts schedule: [code]/page.tsx:75-79 has no UPCOMING, every short future action = At risk. Fix: one shared state function; add UPCOMING to ReadinessChip. /impeccable harden
[P1] Plan empty state missing; undated actions vanish silently (plan-timeline.tsx:140). Fix: reuse table empty block; footer "N have no date". /impeccable harden
[P1] Requirements + Schedule versions off house style. Fix: register-sheet, plate, stencil bars; metrics as one meta line. /impeccable layout
[P2] Discipline confirm: untick = "Not available" silently; Notify on each row sends to all. Fix: two explicit choices, note required on Not available; per-discipline notify. /impeccable clarify
[P2] Setup upload links lead the schedule for everyone; draftCount hard-coded 0 (page.tsx:207); Requirements unreachable from schedule. Fix: permission-gate, quiet line in plate, links to Requirements + Earlier schedules. /impeccable distill

Personas: Alex – Apply vs live filters inconsistent. Sam – timeline bars colour-only, placeholder-as-label filters, done/ready by shade. DC lead – no count of "needs a note"; departments vs disciplines; "Call"; lecturing copy.
Minor: duplicate comments, today marker reuses overdue red, raw enum chips, search placeholder is a syntax lesson, "Carried out" vs "Happened without…" two names.
