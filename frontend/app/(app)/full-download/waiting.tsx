"use client";

import { useRefreshWhile } from "@/components/refresh-while";

/** While a download is being made, the page reads itself again now and then (ten minutes at most): it shows when ready. */
export function StillMaking() {
  useRefreshWhile(60, 10_000);
  return null;
}
