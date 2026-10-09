# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Document Control (primary).** Runs the register day to day: numbering, checks, transmittals, packages, uploads on a supplier's behalf, and the record of who did what.
- **Engineers and approvers.** Review and answer: give a verdict, comment, delegate, release.
- **Guests (suppliers, clients, partners).** Invited people who represent one organization on a project. They see only what concerns them: their own documents, packages and transmittals. Document Control grants upload and send rights; read-only stays read-only.
- **Admins.** Set the organization's policies (release mode, matrix strictness, stamps) and manage people.

## Product Purpose

An electronic document management system for engineering projects, built directly on the Document Management Standard v1 (Rules, Routes, Checks). It keeps the register, routes documents through review and release, sends them by transmittal and package, and checks the register for defects.

Success: people want to use it instead of working around it. Document Control trusts the register, and every action leaves a plain record of who did it and who answers for it.

## Positioning

The system is the Standard: the rules a system can enforce are enforced, the route checklists tick themselves as evidence is recorded, and the defect checks run against the live register. Unlike heavy EDMS tools, it guides and flags rather than forbids; unlike folder tools, nothing moves without a record.

## Operating Context

- Projects with our own documents and supplier documents; packages of documents delivered to or required from organizations.
- Work moves through review, verdict, release, issue, transmittal, package delivery and acceptance.
- Document Control often works outside the system too (checking supplier files externally, informing organizations of refusals), then records the result.
- Exports (CSV of the shown columns, review comments by revision) leave the system for reporting.

## Capabilities and Constraints

- Sold as a product to many engineering firms; each organization sets its own policies. Rules the product suggests are defaults, and organization preferences stay configurable.
- Default release mode: "Released & issued" in one act; admin may separate them.
- The approval matrix guides by default: people outside it are flagged, not forbidden. Admin may switch to strict.
- Delegation is always recorded as "X delegated to Y; X answers for it".
- Guests are scoped by tenancy to their own organization's material.
- Stack is Next.js, Prisma and SQLite (Postgres later), server-rendered.

## Brand Commitments

- Name: DELIOS (EDMS).
- Voice: plain words, short sentences. No jargon, and above all no corporate jargon. Standard references stay in the background, not in labels.

## Evidence on Hand

- The Standard and blueprint: `docs/DELIOS_EDMS_Functional_Product_Blueprint_v0.1.docx`, `docs/REVIEW-MODEL.md`, `docs/WALKTHROUGH.md`, `docs/ROLLOUT.md`.
- Demo project P1001 (`npm run demo`) with seeded walkthrough data.
- No customers, testimonials or benchmarks yet; do not invent them.

## Product Principles

1. **Wanted, not evaded.** If people would work around a screen, the screen is wrong. Never heavy like Aconex.
2. **Rules with a record, never loose.** Every step leaves evidence; never a bare folder store like SharePoint.
3. **Flag, don't forbid.** Guide people to the rule and record departures; the organization chooses when to be strict.
4. **The organization decides.** Defaults are recommendations; policies stay switchable by admin.
5. **Plain words.** Say what happens and who does it. No jargon.
