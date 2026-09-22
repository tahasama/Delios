import type { Tenant } from "./tenant";

/**
 * §13.2 — every item carries a retention class, and it follows the published
 * criticality-to-retention mapping (§5.6). Nobody should have to know the
 * retention schedule to register a document: when none is chosen, the class
 * comes from the criticality, and failing that from the organization's
 * default class.
 */
export async function retentionFor(t: Pick<Tenant, "db">, criticality: string | null | undefined): Promise<string | null> {
  const classes = await t.db.configValue.findMany({ where: { setKey: "RETENTION_CLASSES", status: "ACTIVE" }, select: { code: true, props: true } });
  const exists = (code: unknown) => typeof code === "string" && classes.some((c) => c.code === code);
  if (criticality) {
    const crit = await t.db.configValue.findFirst({ where: { setKey: "CRITICALITY", code: criticality }, select: { props: true } });
    const mapped = crit?.props ? (JSON.parse(crit.props) as { retention?: unknown }).retention : undefined;
    if (exists(mapped)) return mapped as string;
  }
  const flagged = classes.find((c) => c.props && (JSON.parse(c.props) as { default?: unknown }).default === true);
  if (flagged) return flagged.code;
  return exists("PROJECT_DURATION") ? "PROJECT_DURATION" : classes[0]?.code ?? null;
}
