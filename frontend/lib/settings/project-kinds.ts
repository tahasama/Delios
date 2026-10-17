import "server-only";
import { getSet } from "@/lib/settings/config";

/**
 * Project types: the organization's own list (PROJECT_KINDS, Types & sets), what a project's "Type" is
 * chosen from. It describes the project and changes nothing else. `offered` are those still in use; `all` names every
 * type, retired included, so a project keeps reading its own. The backend refuses a type not in the list (KIND_UNKNOWN).
 */
export async function projectKinds(): Promise<{ offered: { code: string; label: string }[]; label: (code: string) => string }> {
  const all = await getSet("PROJECT_KINDS").catch(() => []);
  const offered = all.filter((one) => one.status === "ACTIVE").map((one) => ({ code: one.code, label: one.label }));
  return {
    // Nothing in the list yet: the one type every project has by default.
    offered: offered.length ? offered : [{ code: "GENERIC", label: "General" }],
    label: (code: string) => all.find((one) => one.code === code)?.label ?? (code === "GENERIC" ? "General" : code),
  };
}
