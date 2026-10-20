---
target: /settings/security
score: 23
target_identity: "file:/home/user/delios/frontend/app/(app)/settings/security/page.tsx"
target_fingerprint: "sha256:3fa286d371ffa1fe81f853a78d328412293d3b069d179b51eedcba0a08d04136"
target_path: /home/user/delios/frontend/app/(app)/settings/security/page.tsx
timestamp: 2026-10-20T15-06-44Z
slug: frontend-app-app-settings-security-page-tsx
---
# Critique: Sign-in & security (/settings/security)

**Score: 23/40.** The detector found nothing. The words are plain and the sheets follow the reference style. The problems: the page sits in the wrong place, two controls break the house rules, and one switch can be pressed when it can't work.

## Heuristics (0–4)
| # | Heuristic | Score | Why |
|---|---|---|---|
| 1 | Visibility of status | 3 | Chips say where each thing stands; 0 of 9 people with two-step is said |
| 2 | Match with the real world | 3 | Plain words; "OpenID Connect" and "issuer" are unavoidable for whoever sets it up |
| 3 | User control | 2 | "Require it for everyone" is a button, not a switch. No way to open a locked account by hand |
| 4 | Consistency | 2 | It is the organization's, but it opens in a project's Settings, with the project's menu and name above it. Two Save buttons in one sheet |
| 5 | Error prevention | 2 | "Everyone may sign in with a password" can be switched off when no organization account is set up, then refused. "In use" starts on before anything is filled |
| 6 | Recognition over recall | 2 | The return address is half given ("/api/auth/sso/callback on this site"); the person has to build the full address |
| 7 | Flexibility | 2 | Session lengths are fixed and only stated in the subtitle |
| 8 | Minimal design | 3 | Short sheets; "People with two-step sign-in" is an empty sheet when nobody has it |
| 9 | Error recovery | 2 | No way to try the organization account before turning it on for everyone |
| 10 | Help | 2 | Says what each does; doesn't say who still has to set two-step up before requiring it |

## P1: in the wrong place
- Sign-in is the organization's (CLAUDE.md: no switch, the organization's). The organization's Settings card links out to the project's page, so an administrator lands inside "Wastewater treatment works", with the project's menu.
- **Fix:** move it to the organization's Settings (`/organization/settings/security`), under its tabs, and send the old address there.

## P1: a switch that can't work
- "Everyone may sign in with a password" is on and can be switched off while the organization account is "Not set up". The backend refuses (SSO_NOT_CONFIGURED).
- **Fix:** read only until the account is in use, saying why on the line.
- "In use: offered on the sign-in page" starts ON for an account not set up yet. Start it off.

## P2: house rules
- "Require it for everyone" / "Stop requiring it" is an on/off: a switch (CLAUDE.md, "On/off is a switch").
- Password sign-in sits under the account's form, with its own Save, inside the same sheet: two Saves, unclear which saves what. One sheet each, or the switch acting at once.

## P2: the return address
- Show the full address (this site's origin + /api/auth/sso/callback) with a copy button.

## P3
- Requiring two-step: name who hasn't set it up yet (they will be asked at their next sign-in).
- A locked account: "Open it now" beside the person, instead of only waiting 15 minutes.
- "People with two-step sign-in": when nobody has it, say it on the two-step sheet, not as its own empty sheet.
- Session lengths: say them on their own line, not in the subtitle (or make them a setting, if wanted).
- Before "In use": "Try it" (sign in once with the provider) so a wrong address never reaches everyone.

## What works
- Plain words, short sheets, the reference bands.
- Turning two-step off for one person asks first and is logged.
- "Nobody is created by signing in" is said where it matters.

## Personas
- **Administrator setting up single sign-on:** opens Settings in a project, unsure if it changes only that project. Copies a half address. Turns "In use" on before testing.
- **Administrator answering "I lost my phone":** finds the person under "People with two-step sign-in" and turns it off. Good.
- **Someone locked out:** waits 15 minutes; nobody can open it for them.
