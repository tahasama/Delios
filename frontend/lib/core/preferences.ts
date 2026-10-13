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
} as const;

export const SIDEBAR_LIMITS = { min: 76, max: 360, railBelow: 180 } as const;

/** Writes one preference for a year, for the whole site. */
export function savePreference(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
}
