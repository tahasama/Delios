import "server-only";
import { api, projectPath } from "@/lib/client";

export * from "@/lib/actions/list-source-kinds";
import type { ListSource } from "@/lib/actions/list-source-kinds";

/** Every list's register document and what it was read from last (our own people only; anyone else reads none). */
export async function listSources(scope: { projectId: string }): Promise<ListSource[]> {
  return api<ListSource[]>(projectPath(scope, "/lists/sources"), { keep: { areas: ["plan", "docs"] } }).catch(() => []);
}
