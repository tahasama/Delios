/** Dates as the package screens show them. */
export function day(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

/** How each package state reads, and its colour. The states are the backend's (PackageStates). */
export const PACKAGE_STATES: Record<string, { label: string; tone: string }> = {
  OPEN: { label: "open", tone: "bg-slate-100 text-slate-600" },
  DELIVERED: { label: "delivered — to accept", tone: "bg-sky-100 text-sky-800" },
  CLOSED: { label: "closed — to accept", tone: "bg-sky-100 text-sky-800" },
  ACCEPTED: { label: "accepted", tone: "bg-emerald-100 text-emerald-800" },
};
