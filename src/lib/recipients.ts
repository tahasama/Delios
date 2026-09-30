import "server-only";
import type { Tenant } from "./scope";

export type RecipientCompany = { key: string; name: string; people: { id: string; name: string; job: string | null }[]; offline?: string };

/**
 * Everyone something can be sent to, by company: the people with an account
 * here, and each organization that has none — offered through its contact, with
 * the names of our people who send it on to them. A recipient is chosen, never
 * typed, so every name on a record is somebody who exists.
 *
 * `withOffline` false leaves those organizations out, where only people who
 * can be notified here make sense — copying somebody in on a return.
 */
export async function recipientCompanies(ctx: Tenant & { project: { name: string } }, { withOffline = true }: { withOffline?: boolean } = {}): Promise<RecipientCompany[]> {
  const { db } = ctx;
  const ourOrganization = (await db.party.findFirst({ where: { isInternal: true }, select: { name: true } }))?.name ?? "Our organization";
  const users = await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { party: { select: { code: true, name: true, active: true } } } });
  const companies = [...
    users.reduce((map, u) => {
      const key = u.party?.code ?? "US";
      const name = u.party?.name ?? ctx.project.name.split(" ")[0] ?? "Our organization";
      if (u.party && u.party.active === false) return map;
      const group = map.get(key) ?? { key, name: u.party ? name : ourOrganization, people: [] as { id: string; name: string; job: string | null }[] };
      group.people.push({ id: u.id, name: u.name, job: u.organization ?? null });
      map.set(key, group);
      return map;
    }, new Map<string, RecipientCompany>()).values(),
  ];
  if (withOffline) {
    // Organizations with no accounts here. Nobody there can open it, so what is
    // chosen is their contact, and one of our people sends it on: the party's
    // liaison, or the control function where none is named.
    const { partyStepHolders } = await import("./workflow");
    const offlineParties = await db.party.findMany({ where: { kind: "OFFLINE", active: true, isInternal: false }, orderBy: { name: "asc" } });
    for (const party of offlineParties) {
      const carriers = await partyStepHolders(ctx, party.id);
      const names = carriers.ids.length ? (await db.user.findMany({ where: { id: { in: carriers.ids } }, select: { name: true } })).map((one) => one.name) : [];
      companies.push({
        key: `party:${party.id}`,
        name: party.name,
        people: [{ id: `party:${party.id}`, name: party.contactName ?? "Their contact", job: party.contactEmail ?? null }],
        offline: names.join(", ") || "Document Control",
      });
    }
  }
  return companies.sort((a, b) => (a.key === "US" ? -1 : b.key === "US" ? 1 : a.name.localeCompare(b.name)));
}
