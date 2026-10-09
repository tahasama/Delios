
/**
 * §13.2 — every item carries a retention class, and it follows the published
 * criticality-to-retention mapping (§5.6). Nobody should have to know the
 * retention schedule to register a document: when none is chosen, the class
 * comes from the criticality, and failing that from the organization's
 * default class.
 */
export async function retentionFor(_t: unknown, criticality: string | null | undefined): Promise<string | null> {
  const { getActiveSet, getValue } = await import("./config");
  const classes = await getActiveSet("RETENTION_CLASSES");
  const exists = (code: unknown) => typeof code === "string" && classes.some((c) => c.code === code);
  if (criticality) {
    const mapped = (await getValue("CRITICALITY", criticality))?.props.retention;
    if (exists(mapped)) return mapped as string;
  }
  const flagged = classes.find((c) => c.props.default === true);
  if (flagged) return flagged.code;
  return exists("PROJECT_DURATION") ? "PROJECT_DURATION" : classes[0]?.code ?? null;
}
