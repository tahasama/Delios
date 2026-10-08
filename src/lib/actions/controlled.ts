"use server";

import type { DiffLine } from "@/lib/controlled/registry";

export type ControlledState = {
  error?: string;
  ok?: string;
  /** Row-level problems, so a rejected upload says exactly what to fix. */
  issues?: { line: number; message: string }[];
};

/**
 * Uploaded lists that wait for a decision before they apply. The backend has
 * no such step yet: its schedule import applies at once, and the lists are kept
 * on their own pages. Every act here answers so.
 */
const NOT_YET: ControlledState = { error: "Uploading a list for a decision is not supported yet." };

export async function uploadControlledVersionAction(_prev: ControlledState | undefined, _formData: FormData): Promise<ControlledState> {
  return NOT_YET;
}

export async function submitControlledVersionAction(_prev: ControlledState | undefined, _formData: FormData): Promise<ControlledState> {
  return NOT_YET;
}

export async function decideControlledVersionAction(_prev: ControlledState | undefined, _formData: FormData): Promise<ControlledState> {
  return NOT_YET;
}

export async function discardControlledVersionAction(_prev: ControlledState | undefined, _formData: FormData): Promise<ControlledState> {
  return NOT_YET;
}

export async function readDiff(json: string | null): Promise<DiffLine[]> {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    return Array.isArray(raw) ? (raw as DiffLine[]) : [];
  } catch {
    return [];
  }
}
