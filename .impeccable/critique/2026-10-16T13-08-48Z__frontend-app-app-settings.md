---
target: every card page in settings
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 14
p1_count: 25
target_identity: "file:/home/user/delios/frontend/app/(app)/settings"
timestamp: 2026-10-16T13-08-48Z
slug: frontend-app-app-settings
---
Method: multi-agent (4 page reviewers + detector). Browser skipped: app not running here. Detector: 0 findings.
Scores /40: Projects 21, Organizations 18, The plan 15, People 22, Lists 17, Families 12, Forms & fields 18, Numbering 21, Revisions 27, Verdict lists 29, Review routes 22, Control room 23, Functions 19, Security 27, Audit 21. Average ~21.
Cross-cutting P0: hub says "changes this project only" but lists, functions, numbering, revision schemes, routes, verdict lists, security, state names, scope are organization-wide in the backend.
P0s: route outside-party step has no reason for issue (STEP_NEEDS_REASON) and save wipes it; lists page wipes CONTROL_OUTCOMES/second verdict list props (isVerdictSet regex); comment class prop name progressionPreventing vs blocking; missing value questions (status update, confidentiality restricted/level, retention default, deliverable type required, reason executes, decision proceeds, outcome act/to/newRevision); Delete set retires essential lists; Families describes a mechanism nothing reads; Organizations save fails for Document Control (org setting); plan scope form has no effect and overwrites SCOPE; Functions grid toggle can grant when it says remove; ROUTES/MATRIX verbs refused by backend; Control room switches never read (REVIEW_ISSUE, ISSUE, AUTHORIZE_REVISION, POLICY_READY); audit kinds mostly old act names.
P1s (sample): route step modes that don't exist; "Offer this route first" wrong; route permissions mismatch; From which organization uses SUPPLIER_CODES; numbering list sources refused; no fixed text/sender/receiver parts; In use untick no confirm; Forms & fields switches that block every registration/transmittal; stale form descriptions; People: guests list stub, no take off project, no department on add, guest form offers collaborators; Projects: no time zone/weekend days/role edit, creation not atomic, carry over copies guests; plan: schedule/last run/exceptions hard-coded empty; risk window/lead days no screen; SSO/password sign-in no screen; audit org-wide, filter on newest 200.
