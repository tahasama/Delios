import "server-only";
import { adminProjects } from "@/lib/settings/api-admin";
import type { ProjectChoice } from "./liberty-row";

/** Our projects still open, which a fixed switch may leave free one by one, and the project chooser reads. */
export async function exceptable(): Promise<ProjectChoice[]> {
  return (await adminProjects()).filter((p) => p.status !== "ARCHIVED").map((p) => ({ id: p.id, code: p.code, name: p.name }))
    .sort((a, b) => a.code.localeCompare(b.code));
}
