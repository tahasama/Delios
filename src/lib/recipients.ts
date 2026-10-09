import "server-only";
import type { Tenant } from "./tenant";
import { api, projectPath } from "./api/client";
import type { Addressees } from "./api/types";

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
  // The project's people, by the organization they work for, and each organization that has no accounts here.
  const found = await api<Addressees>(projectPath(ctx, "/addressees"));
  const companies = new Map<string, RecipientCompany>();
  for (const person of found.people) {
    const key = person.organization ?? "US";
    const group = companies.get(key) ?? { key: person.organization ? key : "US", name: person.organization ?? "Our organization", people: [] };
    group.people.push({ id: person.id, name: person.name, job: person.function });
    companies.set(key, group);
  }
  const all = [...companies.values()];
  if (withOffline) {
    for (const party of found.parties.filter((p) => p.participation === "BY_PROXY")) {
      all.push({ key: `party:${party.id}`, name: party.name, people: [{ id: `party:${party.id}`, name: "Their contact", job: null }], offline: "Document Control" });
    }
  }
  return all.sort((a, b) => (a.key === "US" ? -1 : b.key === "US" ? 1 : a.name.localeCompare(b.name)));
}
