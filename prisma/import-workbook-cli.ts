// CLI wrapper: npm run import-workbook [-- <project-code>]
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const code = process.argv[2] ?? process.env.PROJECT;
const project = code
  ? await db.project.findFirstOrThrow({ where: { code } })
  : await db.project.findFirstOrThrow({ orderBy: { code: "asc" } });

const { importWorkbook } = await import("./import-workbook");
await importWorkbook(db, project.orgId, project.id);
console.log(`Workbook import complete for ${project.code}.`);
await db.$disconnect();
