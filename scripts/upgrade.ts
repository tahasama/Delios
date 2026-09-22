// Upgrade step, safe to run any number of times. For every organization:
//  - publish any function from the default catalogue it does not have yet
//    (e.g. Project manager); functions it already has are never touched;
//  - give it the reference Traceability Spine if it has none (Annex F);
//  - flag the document types that describe equipment (§5.8) and the default
//    retention class, where the organization has not set them itself;
//  - give every document without a retention class the one its criticality
//    maps to (§13.2, §5.6).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { publishFunctionCatalogue } from "../src/lib/bootstrap";
import { adoptReferenceSpine } from "../src/lib/spine";
import { retentionFor } from "../src/lib/retention";
import { tenantFor } from "../src/lib/tenant";
import { REFERENCE } from "../src/lib/profiles";

const db = new PrismaClient();

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, slug: true } });
  for (const o of orgs) {
    const before = await db.function.count({ where: { orgId: o.id } });
    await publishFunctionCatalogue(db, o.id);
    const added = (await db.function.count({ where: { orgId: o.id } })) - before;
    const spine = (await db.spineLink.count({ where: { orgId: o.id } })) ? 0 : await adoptReferenceSpine(db, o.id, "Adopted at upgrade");
    // Properties the reference now carries, added only where the key is absent.
    let flagged = 0;
    for (const set of REFERENCE.sets.filter((x) => x.key === "DOCUMENT_TYPES" || x.key === "RETENTION_CLASSES")) {
      for (const v of set.values.filter((x) => x.props && ("describesAsset" in x.props || "default" in x.props))) {
        const row = await db.configValue.findUnique({ where: { orgId_setKey_code: { orgId: o.id, setKey: set.key, code: v.code } } });
        if (!row) continue;
        const props = row.props ? (JSON.parse(row.props) as Record<string, unknown>) : {};
        let changed = false;
        for (const [k, val] of Object.entries(v.props!)) if ((k === "describesAsset" || k === "default") && !(k in props)) { props[k] = val; changed = true; }
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
    console.log(`${o.slug}: ${added} function(s) added${spine ? `, ${spine} spine links adopted` : ""}${flagged ? `, ${flagged} value(s) flagged` : ""}${retained ? `, ${retained} retention class(es) set` : ""}`);
  }
}

main().finally(() => db.$disconnect());
