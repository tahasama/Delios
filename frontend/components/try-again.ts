"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Try again that really tries again (owner: "that Try Again button does absolutely nothing unless manually clicking on
 * refresh"): an error boundary's `reset` alone only draws the same failed answer again; the page's server part has to be
 * read afresh first, then the boundary let go, in one transition.
 */
export function useTryAgain(reset: () => void) {
  const router = useRouter();
  return () => startTransition(() => { router.refresh(); reset(); });
}
