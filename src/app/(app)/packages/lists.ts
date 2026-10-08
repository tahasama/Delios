import { api } from "@/lib/api/client";
import type { Addressees, ListValue } from "@/lib/api/types";
import { projectPath, type Session } from "@/lib/session";
import { LISTS } from "@/lib/lists";
import type { RuleLists, Pick } from "./rule-fields";

/** Everything the package screens choose from: the organization's lists, its suppliers, and the project's people. */
export async function packageLists(session: Session) {
  const sets = [LISTS.statuses, LISTS.reasonsForIssue, LISTS.disciplines, LISTS.documentTypes, LISTS.deliverableTypes];
  const [values, parties, addressees] = await Promise.all([
    api<Record<string, ListValue[]>>("/api/values", { query: { sets: sets.join(",") } }),
    api<{ code: string; name: string }[]>("/api/parties"),
    api<Addressees>(projectPath(session, "/addressees")),
  ]);
  const active = (set: string): Pick[] => (values[set] ?? []).filter((v) => v.status === "ACTIVE").map((v) => ({ code: v.code, label: v.label }));
  const rule: RuleLists = {
    deliverableTypes: active(LISTS.deliverableTypes), disciplines: active(LISTS.disciplines), docTypes: active(LISTS.documentTypes),
    originators: parties.map((p) => ({ code: p.code, label: p.name })),
  };
  return {
    statuses: active(LISTS.statuses), reasons: active(LISTS.reasonsForIssue), rule,
    people: addressees.people, parties: addressees.parties,
    /** Every label, retired ones too, for reading old packages. */
    label: (set: string, code: string) => values[set]?.find((v) => v.code === code)?.label ?? code,
  };
}
