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

/**
 * What the supplier may say its document is issued for (IFI, IFR, IFA…): the published statuses that do not
 * let work go ahead — those are granted by our review, never sent in — with the usual one chosen first.
 */
export async function supplierStatusChoices(reasonCode?: string): Promise<{ options: { code: string; label: string }[]; initial: string }> {
  const statuses = await getActiveSet("STATUSES");
  const options = statuses.filter((s) => s.props.executes !== true).map((s) => ({ code: s.code, label: s.label }));
  return { options, initial: await sentFor(reasonCode ?? (await supplyReason())?.code ?? "") };
}

/** The status the supplier chose, if it is one it may choose; else the usual one for the reason. */
export async function chosenSupplierStatus(formData: FormData, reasonCode?: string): Promise<string> {
  const { options, initial } = await supplierStatusChoices(reasonCode);
  const picked = String(formData.get("status") ?? "");
  return options.some((one) => one.code === picked) ? picked : initial;
}
