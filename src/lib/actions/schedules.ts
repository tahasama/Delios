"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { isController } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { parseCsv, toObjects } from "@/lib/csv";

export type ScheduleImportRow = { line: number; ok: boolean; message: string };
export type ScheduleImportResult = {
  error?: string;
  ok?: string;
  rows?: ScheduleImportRow[];
  dryRun?: boolean;
  versionId?: string;
};

type ParsedActivity = {
  externalId: string;
  actionCode: string;
  name: string;
  baselineDate: Date | null;
  forecastDate: Date | null;
  responsibleParty: string | null;
};

const value = (row: Record<string, string>, key: string) => (row[key] ?? "").trim();

function parseDate(input: string): Date | null {
  if (!input) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const date = new Date(`${input}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
