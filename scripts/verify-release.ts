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
import { releaseRevision, recordReviewOutcome, openReviewCycle, issueToReview, returnAtGate } from "../src/lib/lifecycle";
import { pendingIssue, settleApproval, openApprovalStep, holdRevision, liftHold, returnHeld, carryOutRequest } from "../src/lib/issue-requests";
import type { SessionUser } from "../src/lib/auth";

const db = new PrismaClient();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const project = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1001" } });
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
        await t.db.reviewCycle.update({ where: { id: step.id }, data: { status: "CLOSED" } });
        await settleApproval(t, step.id, actor, true);
        const waiting = await t.db.revision.findUniqueOrThrow({ where: { id: third.rev.id } });
        check("their acceptance goes to Document Control, not straight out", waiting.state === "NOT_RELEASED" && !waiting.issuedAt, waiting.state);
        check("…who may now release it", (await pendingIssue(t, third.rev.id)).ok);
        await releaseRevision(t, third.rev.id, actor, status.code);
        const after = await t.db.revision.findUniqueOrThrow({ where: { id: third.rev.id } });
        check("releasing it releases and issues it", after.state === "RELEASED" && !!after.issuedAt, after.state);
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
      if (theirs) {
        await t.db.reviewCycle.update({ where: { id: theirs.id }, data: { status: "CLOSED" } });
        await settleApproval(t, theirs.id, actor, false);
      }
      const refused = await t.db.revision.findUniqueOrThrow({ where: { id: fourth.rev.id } });
      check("their refusal goes to Document Control", refused.state === "NOT_RELEASED" && !refused.issuedAt, refused.state);
      let blocked = "";
      try { await releaseRevision(t, fourth.rev.id, actor, status.code); } catch (e) { blocked = e instanceof Error ? e.message : String(e); }
      check("…who may not release it", /did not approve/.test(blocked), blocked.slice(0, 70));
      await returnAtGate(t, fourth.rev.id, actor, "Their comments are to be taken in.", null, null, []);
      const back = await t.db.revision.findUniqueOrThrow({ where: { id: fourth.rev.id } });
      check("…and sends it back, with the reason", back.state === "RETURNED" && back.returnedReason === "Their comments are to be taken in.", back.state);

      console.log("\nAn outside approval found to be needed after release\n");
      for (const answer of [true, false]) {
        const late = await decided(answer ? "LATE-YES" : "LATE-NO");
        await recordReviewOutcome(t, late.cycle.id, actor, proceeds, undefined, status.code);
        await t.db.issueRequest.create({
          data: {
            projectId: project.id, revisionId: late.rev.id, reason: "INFORMATION",
            recipients: JSON.stringify({ internalUserIds: [admin.id], partyIds: [] }),
            raisedById: admin.id, raisedByName: admin.name,
          },
        });
        await releaseRevision(t, late.rev.id, actor, status.code);
        const asked = await t.db.issueRequest.create({
          data: {
            projectId: project.id, revisionId: late.rev.id, reason: "APPROVAL",
            recipients: JSON.stringify({ internalUserIds: [admin.id], partyIds: [] }),
            needsApproval: true, approverId: party.id,
            raisedById: admin.id, raisedByName: admin.name,
          },
        });
        const early = await carryOutRequest(t, asked.id, actor);
        check(`nothing is sent before they answer (${answer ? "yes" : "no"})`, !!early.error && !early.numbers.length, early.error);
        // A real PDF behind its viewable copy, so the hold has something to stamp.
        const clean = await t.db.revision.findUniqueOrThrow({ where: { id: late.rev.id } });
        const copy = await t.db.storedFile.findUniqueOrThrow({ where: { id: clean.renditionFileId! } });
        const { PDFDocument } = await import("pdf-lib");
        const blank = await PDFDocument.create(); blank.addPage([595, 842]);
        const { mkdir, writeFile } = await import("node:fs/promises");
        const pathMod = await import("node:path");
        const at = pathMod.join(process.cwd(), "uploads", copy.path);
        await mkdir(pathMod.dirname(at), { recursive: true });
        await writeFile(at, await blank.save());
        await openApprovalStep(t, late.rev.id, actor);
        const told = () => t.db.notification.count({ where: { userId: admin.id, type: "REVISION_HOLD", link: `/documents/${late.doc.id}` } });
        await holdRevision(t, late.rev.id, actor, party.name);
        check("whoever it was sent to is told it is on hold", (await told()) === 1);
        const held = await t.db.revision.findUniqueOrThrow({ where: { id: late.rev.id } });
        check("it stays released, on hold, not for use", held.state === "RELEASED" && !!held.heldAt, held.heldReason ?? "");
        check("…and its viewable copy is stamped", !!held.renditionFileId && held.renditionFileId !== clean.renditionFileId);
        const stampedRow = await t.db.storedFile.findUniqueOrThrow({ where: { id: held.renditionFileId! } });
        const { readStored } = await import("../src/lib/files");
        check("…as a PDF that opens", (await PDFDocument.load(await readStored(stampedRow.path))).getPageCount() === 1);
        const theirStep = await t.db.reviewCycle.findFirstOrThrow({ where: { revisionId: late.rev.id, issueRequestId: asked.id } });
        await t.db.reviewCycle.update({ where: { id: theirStep.id }, data: { status: "CLOSED" } });
        await settleApproval(t, theirStep.id, actor, answer);
        if (answer) {
          const { sent } = await liftHold(t, late.rev.id, actor);
          const lifted = await t.db.revision.findUniqueOrThrow({ where: { id: late.rev.id } });
          check("approved: lifting the hold puts it back in use", !lifted.heldAt);
          check("…with its unstamped copy back", lifted.renditionFileId === clean.renditionFileId);
          check("…and whoever it was sent to is told it is back in use", (await told()) === 2);
          check("…and sends what waited for it", sent > 0, `${sent} transmittal(s)`);
        } else {
          let kept = "";
          try { await liftHold(t, late.rev.id, actor); } catch (e) { kept = e instanceof Error ? e.message : String(e); }
          check("refused: the hold cannot be lifted", /did not approve/.test(kept), kept.slice(0, 60));
          await returnHeld(t, late.rev.id, actor, "Not approved by the client.", []);
          const stays = await t.db.revision.findUniqueOrThrow({ where: { id: late.rev.id } });
          check("…sent back, it stays on hold for good", !!stays.heldAt && /Not approved/.test(stays.heldReason ?? ""), stays.heldReason ?? "");
          const left = await t.db.issueRequest.count({ where: { id: asked.id, status: "OPEN" } });
          check("…and the request that waited is cancelled", left === 0);
          check("…and whoever it was sent to is told it stays not for use", (await told()) === 2);
        }
      }
    } else {
      console.log("\n(no outside party on this project — the approval checks were skipped)\n");
    }
    console.log("\nThe verdict stamped on the PDF\n");
    for (const on of [true, false]) {
      const stamped = await decided(on ? "STAMP-ON" : "STAMP-OFF");
      const before = await t.db.revision.findUniqueOrThrow({ where: { id: stamped.rev.id } });
      const copy = await t.db.storedFile.findUniqueOrThrow({ where: { id: before.renditionFileId! } });
      const { PDFDocument } = await import("pdf-lib");
      const blank = await PDFDocument.create(); blank.addPage([595, 842]);
      const { mkdir, writeFile } = await import("node:fs/promises");
      const pathMod = await import("node:path");
      const at = pathMod.join(process.cwd(), "uploads", copy.path);
      await mkdir(pathMod.dirname(at), { recursive: true });
      await writeFile(at, await blank.save());
      if (!on) await db.controlSetting.create({ data: { projectId: project.id, key: "POLICY_PDF_STAMP", mode: "OFF", setByName: "verify" } });
      try {
        await recordReviewOutcome(t, stamped.cycle.id, actor, proceeds, "Checked against the datasheet — fit for purpose.", status.code);
      } finally {
        await db.controlSetting.deleteMany({ where: { projectId: project.id, key: "POLICY_PDF_STAMP" } });
      }
      const after = await t.db.revision.findUniqueOrThrow({ where: { id: stamped.rev.id } });
      if (on) {
        check("switched on: the binding verdict gets a stamped copy", after.renditionFileId !== before.renditionFileId);
        const row = await t.db.storedFile.findUniqueOrThrow({ where: { id: after.renditionFileId! } });
        const { readStored } = await import("../src/lib/files");
        check("…which opens as a PDF", (await PDFDocument.load(await readStored(row.path))).getPageCount() === 1);
        check("…and the copy as submitted is kept", !!(await t.db.storedFile.findUnique({ where: { id: before.renditionFileId! } })));
      } else {
        check("switched off: the file is left as it was", after.renditionFileId === before.renditionFileId);
      }
    }

    console.log("\nAn organization where releasing means go ahead\n");
    // The project may say that releasing stands on its own. Then nobody need
    // have said where it goes — but an approval asked for is still waited for.
    await db.controlSetting.create({
      data: { projectId: project.id, key: "POLICY_RELEASE", mode: "SEPARATE", setByName: "verify" },
    });
    try {
      const { issuePolicy } = await import("../src/lib/issue-requests");
      check("nobody is asked who receives it", !(await issuePolicy(t)).asked);
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
