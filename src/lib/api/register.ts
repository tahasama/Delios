import "server-only";
import { api, apiFetch, problemOf, projectPath } from "./client";
import type { DocumentView, RegisterPage, RegisterRow } from "./types";

/**
 * The register as the importers and exports read it: every document's number,
 * one document by its number, and the backend's own files passed on.
 */

type DocumentSummary = {
  id: string; number: string; title: string; deliverableType: string; docType: string; discipline: string; originator: string | null;
  state: string; kind: string; isPlaceholder: boolean; confidentiality: string | null; latestRevision: string | null;
  latestRevisionState: string | null; updatedAt: string;
};

/** Every document this person may see, number to summary, in every state. Read a page of 200 at a time. */
export async function registerByNumber(scope: { projectId: string }): Promise<Map<string, DocumentSummary>> {
  const byNumber = new Map<string, DocumentSummary>();
  let after: string | null = null;
  do {
    const page: { items: DocumentSummary[]; next: string | null } = await api(projectPath(scope, "/documents"), { query: { limit: 200, after } });
    for (const one of page.items) byNumber.set(one.number, one);
    after = page.next;
  } while (after);
  return byNumber;
}

/** Every register row the filters match (the register's own names), 250 at a time, in the register's order. */
export async function registerRows(scope: { projectId: string }, query: Record<string, string | undefined> = {}): Promise<RegisterRow[]> {
  const rows: RegisterRow[] = [];
  for (let page = 1; ; page++) {
    const answer = await api<RegisterPage>(projectPath(scope, "/register"), { query: { ...query, per: 250, page } });
    rows.push(...answer.rows);
    if (answer.page >= answer.pages) return rows;
  }
}

/** One document, with everything the backend keeps on it. */
export async function documentView(scope: { projectId: string }, id: string): Promise<DocumentView> {
  return api<DocumentView>(projectPath(scope, `/documents/${id}`));
}

/**
 * A file the backend builds (the register, the reviews, the transmittal log, a
 * report), passed on to the browser as it arrives, under the backend's name.
 * A refusal comes back as JSON with the backend's status.
 */
export async function passOn(path: string, query: Record<string, string | undefined>): Promise<Response> {
  const answer = await apiFetch(path, { query });
  if (!answer.ok || !answer.body) {
    const problem = await problemOf(answer);
    return Response.json({ error: problem.message }, { status: answer.status });
  }
  const headers: Record<string, string> = {
    "Content-Type": answer.headers.get("content-type") || "application/octet-stream",
    "Cache-Control": "private, no-store",
  };
  const disposition = answer.headers.get("content-disposition");
  if (disposition) headers["Content-Disposition"] = disposition;
  return new Response(answer.body, { headers });
}
