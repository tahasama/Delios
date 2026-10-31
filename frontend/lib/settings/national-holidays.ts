import "server-only";
import Holidays from "date-holidays";

export type NationalHoliday = { day: string; name: string };

/**
 * A country's public holidays for a year, as a list that knows them gives them (owner: "some recognise national
 * holidays"; the `date-holidays` package, in English). Only proposed: an administrator reads them, then adds them to the
 * organization's calendar, where each is kept as one marked by hand. A country it does not know gives none.
 */
export function nationalHolidays(country: string, year: number): NationalHoliday[] {
  try {
    const known = new Holidays(country, { languages: ["en"], types: ["public"] });
    const seen = new Set<string>();
    return (known.getHolidays(year, "en") || [])
      .filter((h) => h.type === "public")
      .map((h) => ({ day: h.date.slice(0, 10), name: h.name }))
      .filter((h) => (seen.has(h.day) ? false : (seen.add(h.day), true)));
  } catch {
    return [];
  }
}

/** The same, for every year a project's calendar spans (its country's; none without a country). */
export function knownBetween(country: string | null | undefined, from: string, to: string): NationalHoliday[] {
  if (!country) return [];
  const years = Array.from({ length: +to.slice(0, 4) - +from.slice(0, 4) + 1 }, (_, i) => +from.slice(0, 4) + i);
  return years.flatMap((y) => nationalHolidays(country, y)).filter((h) => h.day >= from && h.day <= to);
}
