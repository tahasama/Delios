// Released and issued are one act.
//
// A revision is either not released, or released and issued. This walks the
// three ways that rule is met or refused, against a throwaway document so the
// register is left as it was:
//
//   1 · no issuance named            → release is refused, and says why
//   2 · recipients named             → release publishes and sends, in one act
//   3 · an outside party must approve → release waits for them; their answer
//                                       releases and issues it, or sends it back
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { releaseRevision, recordReviewOutcome, openReviewCycle, issueToReview } from "../src/lib/lifecycle";
import { pendingIssue, settleApproval } from "../src/lib/issue-requests";
import type { SessionUser } from "../src/lib/auth";

const db = new PrismaClient();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const project = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1" } });
  const t = tenantFor(org.id, project.id);
  const admin = await db.user.findFirstOrThrow({ where: { orgId: org.id, email: "admin@delios.local" } });
  const actor = { ...admin, role: admin.role, organization: admin.organization, partyId: admin.partyId, partyCode: null, partyName: null, isInternal: true } as unknown as SessionUser;
  const party = await db.party.findFirst({ where: { orgId: org.id, isInternal: false } });
  const status = await db.configValue.findFirstOrThrow({ where: { orgId: org.id, setKey: "STATUSES", status: "ACTIVE" } });
  // The organization's own verdict that lets a revision proceed.
  const verdicts = await db.configValue.findMany({ where: { orgId: org.id, setKey: "REVIEW_OUTCOMES", status: "ACTIVE" }, select: { code: true, props: true } });
  const proceeds = verdicts.find((one) => {
    try { return one.props ? (JSON.parse(one.props) as { proceed?: boolean }).proceed === true : false; } catch { return false; }
  })?.code ?? "APPROVED";
  const stamp = Date.now().toString(36);
  const made: string[] = [];

  /** A revision that has been decided and is waiting to be published. */
  async function decided(label: string) {
    const doc = await t.db.document.create({
      data: {
        projectId: project.id, docNumber: `VERIFY-REL-${stamp}-${label}`, title: `Release check ${label}`,
        deliverableType: "ENG", docType: "CAL", discipline: "ME", criticality: "ROUTINE",
        confidentiality: "INTERNAL", retentionClass: null, state: "ACTIVE",
        createdById: admin.id, createdByName: admin.name,
      },
    });
    made.push(doc.id);
    const file = await t.db.storedFile.create({
      data: {
        projectId: project.id, name: `${label}.pdf`, path: `verify/${stamp}-${label}.pdf`, size: 1,
        mime: "application/pdf", sha256: `verify-rel-${stamp}-${label}`, kind: "RENDITION",
        uploadedById: admin.id, uploadedByName: admin.name,
      },
    });
    const rev = await t.db.revision.create({
      data: {
        projectId: project.id, documentId: doc.id, value: "A", state: "IN_PREPARATION",
        reasonForRevision: "First issue", changeDescription: "Written for this check",
        renditionFileId: file.id,
      },
    });
    await t.db.storedFile.update({ where: { id: file.id }, data: { revisionId: rev.id } });
    await t.db.document.update({ where: { id: doc.id }, data: { retentionClass: "PROJECT" } });
    const cycle = await openReviewCycle(t, rev.id, actor, { reviewerIds: [admin.id] });
    await issueToReview(t, cycle.id, actor);
    return { doc, rev, cycle };
  }

  try {
    console.log("\nA revision nobody has said where to send\n");
    const first = await decided("NONE");
    await recordReviewOutcome(t, first.cycle.id, actor, proceeds, undefined, status.code);
    const before = await pendingIssue(t, first.rev.id);
    check("the register says it is not ready to release", !before.ok, before.ok ? "" : before.error.slice(0, 60) + "…");
    let refused = "";
    try { await releaseRevision(t, first.rev.id, actor, status.code); } catch (e) { refused = e instanceof Error ? e.message : String(e); }
    check("releasing it is refused", /nobody has said who/.test(refused), refused.slice(0, 70));
    const stillWaiting = await t.db.revision.findUniqueOrThrow({ where: { id: first.rev.id } });
    check("…and it stays not released", stillWaiting.state === "NOT_RELEASED", stillWaiting.state);

    console.log("\nA revision somebody has asked for\n");
    const second = await decided("SENT");
    await recordReviewOutcome(t, second.cycle.id, actor, proceeds, undefined, status.code);
    await t.db.issueRequest.create({
      data: {
        projectId: project.id, revisionId: second.rev.id, reason: "INFORMATION",
        recipients: JSON.stringify({ internalUserIds: [admin.id], partyIds: [] }),
        raisedById: admin.id, raisedByName: admin.name,
      },
    });
    await releaseRevision(t, second.rev.id, actor, status.code);
    const out = await t.db.revision.findUniqueOrThrow({ where: { id: second.rev.id } });
    check("it is released", out.state === "RELEASED");
    check("…and issued in the same act", !!out.issuedAt && !!out.releasedAt);
    const sent = await t.db.transmittalItem.count({ where: { revisionId: second.rev.id } });
    check("a transmittal carries it", sent > 0, `${sent} item(s)`);
    const done = await t.db.issueRequest.count({ where: { revisionId: second.rev.id, status: "DONE" } });
    check("the request that asked for it is closed", done === 1);

    if (party) {
      console.log("\nA revision an outside party has to approve\n");
      const third = await decided("APPROVE");
      await t.db.issueRequest.create({
        data: {
          projectId: project.id, revisionId: third.rev.id, reason: "APPROVAL",
          recipients: JSON.stringify({ internalUserIds: [], partyIds: [party.id] }),
          needsApproval: true, approverId: party.id,
          raisedById: admin.id, raisedByName: admin.name,
        },
      });
      await recordReviewOutcome(t, third.cycle.id, actor, proceeds, undefined, status.code);
      const step = await t.db.reviewCycle.findFirst({ where: { revisionId: third.rev.id, issueRequestId: { not: null } } });
      check("their step is open", !!step && step.status === "OPEN", step?.number ?? "none");
      let held = "";
      try { await releaseRevision(t, third.rev.id, actor, status.code); } catch (e) { held = e instanceof Error ? e.message : String(e); }
      check("releasing it is refused while they hold it", /approve this revision first/.test(held), held.slice(0, 70));

      if (step) {
        await settleApproval(t, step.id, actor, true);
        const after = await t.db.revision.findUniqueOrThrow({ where: { id: third.rev.id } });
        check("their acceptance releases and issues it", after.state === "RELEASED" && !!after.issuedAt, after.state);
      }

      console.log("\n…and when they refuse it\n");
      const fourth = await decided("REFUSE");
      await t.db.issueRequest.create({
        data: {
          projectId: project.id, revisionId: fourth.rev.id, reason: "APPROVAL",
          recipients: JSON.stringify({ internalUserIds: [], partyIds: [party.id] }),
          needsApproval: true, approverId: party.id,
          raisedById: admin.id, raisedByName: admin.name,
        },
      });
      await recordReviewOutcome(t, fourth.cycle.id, actor, proceeds, undefined, status.code);
      const theirs = await t.db.reviewCycle.findFirst({ where: { revisionId: fourth.rev.id, issueRequestId: { not: null } } });
      if (theirs) await settleApproval(t, theirs.id, actor, false);
      const back = await t.db.revision.findUniqueOrThrow({ where: { id: fourth.rev.id } });
      check("it goes back to review", back.state === "IN_REVIEW", back.state);
      check("…and is not released", back.state !== "RELEASED" && !back.issuedAt);
    } else {
      console.log("\n(no outside party on this project — the approval checks were skipped)\n");
    }
    console.log("\nAn organization that releases without issuing\n");
    // The project may say that releasing stands on its own. Then nobody need
    // have said where it goes — but an approval asked for is still waited for.
    await db.controlSetting.create({
      data: { projectId: project.id, key: "POLICY_RELEASE", mode: "SEPARATE", setByName: "verify" },
    });
    try {
      const fifth = await decided("ALONE");
      await recordReviewOutcome(t, fifth.cycle.id, actor, proceeds, undefined, status.code);
      const asked = await pendingIssue(t, fifth.rev.id, { recipients: false });
      check("with nobody named, it may still be released", asked.ok);
      await releaseRevision(t, fifth.rev.id, actor, status.code);
      const alone = await t.db.revision.findUniqueOrThrow({ where: { id: fifth.rev.id } });
      check("it is released", alone.state === "RELEASED");
      const carried = await t.db.transmittalItem.count({ where: { revisionId: fifth.rev.id } });
      check("…and nothing was sent", carried === 0, `${carried} item(s)`);
    } finally {
      await db.controlSetting.deleteMany({ where: { projectId: project.id, key: "POLICY_RELEASE" } });
    }

    console.log("\nAn organization that counts the status alone\n");
    // The other reading of "delivered": whatever the newest revision carries.
    const sixth = await decided("STATUS");
    const { readyReading, countingRevision, meetsRequirement } = await import("../src/lib/readiness");
    const strict = await t.db.document.findUniqueOrThrow({
      where: { id: sixth.doc.id },
      include: { revisions: countingRevision("ISSUED") },
    });
    check("under the strict reading nothing counts yet", !meetsRequirement(strict.revisions, status.code), `${strict.revisions.length} released revision(s)`);
    await t.db.revision.update({ where: { id: sixth.rev.id }, data: { statusCode: status.code } });
    const loose = await t.db.document.findUniqueOrThrow({
      where: { id: sixth.doc.id },
      include: { revisions: countingRevision("STATUS") },
    });
    check("under the other reading the status alone counts", meetsRequirement(loose.revisions, status.code), loose.revisions[0]?.state ?? "none");
    check("and the project's own answer is the strict one until it says otherwise", (await readyReading(t)) === "ISSUED");

  } finally {
    // Leave the register as it was.
    const revs = await db.revision.findMany({ where: { documentId: { in: made } }, select: { id: true } });
    const revIds = revs.map((one) => one.id);
    const items = await db.transmittalItem.findMany({ where: { revisionId: { in: revIds } }, select: { transmittalId: true } });
    const transmittalIds = [...new Set(items.map((one) => one.transmittalId))];
    await db.transmittalItem.deleteMany({ where: { revisionId: { in: revIds } } });
    await db.transmittalRecipient.deleteMany({ where: { transmittalId: { in: transmittalIds } } });
    await db.transmittal.deleteMany({ where: { id: { in: transmittalIds } } });
    const cycles = await db.reviewCycle.findMany({ where: { revisionId: { in: revIds } }, select: { id: true } });
    const cycleIds = cycles.map((one) => one.id);
    await db.reviewAssignment.deleteMany({ where: { cycleId: { in: cycleIds } } });
    await db.reviewComment.deleteMany({ where: { cycleId: { in: cycleIds } } });
    await db.reviewCycle.deleteMany({ where: { id: { in: cycleIds } } });
    await db.issueRequest.deleteMany({ where: { revisionId: { in: revIds } } });
    await db.approval.deleteMany({ where: { revisionId: { in: revIds } } });
    await db.obsolescenceRecord.deleteMany({ where: { documentId: { in: made } } });
    await db.documentSnapshot.deleteMany({ where: { documentId: { in: made } } });
    await db.storedFile.deleteMany({ where: { revisionId: { in: revIds } } });
    await db.revision.deleteMany({ where: { id: { in: revIds } } });
    await db.document.deleteMany({ where: { id: { in: made } } });
    await db.auditEvent.deleteMany({ where: { entityLabel: { startsWith: `VERIFY-REL-${stamp}` } } });
    await db.notification.deleteMany({ where: { title: { contains: `VERIFY-REL-${stamp}` } } });
  }

  console.log(failures === 0 ? "\nAll release checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
