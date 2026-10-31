---
target: "http://localhost:3080/organization/defaults"
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/user/Delios/frontend/app/(start)/organization/defaults/page.tsx"
target_fingerprint: "sha256:102d83c0422829f90b543b118a874eaf7e6fcc88e1bc846e7d14b66039401af1"
target_path: /home/user/Delios/frontend/app/(start)/organization/defaults/page.tsx
timestamp: 2026-10-23T11-30-25Z
slug: frontend-app-start-organization-defaults-page-tsx
---
Method: dual-agent, source only (app not runnable here; no browser overlay).

Score 21/40 (H1 2, H2 2, H3 2, H4 2, H5 1, H6 3, H7 2, H8 2, H9 3, H10 2).

Specificity: authored for DELIOS (domain words, reference style, "ours" marking); weakness is density and a second editing method beside the Control room. Detector: 0 findings (9 files, with and without config).

Priority issues:
1. [P1] Per-act dropdowns always live (components/how-it-works.tsx:241) but saved only when mode is CUSTOM (lib/settings/forms-how-it-works.ts:110): changes lost after "Saved". Fix: plain text unless "It depends", or switch to CUSTOM on change; note above the list.
2. [P1] Side panel says Manage confirmation "Not asked" (app/(start)/organization/defaults/page.tsx:97-101) but CONFIRM:PROJECT_PEOPLE defaults ON (lib/settings/control-activities.ts:426); note says marked "the app's", chips say "ours". Fix: read from effectiveAnswer.
3. [P1] "Make its choices the defaults" (page.tsx:72) no confirmation, drops edits, copies every project setting but PROJECT_INFO/CHECK_OFF (lib/organization/defaults.ts:26-30): may carry PARTY:<id>, stamp, SUPPLIER_INTAKE into every new project. Fix: ask first; whitelist the page's keys.
4. [P2] Two forms, two Saves, batch radios vs Control room Choice; unsaved edits in one form lost by the other's Save.
5. [P2] Start from a project / Reset hidden below xl and when no project is open.

Personas: first-time admin (acts unexplained, two vague modes, no link to may-change); power admin (no preview/undo, provenance blurred by Control room edits); screen reader (no legends, panel heads not headings, success not announced, chip inside switch label).

Minor: 10px stencils vs 11px rule; empty-state wording differs from Control room; recommended marker inconsistent; /settings/flow revalidated twice.

Questions: summary page with Choice-only edits? Compare before Start from a project? Reset keeping a copy?
