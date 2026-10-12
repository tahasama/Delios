import { getActiveSet } from "@/lib/config";

/** What a supplier's submission comes for: approval where the organization publishes it. */
export async function supplyReason() {
  const reasons = await getActiveSet("REASONS_FOR_ISSUE");
  return reasons.find((r) => /APPROV/i.test(r.code)) ?? reasons.find((r) => r.props.response === true) ?? reasons[0];
}

/** The status a submission is sent for, read from its reason: "For approval" → "Issued for approval". */
export async function sentFor(reasonCode: string): Promise<string> {
  const [reasons, statuses] = await Promise.all([getActiveSet("REASONS_FOR_ISSUE"), getActiveSet("STATUSES")]);
  const words = (reasons.find((r) => r.code === reasonCode)?.label ?? "").toLowerCase();
  return (statuses.find((s) => words && s.label.toLowerCase().endsWith(words))
    ?? statuses.find((s) => s.props.executes === false) ?? statuses[0])?.code ?? "";
}
