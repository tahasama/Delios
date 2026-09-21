// Upgrade step, safe to run any number of times. For every organization:
//  - publish any function from the default catalogue it does not have yet
//    (e.g. Project manager); functions it already has are never touched;
//  - give it the reference Traceability Spine if it has none (Annex F).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { publishFunctionCatalogue } from "../src/lib/bootstrap";
import { adoptReferenceSpine } from "../src/lib/spine";

const db = new PrismaClient();

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, slug: true } });
  for (const o of orgs) {
    const before = await db.function.count({ where: { orgId: o.id } });
    await publishFunctionCatalogue(db, o.id);
    const added = (await db.function.count({ where: { orgId: o.id } })) - before;
    const spine = (await db.spineLink.count({ where: { orgId: o.id } })) ? 0 : await adoptReferenceSpine(db, o.id, "Adopted at upgrade");
    console.log(`${o.slug}: ${added} function(s) added${spine ? `, ${spine} spine links adopted` : ""}`);
  }
}

main().finally(() => db.$disconnect());
