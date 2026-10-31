import "server-only";
import { cache } from "react";
import { api, projectPath } from "@/lib/client";
import type { ExceptionHere } from "@/lib/settings/exception";

/** What a reader costs: free, heavy on the server (installed by DELIOS), or paid. */
export type ReaderCost = "FREE" | "HEAVY" | "PAID";
export type Reader = { key: string; title: string; shows: string; cost: ReaderCost; said: string; on: boolean };
export type OrganizationReader = Reader & { installed: boolean; asks: string | null; asked: { byName: string; at: string; message: string | null } | null };
export type ProjectReaders = { readers: Reader[]; mayChange: boolean; free: boolean; exception: ExceptionHere };

/** Every reader, installed or not, with the organization's answer (administrators). */
export const organizationReaders = cache(async () => api<OrganizationReader[]>("/api/admin/viewers", { keep: { areas: [] } }));

/** The readers the organization has on, with this project's answer. */
export const projectReaders = cache(async (t: { projectId: string }) => api<ProjectReaders>(projectPath(t, "/viewers"), { keep: { areas: [] } }));

/** The keys of the readers on for the project: what the Preview may draw. */
export async function readersOn(t: { projectId: string }): Promise<string[] | undefined> {
  // Not read: the Preview draws as before, and the backend still refuses what is off.
  return projectReaders(t).then((r) => r.readers.filter((one) => one.on).map((one) => one.key), () => undefined);
}
