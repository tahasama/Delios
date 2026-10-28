/** What the console reads (backend `Operators/ConsoleEndpoints.cs`). */
export type OrgRow = {
  id: string; slug: string; name: string; active: boolean; createdAt: string; state: string; why: string; readsOnly: boolean;
  plan: string | null; trialEndsAt: string | null; paidUntil: string | null; cancelledAt: string | null; users: number; people: number;
  projects: number; storage: number; lastSeen: string | null; supportOpen: boolean; termsToAccept: boolean;
};

export type Subscription = {
  tenantId: string; plan: string | null; state: string; trialEndsAt: string | null; paidUntil: string | null; billing: string | null;
  seats: number | null; contractRef: string | null; contractSignedOn: string | null; providerRef: string | null; notes: string | null;
  cancelledAt: string | null; cancelledBy: string | null; updatedAt: string; updatedBy: string | null;
};

export type Grant = { id: string; tenantId: string; grantedByName: string; why: string; from: string; until: string; endedAt: string | null; endedByName: string | null };
export type OperatorEvent = { id: string; operatorName: string; action: string; tenantId: string | null; detail: string | null; at: string };
export type ProductRequest = { id: string; tenantId: string; organizationName: string; what: string; message: string | null; byName: string; byEmail: string; at: string };
export type Acceptance = { kind: string; version: number; userName: string; userEmail: string; at: string; address?: string | null };

export type Plan = { code: string; name: string; pricePerUser: number | null; currency: string; notes: string | null; active: boolean; organizations: number };

export type LegalTextRow = {
  kind: string; slug: string; title: string; lead: string; version: number; publishedAt: string | null; placeholder: boolean; accepted: boolean;
  lawyerParts: number; acceptedBy: number;
};
export type Matter = {
  key: string; group: string; must: boolean; title: string; what: string; text: string | null; textSlug: string | null; textVersion: number | null;
  textPlaceholder: boolean | null; status: string; set: boolean; note: string | null; updatedAt: string | null; updatedBy: string | null;
};

/** The states of an organization with us (provisional codes, the owner to confirm). */
export const STATE_WORDS: Record<string, string> = { TRIAL: "Trying DELIOS", ACTIVE: "Active", READ_ONLY: "Reads only", ENDED: "Ended" };
export const STATE_TONE: Record<string, string> = {
  TRIAL: "text-sky-700", ACTIVE: "text-emerald-700", READ_ONLY: "text-amber-700", ENDED: "text-slate-500",
};
export const MATTER_WORDS: Record<string, string> = {
  TO_DO: "To do", PLACEHOLDER: "Placeholder text", WITH_LAWYER: "With the lawyer", IN_FORCE: "In force", NOT_NEEDED: "Not needed",
};
export const MATTER_TONE: Record<string, string> = {
  TO_DO: "text-red-700", PLACEHOLDER: "text-amber-700", WITH_LAWYER: "text-sky-700", IN_FORCE: "text-emerald-700", NOT_NEEDED: "text-slate-500",
};

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
