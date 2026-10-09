import "server-only";
import { createHash } from "node:crypto";
import { api, projectPath } from "./client";

/**
 * Sending a file the way the backend takes it: ask for an upload link (the
 * backend checks the name, size and fingerprint), put the bytes there, and hand
 * the file's id to the act that uses it. The backend scans every file before
 * anybody may open it.
 */

type Ticket = { fileId: string; method: string; url: string; headers: Record<string, string>; expiresAt: string };

/** Where an upload goes: a document's next files, proof filed on a review or a transmittal, or a file sent to us that belongs to no document yet. */
export type UploadTarget = { documentId: string } | { reviewId: string } | { transmittalId: string } | { loose: true; proof?: boolean };

/** Uploads one file and returns its id; throws the backend's refusal. */
export async function upload(scope: { projectId: string }, target: UploadTarget, file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const body = {
    fileName: file.name,
    size: bytes.length,
    contentType: file.type || "application/octet-stream",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const path = "documentId" in target ? `/documents/${target.documentId}/uploads`
    : "reviewId" in target ? `/reviews/${target.reviewId}/evidence`
    : "transmittalId" in target ? `/transmittals/${target.transmittalId}/evidence` : "/incoming/uploads";
  const ticket = await api<Ticket>(projectPath(scope, path), { body: "loose" in target ? { ...body, proof: !!target.proof } : body });
  const put = await fetch(ticket.url, { method: ticket.method || "PUT", headers: ticket.headers, body: bytes });
  if (!put.ok) throw new Error(`The file ${file.name} could not be stored (${put.status}).`);
  return ticket.fileId;
}

/** The files a form holds under these names, leaving out empty inputs. */
export function filesOf(formData: FormData, ...names: string[]): File[] {
  return names.flatMap((name) => formData.getAll(name)).filter((one): one is File => one instanceof File && one.size > 0);
}
