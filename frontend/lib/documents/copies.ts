/**
 * The PDF people open for a revision: the copy that says where it stands, marked by the backend (Stamping) where the
 * project stamps, else the PDF as it was sent. Void, on hold, superseded, returned, released, then the PDF itself.
 */
const ORDER = ["VOID", "HELD", "SUPERSEDED", "RETURNED", "STAMPED", "RENDITION"];

export function openCopy<F extends { kind: string; status?: string; submission?: number }>(files: F[]): F | null {
  // Only the newest submission counts: a copy marked on an earlier one (returned, then corrected) is not what stands now.
  const newest = Math.max(...files.map((f) => f.submission ?? 0));
  const these = files.filter((f) => (f.submission ?? 0) === newest);
  for (const kind of ORDER) {
    const found = these.find((f) => f.kind === kind && (!f.status || f.status === "CLEAN"));
    if (found) return found;
  }
  return null;
}
