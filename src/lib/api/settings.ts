import "server-only";
import { cache } from "react";
import { api } from "./client";

type SettingRow = { key: string; value: string; updatedAt: string; updatedBy: string };

/** This project's answers about how it works (control activities, policies), read once a request. */
export const projectSettings = cache(async (projectId: string): Promise<Map<string, string>> => {
  const rows = await api<SettingRow[]>(`/api/projects/${projectId}/settings`).catch(() => [] as SettingRow[]);
  return new Map(rows.map((row) => [row.key, row.value]));
});

/** The organization's own answers (what states are called…), read once a request. */
export const orgSettings = cache(async (): Promise<Map<string, string>> => {
  const rows = await api<SettingRow[]>("/api/settings").catch(() => [] as SettingRow[]);
  return new Map(rows.map((row) => [row.key, row.value]));
});

/** Sets (or, with an empty value, clears) one of the project's answers. */
export async function setProjectSetting(projectId: string, key: string, value: string | null) {
  await api(`/api/projects/${projectId}/settings/${encodeURIComponent(key)}`, { method: "PUT", body: { value: value ?? "" } });
}

/** Sets (or, with an empty value, clears) one of the organization's answers. */
export async function setOrgSetting(key: string, value: string | null) {
  await api(`/api/settings/${encodeURIComponent(key)}`, { method: "PUT", body: { value: value ?? "" } });
}

export type Holder = { id: string; name: string; functionName: string; department: string | null; internal: boolean; functionCode: string };

/** Everyone on the project whose function grants `verb`, optionally for one class of document. */
export const holders = cache(async (
  projectId: string, verb: string, deliverableType?: string | null, docType?: string | null, discipline?: string | null,
  criticality?: string | null, confidentiality?: string | null,
): Promise<Holder[]> =>
  api<Holder[]>(`/api/projects/${projectId}/holders`, { query: { verb, deliverableType, docType, discipline, criticality, confidentiality } }));
