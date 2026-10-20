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

/** A document as a route's patterns read it. */
export type RouteSubject = { number: string; deliverableType: string | null; docType: string | null; discipline: string | null; criticality: string | null; originator: string | null };

/**
 * Why a route does not take these documents, in words: for the pattern closest to fitting, each field that differs,
 * what the route asks and what the document holds ("from Acme Pumps, but P1001-… comes from no organization").
 * Never a mystery (owner: a route that should fit and is not offered).
 */
export function whyNot(patterns: RoutePattern[], docs: RouteSubject[], lists: ScopeLists): string | null {
  const name = (list: { code: string; label: string }[], code: string | null) =>
    code ? `${code} — ${list.find((one) => one.code === code)?.label ?? code}` : "none";
  const fields: { key: keyof RoutePattern & keyof RouteSubject; words: string; list: { code: string; label: string }[] }[] = [
    { key: "deliverableType", words: "deliverable type", list: lists.deliverableTypes },
    { key: "docType", words: "document type", list: lists.documentTypes },
    { key: "discipline", words: "discipline", list: lists.disciplines },
    { key: "criticality", words: "criticality", list: lists.criticalities },
    { key: "originator", words: "organization it comes from", list: lists.originators },
  ];
  for (const doc of docs) {
    const misses = patterns.map((p) => fields.filter((f) => p[f.key] && p[f.key] !== doc[f.key]));
    if (misses.some((m) => m.length === 0)) continue;
    const closest = patterns[misses.reduce((best, m, i) => (m.length < misses[best].length ? i : best), 0)];
    const said = fields.filter((f) => closest[f.key] && closest[f.key] !== doc[f.key])
      .map((f) => `its ${f.words} is ${name(f.list, doc[f.key] ?? null)}, the route asks ${name(f.list, closest[f.key] ?? null)}`);
    return `${doc.number}: ${said.join("; ")}`;
  }
  return null;
}
