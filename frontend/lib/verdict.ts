import { getSet } from "./config";

// The one decision on a revision in review: its binding verdict. A binding
// verdict that permits release is recorded as the release approval, under the
// approval authority rule — so a verdict and an approval can never disagree.
// Kept free of request-only imports so scripts can run the same rule.

/**
 * What a verdict code means, from the set the cycle uses. `proceed` is the
 * published property that decides whether the verdict permits release.
 */
export async function verdictMeaning(_t: unknown, setKey: string | null | undefined, code: string) {
  const row = (await getSet(setKey ?? "REVIEW_OUTCOMES")).find((one) => one.code === code && one.status === "ACTIVE");
  if (!row) return null;
  const props = row.props as { proceed?: boolean; resubmit?: boolean; advice?: boolean; blocking?: boolean; comments?: string };
  return {
    code: row.code,
    label: row.label,
    proceed: props.proceed === true,
    resubmit: props.resubmit === true,
    // Advice, from an advisory step's own list: it says what the adviser's
    // comments amount to, and never returns the document by itself.
    advice: props.advice === true,
    blocking: props.blocking === true,
    comments: typeof props.comments === "string" ? props.comments : null,
  };
}

