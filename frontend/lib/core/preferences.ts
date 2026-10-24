/**
 * Display preferences kept in cookies, so the server sends every page already
 * in the right theme and sidebar width: nothing has to run in the page first.
 * They are not secret, and are readable and writable by the page itself.
 */
export const PREF = {
  /** "light", "dark" or "system". */
  theme: "theme",
  /** "1" when the device was in dark mode last time we looked; read for "system". */
  deviceDark: "theme-device-dark",
  /** The desktop sidebar's width in pixels. */
  sidebar: "sidebar",
  /** The review page's document column, in pixels (dragged wider, the side cards go under it). */
  reviewPane: "pane-review",
  /** The stamp card's preview, in pixels. */
  stampPane: "pane-stamp",
  /** The calendar's day, its side in pixels (the whole calendar dragged larger or smaller by its corner). */
  calendarDay: "calendar-day",
  /** "0" when the names of the days off and the actions are not written inside the days. */
  calendarNames: "calendar-names",
  /** "0" once "For viewing only" above a drawing was closed. */
  viewingNote: "viewing-note",
} as const;

/** How large a calendar's day is drawn, its side in pixels: 56 unless dragged, between 28 and 120. */
export const CALENDAR_DAY = { normal: 96, min: 40, max: 200 } as const;

/** The calendar's day size left by the person, read on the server from its cookie. */
export function calendarDay(value: string | undefined): number {
  const h = Number.parseInt(value ?? "", 10);
  return Number.isFinite(h) ? Math.min(CALENDAR_DAY.max, Math.max(CALENDAR_DAY.min, h)) : CALENDAR_DAY.normal;
}

export const SIDEBAR_LIMITS = { min: 76, max: 360, railBelow: 180 } as const;

/** Writes one preference for a year, for the whole site. */
export function savePreference(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
}

/** The width a resizable pane was left at, read on the server from its cookie (`null`: its own width). */
export function paneWidth(value: string | undefined, min = 240): number | null {
  const w = Number.parseInt(value ?? "", 10);
  return Number.isFinite(w) && w >= min ? w : null;
}
