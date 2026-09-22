import type { Tenant } from "./tenant";

/**
 * §12.3 — when a revision is replaced, everyone who received it must be told.
 *
 * Who received it is read from the issued transmittals that carried it. A
 * recipient counts as told when:
 *   - they have an account here: the release notified them in the app;
 *   - they were sent the current revision (or anything later) by transmittal;
 *   - Document Control recorded that they were told another way.
 * Whoever is left is who still holds an out-of-date revision without knowing.
 */
export type Recipient = { key: string; name: string; organization: string | null; userId: string | null; via: string };
export type Untold = {
  document: { id: string; docNumber: string; title: string };
  old: { id: string; value: string; supersededAt: Date | null };
  current: { id: string; value: string; statusCode: string | null } | null;
  recipients: Recipient[];
  /** The reason the old revision was issued for — the new one goes for the same reason. */
  reason: string | null;
  /** A transmittal already prepared to send the current revision, not issued yet. */
  draft: { id: string; number: string } | null;
};

/** One person, however the transmittal recorded them: by account, or by "name (company)". */
const keyOf = (r: { userId: string | null; name: string; organization: string | null }) =>
  r.userId ? `user:${r.userId}` : `name:${(r.organization ? `${r.name} (${r.organization})` : r.name).trim().toLowerCase().replace(/\s+/g, " ")}`;

const SENT = ["ISSUED", "ACCEPTED", "CLOSED"];

export async function untoldRecipients(t: Pick<Tenant, "db">): Promise<Untold[]> {
  const superseded = await t.db.revision.findMany({
    where: { state: "SUPERSEDED" },
    include: {
      document: { select: { id: true, docNumber: true, title: true } },
      transmittalItems: { include: { transmittal: { include: { recipients: true } } } },
    },
    orderBy: { supersededAt: "desc" },
  });
  const out: Untold[] = [];
  for (const old of superseded) {
    const issued = old.transmittalItems.map((i) => i.transmittal).filter((x) => x.direction === "OUTGOING" && SENT.includes(x.status));
    if (!issued.length) continue;

    const record = await t.db.obsolescenceRecord.findFirst({ where: { kind: "SUPERSEDED", revisionId: old.id }, orderBy: { createdAt: "desc" } });
    if (record?.toldAt) continue;

    // Everything released after the old revision, and who it went to.
    const later = await t.db.revision.findMany({
      where: { documentId: old.documentId, createdAt: { gt: old.createdAt }, state: { in: ["RELEASED", "SUPERSEDED"] } },
      include: { transmittalItems: { include: { transmittal: { include: { recipients: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    const received = new Set(
      later.flatMap((r) => r.transmittalItems.map((i) => i.transmittal))
        .filter((x) => x.direction === "OUTGOING" && SENT.includes(x.status))
        .flatMap((x) => x.recipients.map(keyOf)),
    );
    const byKey = new Map<string, Recipient>();
    for (const tr of issued) {
      for (const r of tr.recipients) {
        const key = keyOf(r);
        // In-app users were notified when the new revision was released.
        if (r.userId || received.has(key) || byKey.has(key)) continue;
        byKey.set(key, { key, name: r.name, organization: r.organization, userId: r.userId, via: tr.number });
      }
    }
    if (!byKey.size) continue;
    const current = later.find((r) => r.state === "RELEASED") ?? null;
    const draft = current?.transmittalItems.map((i) => i.transmittal).find((x) => x.direction === "OUTGOING" && x.status === "DRAFT") ?? null;
    out.push({
      document: old.document,
      old: { id: old.id, value: old.value, supersededAt: old.supersededAt },
      current: current ? { id: current.id, value: current.value, statusCode: current.statusCode } : null,
      recipients: [...byKey.values()],
      reason: issued[0]?.reasonForIssue ?? null,
      draft: draft ? { id: draft.id, number: draft.number } : null,
    });
  }
  return out;
}
