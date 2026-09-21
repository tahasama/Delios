import { PrismaClient } from "@prisma/client";

/** One-off additions: C.7 format lists, C.3.3 type-to-field matrix, Annex F spine. */
export async function seedGovernance(db: PrismaClient, orgId: string, projectId: string) {
  // ── C.7 format lists ──
  async function set(key: string, title: string, description: string, values: { code: string; label: string; props?: Record<string, unknown> }[]) {
    await db.configSet.upsert({ where: { orgId_key: { orgId, key } }, update: { title, description }, create: { orgId, key, title, description, version: 1 } });
    for (let i = 0; i < values.length; i++) {
      await db.configValue.upsert({
        where: { orgId_setKey_code: { orgId, setKey: key, code: values[i].code } },
        update: { label: values[i].label, props: values[i].props ? JSON.stringify(values[i].props) : null },
        create: { orgId, setKey: key, code: values[i].code, label: values[i].label, sort: i, props: values[i].props ? JSON.stringify(values[i].props) : null },
      });
    }
  }
  await set("NATIVE_FORMATS", "Accepted native formats", "C.7.1 — formats in which the native form may be held (§10.1).", [
    { code: "pdf", label: "PDF" }, { code: "docx", label: "Word (.docx)" }, { code: "xlsx", label: "Excel (.xlsx)" },
    { code: "dwg", label: "AutoCAD (.dwg)" }, { code: "png", label: "PNG image" }, { code: "jpeg", label: "JPEG image" },
  ]);
  await set("RENDITION_FORMATS", "Accepted rendition formats", "C.7.2 — fixed, viewable forms (§10.2).", [{ code: "pdf", label: "PDF" }]);
  await set("PRESERVATION_FORMATS", "Preservation formats", "C.7.3 — openable without the creating application, self-contained (§10.4).", [{ code: "pdf", label: "PDF/A-ready PDF" }]);

  // ── C.3.3 type-to-field matrix: which conditional fields each deliverable type requires ──
  await set("DELIVERABLE_TYPE_FIELDS", "Type-to-field matrix", "C.3.3 — mandatory / permitted / not-applicable conditional fields per deliverable type (§4.4, §5.2).", [
    { code: "ENG", label: "Engineering", props: { originator: "na", po: "na", receivedDate: "na", subProject: "optional" } },
    { code: "CTR", label: "Contractor", props: { originator: "required", po: "required", receivedDate: "required", subProject: "optional" } },
    { code: "VND", label: "Vendor", props: { originator: "required", po: "required", receivedDate: "required", subProject: "optional" } },
    { code: "TPY", label: "Third party", props: { originator: "required", po: "optional", receivedDate: "required", subProject: "optional" } },
    { code: "CLT", label: "Client", props: { originator: "na", po: "optional", receivedDate: "required", subProject: "optional" } },
  ]);

  // ── Annex F spine — the reference links, per relationship ──
  const { adoptReferenceSpine } = await import("../src/lib/spine");
  await adoptReferenceSpine(db, orgId);
  console.log("· Governance seed: format sets, type-to-field matrix, spine links.");
}
