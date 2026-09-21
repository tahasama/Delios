// Phase 7 exit criterion: the Traceability Spine (Annex F) links every Rule to
// the Check that verifies it and the Route step that applies it, notices when
// either side changes, and blocks a synchronized baseline until they reconcile.
//
// Runs against a throwaway organization so the seeded fixtures are untouched.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { CATALOG } from "../src/lib/checks/catalog";
import { RULES } from "../src/lib/checks/rules";
import { RUNNERS, buildCtx } from "../src/lib/checks/runners";
import { adoptReferenceSpine, effectiveSpine, referenceLinks, citedRules, currentVersions, DEFINITIONAL_RULES } from "../src/lib/spine";

const db = new PrismaClient();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// Rules the published Standard gives no Check in Annex H: clauses that only
// define scope, terms or relationships and so require none (F.3).
const KNOWN_UNCHECKED = ["§1.1", "§2.5"];

async function main() {
  const slug = `verify-spine-${Date.now()}`;
  const org = await db.organization.create({ data: { slug, name: "Spine verification" } });
  const project = await db.project.create({ data: { orgId: org.id, code: "SP1", name: "Spine project" } });
  const t = tenantFor(org.id, project.id);

  try {
    console.log("\nThe catalogue and the Rules agree with the Standard v2\n");
    check("Annex H has 274 checks", CATALOG.length === 274, `${CATALOG.length}`);
    check("every check states its method", CATALOG.every((c) => c.method.length > 10));
    check("identifiers are unique", new Set(CATALOG.map((c) => c.id)).size === CATALOG.length);
    const uncited = CATALOG.filter((c) => !citedRules(c.clause).length);
    check("every check cites a Rule the Standard has", uncited.length === 0, uncited.map((c) => c.id).join(", "));
    check("§0.4, Parts 1–17 and Annex F rules are all present", RULES.length === 141 && RULES.some((r) => r.id === "§0.4") && RULES.some((r) => r.id === "§17.8") && RULES.some((r) => r.id === "F.5"), `${RULES.length}`);
    const refs = referenceLinks();
    const checked = new Set(refs.filter((r) => r.kind === "CHECK").map((r) => r.ruleId));
    const unchecked = RULES.filter((r) => !checked.has(r.id)).map((r) => r.id);
    check("only the known Rules lack a Check", JSON.stringify(unchecked) === JSON.stringify(KNOWN_UNCHECKED), unchecked.join(", "));
    check("…and they are exactly the clauses recorded as stating no requirement", JSON.stringify([...DEFINITIONAL_RULES].sort()) === JSON.stringify([...KNOWN_UNCHECKED].sort()));

    console.log("\nAdopting the reference spine\n");
    const adopted = await adoptReferenceSpine(db, org.id);
    check("one row per relationship, not per clause", adopted > CATALOG.length, `${adopted} links`);
    const s0 = await effectiveSpine(t);
    check("nothing needs review right after adoption", s0.counts.REVIEW_REQUIRED === 0);
    check("a clause with no requirement is recorded as needing no Check, not a Gap (F.3)",
      s0.counts.GAP === 0 && KNOWN_UNCHECKED.every((id) => s0.rows.some((r) => r.ruleId === id && r.kind === "CHECK" && !r.target && r.state === "NOT_APPLICABLE" && !!r.reason)), `${s0.counts.GAP} gap(s)`);
    check("a Rule no Route sequences is recorded Not applicable with its reason",
      s0.rows.some((r) => r.kind === "ROUTE" && !r.target && r.state === "NOT_APPLICABLE" && !!r.reason));
    check("the adopted reference reconciles, so a baseline could be released", s0.releasable);

    console.log("\nA change reaches every linked item (F.5 rule 3)\n");
    const link = await db.spineLink.findFirstOrThrow({ where: { orgId: org.id, kind: "CHECK", target: "ID-02" } });
    await db.spineLink.update({ where: { id: link.id }, data: { targetVersion: "before" } });
    const s1 = await effectiveSpine(t);
    const changed = s1.rows.find((r) => r.kind === "CHECK" && r.target === "ID-02" && r.ruleId === link.ruleId)!;
    check("a changed Check puts its link in Review required", changed.state === "REVIEW_REQUIRED" && /changed/.test(changed.why ?? ""), changed.why ?? "");
    const ctx = await buildCtx(t);
    const cf22 = await RUNNERS["CF-22"](ctx);
    check("DEF-CF-22 reports the unreviewed link", Array.isArray(cf22) && cf22.length === 1, Array.isArray(cf22) ? `${cf22.length}` : String(cf22));
    check("a baseline cannot be released while a link awaits review (F.5 rule 5)", !s1.releasable);
    await db.spineLink.deleteMany({ where: { orgId: org.id, ruleId: KNOWN_UNCHECKED[0], kind: "CHECK", target: "" } });
    const cf21 = await RUNNERS["CF-21"](ctx);
    check("without that record, DEF-CF-21 reports the Rule with no Check", Array.isArray(cf21) && cf21.length === 1, Array.isArray(cf21) ? `${cf21.length}` : String(cf21));

    const rule = await db.spineLink.findFirstOrThrow({ where: { orgId: org.id, kind: "ROUTE", target: "" } });
    await db.spineLink.update({ where: { id: rule.id }, data: { ruleVersion: "before" } });
    const s2 = await effectiveSpine(t);
    check("a changed Rule re-opens its Not applicable decision", s2.rows.find((r) => r.ruleId === rule.ruleId && r.kind === "ROUTE" && !r.target)?.state === "REVIEW_REQUIRED");

    console.log("\nResolving (F.5 rule 4)\n");
    for (const l of [link, rule]) {
      await db.spineLink.update({ where: { id: l.id }, data: { alignment: l.alignment, ...currentVersions(l.ruleId, l.kind, l.target), reviewedAt: new Date(), reviewedByName: "verifier" } });
    }
    const s3 = await effectiveSpine(t);
    check("reviewed against the current versions, the links are settled again", s3.counts.REVIEW_REQUIRED === 0);

    await db.spineLink.create({ data: { orgId: org.id, ruleId: "§3.1", kind: "CHECK", target: "ZZ-99", alignment: "ALIGNED" } });
    const s4 = await effectiveSpine(t);
    check("a link the Standard no longer makes is Withdrawn, not deleted", s4.rows.find((r) => r.target === "ZZ-99")?.state === "WITHDRAWN");

    await db.spineLink.delete({ where: { id: rule.id } });
    const s5 = await effectiveSpine(t);
    check("a blank Route relationship is a Gap (F.3)", s5.rows.some((r) => r.ruleId === rule.ruleId && r.kind === "ROUTE" && r.state === "GAP"));

    console.log("\nReleased baselines (DEF-CF-23)\n");
    check("with no baseline released, CF-23 has nothing to check", (await RUNNERS["CF-23"](ctx)) === "NOT_CHECKED");
    await db.spineBaseline.create({ data: { orgId: org.id, label: "imported", standardVersion: "1.0", links: 10, aligned: 8, notApplicable: 0, withdrawn: 0, unresolved: 2, releasedById: "x", releasedByName: "x" } });
    const cf23 = await RUNNERS["CF-23"](ctx);
    check("a baseline released over unresolved links is reported", Array.isArray(cf23) && cf23.length === 1);
  } finally {
    await db.organization.delete({ where: { id: org.id } });
  }

  await db.$disconnect();
  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll spine checks passed.");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
