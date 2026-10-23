import { cache } from "react";

/**
 * How dates read, the organization's choice (Settings, How dates read; backend `Settings/DateFormat.cs`). Every answer of
 * the backend carries it (`X-Delios-Date-Format`): on the server it is kept for the request being drawn, in the browser
 * for the page, so `fmtDate` reads it wherever it runs. Nothing known yet: 05 Mar 2026.
 */
export type DateFormatCode = "DMY_SHORT" | "DMY" | "MDY" | "ISO";

export const DATE_FORMATS: { code: DateFormatCode; label: string; example: string }[] = [
  { code: "DMY_SHORT", label: "Day, month in letters, year", example: "05 Mar 2026" },
  { code: "DMY", label: "Day / month / year", example: "05/03/2026" },
  { code: "MDY", label: "Month / day / year", example: "03/05/2026" },
  { code: "ISO", label: "Year-month-day", example: "2026-03-05" },
];

const known = (value: string | null | undefined): value is DateFormatCode => DATE_FORMATS.some((one) => one.code === value);

/** The request being drawn on the server: one store per request (outside one, a fresh store each time, which holds nothing). */
const request = cache((): { value?: DateFormatCode } => ({}));
/** In the browser, the page's; set by the layout before anything under it is drawn. */
let page: DateFormatCode | undefined;

/** Kept for the request being drawn, from an answer of the backend. */
export function keepRequestDateFormat(value: string | null | undefined) {
  if (!known(value)) return;
  try { request().value = value; } catch { /* outside a request: nothing to keep */ }
}

/** Kept for the page in the browser (and while it is drawn on the server). */
export function keepPageDateFormat(value: string | null | undefined) {
  if (known(value)) page = value;
}

/** How dates read here and now. */
export function dateFormat(): DateFormatCode {
  let value: DateFormatCode | undefined;
  try { value = request().value; } catch { value = undefined; }
  return value ?? page ?? "DMY_SHORT";
}

/** A day as the organization reads it. */
export function formatDay(date: Date, format: DateFormatCode = dateFormat()): string {
  switch (format) {
    case "DMY": return date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
    case "MDY": return date.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", year: "numeric" });
    case "ISO": return date.toLocaleDateString("en-CA", { day: "2-digit", month: "2-digit", year: "numeric" });
    default: return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
}
