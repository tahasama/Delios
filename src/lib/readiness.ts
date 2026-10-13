/**
 * Does this document meet what the action asks of it? The backend answers it
 * (whether the released revision serves the need's purpose) and the revision
 * carries that answer; without one, the status is compared as it always was.
 */
export function meetsRequirement(
  revisions: { statusCode: string | null; meets?: boolean }[],
  requiredStatus: string,
): boolean {
  return revisions[0]?.meets ?? revisions[0]?.statusCode === requiredStatus;
}
