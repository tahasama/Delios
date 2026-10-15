/**
 * The PDF people open for a revision: the copy that says where it stands, marked by the backend (Stamping) where the
 * project stamps, else the PDF as it was sent. Void, on hold, superseded, returned, released, then the PDF itself.
 */
const ORDER = ["VOID", "HELD", "SUPERSEDED", "RETURNED", "STAMPED", "RENDITION"];

export function openCopy<F extends { kind: string; status?: string }>(files: F[]): F | null {
  for (const kind of ORDER) {
    const found = files.find((f) => f.kind === kind && (!f.status || f.status === "CLEAN"));
    if (found) return found;
  }
  return null;
}
