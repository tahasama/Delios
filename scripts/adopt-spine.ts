// Upgrade step: give every organization that has no Traceability Spine the
// reference spine of the Standard in force (Annex F). Organizations that
// already have one are left alone — their reviews are theirs.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { adoptReferenceSpine } from "../src/lib/spine";

const db = new PrismaClient();

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, slug: true } });
  for (const o of orgs) {
    if (await db.spineLink.count({ where: { orgId: o.id } })) {
      console.log(`${o.slug}: spine present — unchanged`);
      continue;
    }
    const n = await adoptReferenceSpine(db, o.id, "Adopted at upgrade");
    console.log(`${o.slug}: ${n} reference links adopted`);
  }
}

main().finally(() => db.$disconnect());
