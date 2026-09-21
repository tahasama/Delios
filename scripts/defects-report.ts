import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const byCheck = await db.defect.groupBy({ by: ["checkId", "status"], _count: true });
  console.log(
    byCheck
      .filter((d) => d.status !== "CLOSED")
      .sort((a, b) => b._count - a._count)
      .map((d) => `${d.checkId}:${d._count}`)
      .join("  ")
  );
  const docs = await db.document.count();
  const bad = await db.document.count({
    where: { defects: { some: { severity: { in: ["CRITICAL", "MAJOR"] }, status: { in: ["OPEN", "ACCEPTED"] } } } },
  });
  console.log("docs:", docs, " defective:", bad);
  await db.$disconnect();
}

main();
