// Upgrade step, safe to run any number of times. For every organization:
//  - publish any function from the default catalogue it does not have yet
//    (e.g. Project manager); functions it already has are never touched;
//  - give it the reference Traceability Spine if it has none (Annex F);
//  - flag the document types that describe equipment (§5.8) and the default
//    retention class, where the organization has not set them itself;
//  - give every document without a retention class the one its criticality
//    maps to (§13.2, §5.6);
//  - mark the review cycles of a route's earlier steps as advice: only the
//    last step's verdict binds;
//  - give every review its number where it was written without one, oldest
//    first, so the numbers follow the order the reviews happened;
//  - publish any reference list the organization does not have yet (the advice
//    list, for instance) and any property a reference value has gained, without
//    touching a value the organization edited itself.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { publishFunctionCatalogue } from "../src/lib/bootstrap";
import { adoptReferenceSpine } from "../src/lib/spine";
import { retentionFor } from "../src/lib/retention";
import { tenantFor } from "../src/lib/tenant";
import { REFERENCE, publishProfile } from "../src/lib/profiles";

const db = new PrismaClient();

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, slug: true } });
  for (const o of orgs) {
    const before = await db.function.count({ where: { orgId: o.id } });
    await publishFunctionCatalogue(db, o.id);
    const added = (await db.function.count({ where: { orgId: o.id } })) - before;
    const spine = (await db.spineLink.count({ where: { orgId: o.id } })) ? 0 : await adoptReferenceSpine(db, o.id, "Adopted at upgrade");
    // Lists and values the reference has gained since this organization started.
    const setsBefore = await db.configSet.count({ where: { orgId: o.id } });
    const valuesBefore = await db.configValue.count({ where: { orgId: o.id } });
    await publishProfile(db, o.id, REFERENCE, "add");
    const lists = (await db.configSet.count({ where: { orgId: o.id } })) - setsBefore;
    const newValues = (await db.configValue.count({ where: { orgId: o.id } })) - valuesBefore;
    // The comment classes said "Class 2/3", which named a third class that does
    // not exist. Only the reference wording is corrected.
    let relabelled = 0;
    for (const [code, was] of [["BLOCKING", "Blocking (Class 1)"], ["NON_BLOCKING", "Non-blocking (Class 2/3)"]] as const) {
      relabelled += (await db.configValue.updateMany({
        where: { orgId: o.id, setKey: "COMMENT_CLASSES", code, label: was },
        data: { label: REFERENCE.sets.find((x) => x.key === "COMMENT_CLASSES")!.values.find((v) => v.code === code)!.label },
      })).count;
    }
    // Properties the reference now carries, added only where the key is absent.
    let flagged = 0;
    for (const set of REFERENCE.sets) {
      for (const v of set.values.filter((x) => x.props)) {
        const row = await db.configValue.findUnique({ where: { orgId_setKey_code: { orgId: o.id, setKey: set.key, code: v.code } } });
        if (!row) continue;
        const props = row.props ? (JSON.parse(row.props) as Record<string, unknown>) : {};
        let changed = false;
        // Only keys the organization has never held: whatever it set stays.
        for (const [k, val] of Object.entries(v.props!)) if (!(k in props)) { props[k] = val; changed = true; }
        if (changed) { await db.configValue.update({ where: { id: row.id }, data: { props: JSON.stringify(props) } }); flagged++; }
      }
    }
    // Retention from criticality, for documents registered before it was automatic.
    let retained = 0;
    for (const p of await db.project.findMany({ where: { orgId: o.id }, select: { id: true } })) {
      const t = tenantFor(o.id, p.id);
      for (const d of await db.document.findMany({ where: { projectId: p.id, retentionClass: null }, select: { id: true, criticality: true } })) {
        const cls = await retentionFor(t, d.criticality);
        if (cls) { await db.document.update({ where: { id: d.id }, data: { retentionClass: cls } }); retained++; }
      }
    }
    // Earlier route steps advise; only the last step's cycle binds.
    let advisory = 0;
    for (const run of await db.workflowRun.findMany({ where: { project: { orgId: o.id } }, select: { steps: true } })) {
      let steps: { cycleId?: string }[] = [];
      try { steps = JSON.parse(run.steps); } catch { continue; }
      const ids = steps.slice(0, -1).map((s) => s.cycleId).filter((id): id is string => !!id);
      if (ids.length) advisory += (await db.reviewCycle.updateMany({ where: { id: { in: ids }, binding: true }, data: { binding: false } })).count;
    }
    console.log(`${o.slug}: ${added} function(s) added${spine ? `, ${spine} spine links adopted` : ""}${flagged ? `, ${flagged} value(s) flagged` : ""}${retained ? `, ${retained} retention class(es) set` : ""}${advisory ? `, ${advisory} route cycle(s) marked as advice` : ""}${lists ? `, ${lists} list(s) published` : ""}${newValues ? `, ${newValues} value(s) added` : ""}${relabelled ? `, ${relabelled} label(s) corrected` : ""}`);
  }
}

/** Reviews written before every review carried a number get one now, in the order they were opened. */
async function numberReviews() {
  const { reviewNumber } = await import("../src/lib/workflow");
  const projects = await db.project.findMany({ select: { id: true, orgId: true, code: true } });
  for (const p of projects) {
    const missing = await db.reviewCycle.findMany({
      where: { projectId: p.id, OR: [{ number: null }, { number: "" }] },
      orderBy: [{ submittedAt: "asc" }, { sequence: "asc" }],
      select: { id: true },
    });
    const t = tenantFor(p.orgId, p.id);
    for (const one of missing) await db.reviewCycle.update({ where: { id: one.id }, data: { number: await reviewNumber(t) } });
    if (missing.length) console.log(`${p.code}: ${missing.length} review(s) numbered`);
  }
}

main().then(numberReviews).finally(() => db.$disconnect());
