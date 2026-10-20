/** A list's values by code and name, to say a route's documents in words. */
export type ScopeLists = {
  documentTypes: { code: string; label: string }[];
  disciplines: { code: string; label: string }[];
  criticalities: { code: string; label: string }[];
  deliverableTypes: { code: string; label: string }[];
  originators: { code: string; label: string }[];
};

/** One pattern of a route: a null or missing field takes any value. */
export type RoutePattern = { docType?: string | null; discipline?: string | null; criticality?: string | null; deliverableType?: string | null; originator?: string | null };

/**
 * Which documents a route takes, in words: each value by its name as published, never a bare code. A field left empty
 * does not narrow, so it is left out; no pattern at all is every document.
 */
export function scopeWords(patterns: RoutePattern[], lists: ScopeLists): string {
  const named = (list: { code: string; label: string }[], code: string) => `${code} — ${list.find((one) => one.code === code)?.label ?? code}`;
  const said = patterns.map((p) => [
    p.deliverableType ? `deliverable type ${named(lists.deliverableTypes, p.deliverableType)}` : null,
    p.docType ? `type ${named(lists.documentTypes, p.docType)}` : null,
    p.discipline ? `discipline ${named(lists.disciplines, p.discipline)}` : null,
    p.criticality ? `criticality ${named(lists.criticalities, p.criticality)}` : null,
    p.originator ? `from ${lists.originators.find((o) => o.code === p.originator)?.label ?? p.originator}` : null,
  ].filter(Boolean).join(", ")).filter(Boolean);
  return said.length ? `Documents of ${said.join("; or ")}` : "Every document";
}

/** The patterns a route's editor keeps as text ("*" for every document). */
export function patternsOf(classes: string): RoutePattern[] {
  if (!classes || classes === "*") return [];
  try {
    return JSON.parse(classes) as RoutePattern[];
  } catch {
    return [];
  }
}
