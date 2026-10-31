"use client";

import { keepPageDateFormat } from "@/lib/core/date-format";

/**
 * Carries how dates read into the browser (and the parts drawn there): set while the layout is drawn, before anything
 * under it, so every date on the page reads the organization's way. Draws nothing.
 */
export function DateFormatKeeper({ value }: { value: string }) {
  keepPageDateFormat(value);
  return null;
}
