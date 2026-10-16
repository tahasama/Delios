---
target: "http://localhost:3080/settings"
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
target_identity: "file:/home/user/delios/frontend/app/(app)/settings/page.tsx"
target_fingerprint: "sha256:190fa839de6282c5f31f957f293a306bcc3b6ca1c20764168241bbaa29dd0b10"
target_path: /home/user/delios/frontend/app/(app)/settings/page.tsx
timestamp: 2026-10-16T11-41-50Z
slug: frontend-app-app-settings-page-tsx
---
Method: dual-agent (A design review, B detector). Browser view skipped: app not running here.
Score 22/40 (1:2 2:2 3:3 4:1 5:3 6:2 7:2 8:2 9:2 10:3).
Priority issues
- [P0] People & access: admin sets someone's password (users/page.tsx:82,107), breaking "never a password chosen by someone else". Fix: invite link only.
- [P1] Settings link vs pages: Matrix holder gets the link and a red "Administrators only" dead end; Control-only / Manage-only holders reach pages but get no link (layout.tsx:28). Fix: derive from SETUP_PAGES + maySetup; neutral no-access line.
- [P1] No setup order, no readiness; several hub figures are words; Verdict lists, Revisions, Security have no figure. Fix: Tip with numbered steps from The plan; real counts; attention tone.
- [P2] Three styles (Card/rounded vs sheet plate vs Control room); group icons tinted with state colours; controls sized on the page (act-switch.tsx:68, set-nav.tsx:47, numbering-scheme-builder.tsx:29,33, functions/page.tsx:223,230, workflow-template-builder.tsx:226); numbering builder overflows at 375px (numbering-scheme-builder.tsx:34); icon-only buttons unnamed (numbering-scheme-builder.tsx:38).
- [P2] Words: hub subtitle says "for the organization" against the rule; "value set", "UPPER_SNAKE", "Properties (JSON)", "Route it" on Numbering; "Parties", "The log"; "Controlled changes" still mentioned (dmp/page.tsx:122).
Minor: bulk Delete without confirm; permission tick changes for all, no confirm; 10px text in 14 places; slate-400 contrast; "Used on" always empty; crumb shows raw segment; Control room "change" links redirect back to the top.
