/** A file just uploaded is shown once the virus check has passed it: whether one of the newest is still being checked. */
export function checking(files: { status?: string; submission?: number }[]): string[] {
  const newest = Math.max(0, ...files.map((f) => f.submission ?? 0));
  return files.filter((f) => (f.submission ?? 0) === newest && (f.status === "PROCESSING" || f.status === "AWAITING_UPLOAD"))
    .map((f) => (f as { name?: string }).name ?? "The file");
}

/** The newest files the check refused, each with why (a virus, a password, too much inside to check, the wrong size). */
export function refused(files: { status?: string; submission?: number; name?: string; statusDetail?: string | null }[]): { name: string; why: string }[] {
  const newest = Math.max(0, ...files.map((f) => f.submission ?? 0));
  return files.filter((f) => (f.submission ?? 0) === newest && (f.status === "INFECTED" || f.status === "REJECTED"))
    .map((f) => ({ name: f.name ?? "The file", why: f.statusDetail ?? "It did not pass the virus check." }));
}
