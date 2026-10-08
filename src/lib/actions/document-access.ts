"use server";

import { requireScope } from "@/lib/scope";

/**
 * Who may read a document that is above the open confidentiality levels.
 *
 * The people who may read it are named one by one, and only by whoever is
 * answerable for the content — the person who registered it, and whoever
 * authored or uploaded a revision of it — plus an administrator, who reads
 * everything anyway. A reader's own function, however senior, names nobody.
 * The backend keeps no list of named readers yet.
 */

type State = { error?: string; message?: string };

export async function addDocumentReaderAction(_prev: State | undefined, formData: FormData): Promise<State> {
  await requireScope();
  const userIds = [...new Set(formData.getAll("userId").map(String).filter(Boolean))];
  if (!userIds.length) return { error: "Say who." };
  return { error: "Naming the readers of a closed document is not supported yet." };
}

export async function removeDocumentReaderAction(_prev: State | undefined, _formData: FormData): Promise<State> {
  await requireScope();
  return { error: "Naming the readers of a closed document is not supported yet." };
}
