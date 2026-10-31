---
target: side menu and top bar
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/user/Delios/frontend/app/(app)/navigation.tsx"
target_fingerprint: "sha256:a40fe34c061f286f1d31bc2268d6acf347ec9fb265f25d07980a61ed528ccb82"
target_path: /home/user/Delios/frontend/app/(app)/navigation.tsx
timestamp: 2026-10-27T05-53-31Z
slug: frontend-app-app-navigation-tsx
---
# Critique: side menu and top bar (app shell)
Method: dual-agent. App not runnable here: judged from source and the owner's screenshot. Detector: clean (0 findings, 5 files). Browser overlay skipped (needs backend).

Score 25/40. 1:3 2:3 3:2 4:2 5:3 6:2 7:2 8:3 9:2 10:3

P1 Project line: "we are <role>" is the owning organization's role, wrong for guests; subline shows org name with one project, code with several; function shown twice (project line and avatar).
P1 Account menu, project switcher and mobile drawer do not close on navigation, Escape or outside click.
P2 Top-right tools: order mixes rare (theme) with frequent (notifications); Help duplicated in account menu; 36px vs the locked 32px control height; hex colours.
P2 "More": folded it is an unlabelled dash, re-closes on every return to a main page, low-contrast label and count; separator takes a row.
P2 Long project names squeeze the search; project list has no max height; no search on mobile.
Owner points: function beside the role, the initial disc, the gold active tile, the More row, icon order.
