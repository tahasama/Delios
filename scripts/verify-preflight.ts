// Phase 4 exit criterion: every act states, before it is attempted, whether it
// is allowed — and the act itself refuses with exactly the same words.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { loadActor } from "../src/lib/permissions";
import { gatesFor, summarise, INTENTS, INTENT_VERB, allGates, type GateContext, type GateLine, type Intent, type Subject } from "../src/lib/rules/registry";
import "../src/lib/rules/gates";

const db = new PrismaClient();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/**
 * The gate half of preflight, without the request context. `preflight()` itself
 * imports `server-only`, so this exercises the same gates through the same
 * registry with a hand-built context.
 */
async function run(ctx: GateContext, intent: Intent, subject: Subject) {
  const lines: GateLine[] = [];
  for (const gate of gatesFor(intent)) {
    const outcome = await gate.evaluate(ctx, subject);
    lines.push({ id: gate.id, title: gate.title, clause: gate.clause, ...outcome });
  }
  return summarise(intent, lines);
}

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const p1 = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1" } });
  const t = tenantFor(org.id, p1.id);

  const adminUser = await db.user.findFirstOrThrow({ where: { orgId: org.id, email: "admin@delios.local" } });
  const adminFn = await db.function.findFirstOrThrow({ where: { orgId: org.id, code: "ADMIN" } });
  const actor = await loadActor(t, adminFn.id);

  const ctx: GateContext = {
    ...t,
    user: { ...adminUser, role: "ADMIN" } as never,
    can: () => true,
    why: () => "permitted",
  };

  console.log("\nEvery gate is well formed\n");
  for (const gate of allGates()) {
    check(`${gate.id} declares title and clause`, !!gate.title && !!gate.clause, gate.clause);
  }
  check("every intent has a verb", INTENTS.every((i) => !!INTENT_VERB[i]));
  check("actor loaded", !!actor);

  // ── Release, the act with the most conditions ───────────────────────────
  console.log("\nRelease checklist reflects the register (§7.5)\n");

  const released = await t.db.revision.findFirst({ where: { state: "RELEASED" }, include: { document: true } });
  const inPrep = await t.db.revision.findFirst({ where: { state: "IN_PREPARATION" }, include: { document: true } });

  if (released) {
    const r = await run(ctx, "RELEASE", { revisionId: released.id, statusCode: "IFC" });
    check("an already-released revision is blocked", !r.ok, r.blocked.map((b) => b.id).join(", "));
    check("the block names its clause", r.blocked.every((b) => b.clause.includes("§")));
    check("every blocked line carries a remedy", r.blocked.every((b) => !!b.remedy));
  }

  if (inPrep) {
    const r = await run(ctx, "RELEASE", { revisionId: inPrep.id, statusCode: "IFC" });
    check("a revision with no approval is blocked", r.blocked.some((b) => b.id === "REL-APPROVAL"),
      r.blocked.map((b) => b.id).join(", "));
    check("the summary is one readable sentence", r.summary.length > 10 && r.summary.length < 200, r.summary);

    const bad = await run(ctx, "RELEASE", { revisionId: inPrep.id, statusCode: "NOT_A_STATUS" });
    check("an unpublished status is blocked", bad.blocked.some((b) => b.id === "REL-STATUS"));

    const none = await run(ctx, "RELEASE", { revisionId: inPrep.id });
    check("no status chosen is a warning, not a block", none.warnings.some((w) => w.id === "REL-STATUS"));
  }

  // ── Approve ─────────────────────────────────────────────────────────────
  console.log("\nApproval checklist (Part 8)\n");
  if (inPrep) {
    const r = await run(ctx, "APPROVE", { revisionId: inPrep.id });
    check("approving a revision not in review is blocked", r.blocked.some((b) => b.id === "APP-STATE"));
  }
  const inReview = await t.db.revision.findFirst({ where: { state: "IN_REVIEW" }, include: { document: true } });
  if (inReview) {
    const r = await run(ctx, "APPROVE", { revisionId: inReview.id });
    check("a revision in review passes the state gate", !r.blocked.some((b) => b.id === "APP-STATE"),
      r.blocked.map((b) => b.id).join(", ") || "nothing blocked");
  }

  // ── A missing subject never reads as permission ─────────────────────────
  console.log("\nAn unanswerable question is never a yes\n");
  for (const intent of ["RELEASE", "APPROVE", "SUBMIT_FOR_REVIEW", "VOID"] as Intent[]) {
    const r = await run(ctx, intent, {});
    check(`${intent} with no subject is blocked`, !r.ok);
  }

  // ── Warnings do not block ───────────────────────────────────────────────
  console.log("\nWarnings inform, they do not stop\n");
  const anyDoc = await t.db.document.findFirst({ where: { state: "ACTIVE" } });
  if (anyDoc) {
    const r = await run(ctx, "WITHDRAW", { documentId: anyDoc.id });
    check("withdraw returns a verdict", r.blocked.length + r.warnings.length + r.passed.length > 0);
    check("a warning alone leaves it allowed", r.warnings.length === 0 || r.ok,
      `${r.warnings.length} warning(s), ok=${r.ok}`);
  }

  // ── Create, which depends on published configuration ────────────────────
  console.log("\nCreation depends on published configuration (§1.3)\n");
  const created = await run(ctx, "CREATE_DOCUMENT", {});
  check("with value sets published, creation is allowed", created.ok, created.summary);

  // ── The intents wired in the second pass ────────────────────────────────
  console.log("\nReview outcome (Part 9)\n");
  const openCycle = await t.db.reviewCycle.findFirst({ where: { status: "OPEN", outcome: null } });
  const decided = await t.db.reviewCycle.findFirst({ where: { outcome: { not: null } } });

  if (decided) {
    const r = await run(ctx, "RECORD_OUTCOME", { cycleId: decided.id, outcomeCode: "C1" });
    check("a cycle that already has an outcome is blocked", r.blocked.some((b) => b.id === "OUT-OPEN"),
      "one outcome per cycle (§9.4)");
  }
  if (openCycle) {
    const bad = await run(ctx, "RECORD_OUTCOME", { cycleId: openCycle.id, outcomeCode: "NOPE" });
    check("an unpublished outcome code is blocked", bad.blocked.some((b) => b.id === "OUT-SET"));
    const none = await run(ctx, "RECORD_OUTCOME", { cycleId: openCycle.id });
    check("no outcome chosen is a warning, not a block", none.warnings.some((w) => w.id === "OUT-SET"));
  }

  console.log("\nStart a revision (Part 6)\n");
  const withOpen = await t.db.revision.findFirst({ where: { state: { in: ["IN_PREPARATION", "IN_REVIEW"] } } });
  if (withOpen) {
    const r = await run(ctx, "CREATE_REVISION", { documentId: withOpen.documentId });
    check("a document with a revision in flight is blocked", r.blocked.some((b) => b.id === "REV-OPEN"),
      r.blocked.map((b) => b.id).join(", "));
  }
  const ended = await t.db.document.findFirst({ where: { state: { in: ["WITHDRAWN", "CANCELLED", "ARCHIVED"] } } });
  if (ended) {
    const r = await run(ctx, "CREATE_REVISION", { documentId: ended.id });
    check("a document in an end state is blocked", r.blocked.some((b) => b.id === "REV-DOC-STATE"));
  }

  console.log("\nTransmittals (Part 11)\n");
  const draft = await t.db.transmittal.findFirst({ where: { status: "DRAFT" } });
  const issuedT = await t.db.transmittal.findFirst({ where: { status: "ISSUED" } });
  if (draft) {
    const r = await run(ctx, "ACCEPT_TRANSMITTAL", { transmittalId: draft.id });
    check("a draft cannot be accepted", r.blocked.some((b) => b.id === "ACC-ISSUED"));
  }
  if (issuedT) {
    const r = await run(ctx, "ACCEPT_TRANSMITTAL", { transmittalId: issuedT.id });
    check("an issued transmittal can be accepted", !r.blocked.some((b) => b.id === "ACC-ISSUED"));
  }
  // A letter — words, no documents — goes out; a transmittal empty of both
  // does not. Both are made here and removed again, so the check never
  // depends on what the demo happens to hold.
  const shape = { projectId: p1.id, direction: "OUTGOING", reasonForIssue: "INFORMATION", dateOfIssue: new Date(), issuingParty: "Us", status: "DRAFT", createdById: adminUser.id, createdByName: adminUser.name };
  const letter = await db.transmittal.create({ data: { ...shape, number: `VERIFY-LETTER-${Date.now()}`, subject: "A clarification", message: "Words only." } });
  const blank = await db.transmittal.create({ data: { ...shape, number: `VERIFY-BLANK-${Date.now()}` } });
  try {
    const l = await run(ctx, "ISSUE", { transmittalId: letter.id });
    check("a letter with no documents may be issued", !l.blocked.some((b) => b.id === "ISS-ITEMS"));
    const e = await run(ctx, "ISSUE", { transmittalId: blank.id });
    check("a transmittal with no documents and no words is blocked", e.blocked.some((b) => b.id === "ISS-ITEMS"));
  } finally {
    await db.transmittal.deleteMany({ where: { id: { in: [letter.id, blank.id] } } });
  }

  console.log("\nEvery intent now has at least one gate\n");
  for (const intent of INTENTS) {
    check(`${intent} has gates`, gatesFor(intent).length > 0, `${gatesFor(intent).length}`);
  }

  console.log(failures === 0 ? "\nAll preflight checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
