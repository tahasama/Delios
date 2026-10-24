/** A file just uploaded is shown once the virus check has passed it: whether one of the newest is still being checked. */
export function checking(files: { status?: string; submission?: number }[]): string[] {
  const newest = Math.max(0, ...files.map((f) => f.submission ?? 0));
  return files.filter((f) => (f.submission ?? 0) === newest && (f.status === "PROCESSING" || f.status === "AWAITING_UPLOAD"))
    .map((f) => (f as { name?: string }).name ?? "The file");
}
