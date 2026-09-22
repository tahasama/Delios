import type { Tenant } from "./tenant";

/**
 * The published sets are agreed in the Document Management Plan, and the DMP
 * is approved like any other document. Nobody approves a set change here;
 * instead the sets are compared with the DMP's current released revision, and
 * any value changed after it was released is a reminder to revise the DMP.
 */
export type DmpSetsState =
  | { dmp: null }
  | {
      dmp: { id: string; docNumber: string; title: string };
      /** The DMP revision the sets are measured against — its latest release. */
      revision: { value: string; releasedAt: Date } | null;
      /** Values changed after that release, per set. */
      changed: { setKey: string; setTitle: string; codes: string[] }[];
      lastChange: Date | null;
    };

export async function dmpSetsState(t: Pick<Tenant, "db">): Promise<DmpSetsState> {
  const scope = await t.db.scopeConfig.findFirst({ select: { dmpDocumentId: true } });
  if (!scope?.dmpDocumentId) return { dmp: null };
  const doc = await t.db.document.findUnique({
    where: { id: scope.dmpDocumentId },
    select: { id: true, docNumber: true, title: true, revisions: { where: { state: { in: ["RELEASED", "SUPERSEDED"] }, releasedAt: { not: null } }, orderBy: { releasedAt: "desc" }, take: 1, select: { value: true, releasedAt: true } } },
  });
  if (!doc) return { dmp: null };
  const rev = doc.revisions[0] ?? null;
  const since = rev?.releasedAt ?? null;
  const [values, sets] = await Promise.all([
    since ? t.db.configValue.findMany({ where: { updatedAt: { gt: since } }, select: { setKey: true, code: true, updatedAt: true } }) : Promise.resolve([]),
    t.db.configSet.findMany({ select: { key: true, title: true } }),
  ]);
  const bySet = new Map<string, string[]>();
  for (const v of values) bySet.set(v.setKey, [...(bySet.get(v.setKey) ?? []), v.code]);
  return {
    dmp: { id: doc.id, docNumber: doc.docNumber, title: doc.title },
    revision: rev && rev.releasedAt ? { value: rev.value, releasedAt: rev.releasedAt } : null,
    changed: [...bySet].map(([setKey, codes]) => ({ setKey, setTitle: sets.find((s) => s.key === setKey)?.title ?? setKey, codes })),
    lastChange: values.reduce<Date | null>((m, v) => (!m || v.updatedAt > m ? v.updatedAt : m), null),
  };
}
