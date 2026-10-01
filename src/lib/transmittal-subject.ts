/**
 * The subject a transmittal is given when nobody wrote one: what it is for, and
 * what it carries. "For review — P1001-50-CI-DSW-00001 and 2 more". An outgoing
 * transmittal always has a subject — it is the first thing the recipient reads.
 */
export function subjectFor(reasonLabel: string | null | undefined, docNumbers: string[]): string {
  const why = reasonLabel ? `For ${reasonLabel.charAt(0).toLowerCase()}${reasonLabel.slice(1)}` : "Transmittal";
  if (!docNumbers.length) return why;
  return `${why} — ${docNumbers[0]}${docNumbers.length > 1 ? ` and ${docNumbers.length - 1} more` : ""}`;
}
