/**
 * Publish the "Reasons to send a revision back to a step" list into an
 * organization that was set up before it existed.
 *
 * New organizations get it from the reference configuration. This adds it to one
 * already running, without touching any value it already publishes.
 *
 *   npx tsx scripts/publish-return-reasons.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const VALUES = [
  { code: "WRONG_FILE", label: "The wrong file was attached", meaning: "What is under review is not the file that was meant to be reviewed." },
  { code: "WRONG_PEOPLE", label: "The wrong people were on a step", meaning: "A step was seated with people who should not have answered it, or missed people who should." },
  { code: "STEP_SKIPPED", label: "A step was missed", meaning: "The route ran past a step that should have answered." },
  { code: "ANSWER_IN_ERROR", label: "An answer was recorded in error", meaning: "Somebody recorded a verdict on the wrong document, or against the wrong step." },
];

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  for (const org of orgs) {
    const set = await db.configSet.upsert({
      where: { orgId_key: { orgId: org.id, key: "RETURN_REASONS" } },
      update: {},
      create: {
        orgId: org.id,
        key: "RETURN_REASONS",
        title: "Reasons to send a revision back to a step",
        description: "Why a review route is rewound to an earlier step on the same revision. Every one of them is a fault in the route, not in the document: a document that is wrong is replaced by the next revision.",
      },
    });
    let added = 0;
    for (const [index, value] of VALUES.entries()) {
      const held = await db.configValue.findFirst({ where: { setKey: set.key, code: value.code } });
      if (held) continue;
      await db.configValue.create({
        data: {
          orgId: org.id,
          setKey: set.key,
          code: value.code,
          label: value.label,
          sort: index,
          status: "ACTIVE",
          props: JSON.stringify({ meaning: value.meaning }),
        },
      });
      added++;
    }
    console.log(`${org.name}: ${added ? `${added} reason(s) published` : "already published"}.`);
  }
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(() => db.$disconnect());
