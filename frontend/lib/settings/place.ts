/** Where a project's site is: its time zone, its days off each week (1 Monday … 7 Sunday) and its country, if any. */
export type Place = { timeZone: string; weekendDays: number[]; country: string | null };

/** What the place fields sent: a time zone, the days off (when the field was there) and a country (empty: none). */
export function readPlace(formData: FormData): { timeZone?: string; weekendDays?: number[]; country?: string } {
  const timeZone = String(formData.get("timeZone") ?? "").trim();
  return {
    ...(timeZone ? { timeZone } : {}),
    ...(formData.has("sendsWeekend") ? { weekendDays: formData.getAll("weekend").map(Number).filter((d) => d >= 1 && d <= 7) } : {}),
    ...(formData.has("country") ? { country: String(formData.get("country") ?? "") } : {}),
  };
}
