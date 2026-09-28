import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";
import type { Tenant } from "./tenant";

export const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

export type SavedFile = {
  relPath: string;
  name: string;
  size: number;
  mime: string;
  sha256: string;
};

/**
 * Persist an uploaded file under ./uploads/<docNumber>/…
 * The stored file name always begins with the document number (§3.6 / DEF-ID-09).
 */
export async function saveUpload(
  t: Tenant,
  file: File,
  docNumber: string,
  kind: "NATIVE" | "RENDITION" | "STAMPED" | "EVIDENCE",
  revValue: string
): Promise<SavedFile> {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("No file provided.");
  if (file.size > 20 * 1024 * 1024) throw new Error("File exceeds the 20 MB limit.");
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || (kind === "RENDITION" ? ".pdf" : "");
  const suffix = kind === "RENDITION" ? "" : kind === "NATIVE" ? "_native" : `_${kind.toLowerCase()}`;
  const storedName = `${docNumber}_Rev-${revValue}${suffix}${ext}`;
  const relPath = path.join(t.projectId, docNumber, `${randomUUID()}__${storedName}`);
  const abs = path.join(UPLOAD_ROOT, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  return {
    relPath,
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

export async function readStored(relPath: string): Promise<Buffer> {
  const abs = path.join(UPLOAD_ROOT, relPath);
  // prevent traversal
  if (!abs.startsWith(UPLOAD_ROOT)) throw new Error("Invalid path");
  return readFile(abs);
}

export function safeStoredName(relPath: string): string {
  return relPath.split("__").pop() ?? relPath;
}

/** Persist a server-generated file (e.g. a stamped rendition) under ./uploads. */
export async function saveBuffer(
  t: Tenant,
  buf: Uint8Array,
  docNumber: string,
  kind: "NATIVE" | "RENDITION" | "STAMPED" | "EVIDENCE",
  revValue: string,
  uploadedByName?: string,
  uploadedById?: string
): Promise<{ id: string }> {
  const storedName = `${docNumber}_Rev-${revValue}${kind === "RENDITION" ? "" : "_native"}_stamped.pdf`;
  const relPath = path.join(t.projectId, docNumber, `${randomUUID()}__${storedName}`);
  const abs = path.join(UPLOAD_ROOT, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);
  const row = await t.db.storedFile.create({
    data: {
      projectId: t.projectId,
      name: storedName,
      path: relPath,
      size: buf.length,
      mime: "application/pdf",
      sha256: createHash("sha256").update(buf).digest("hex"),
      kind,
      uploadedByName,
      uploadedById,
    },
  });
  return { id: row.id };
}
