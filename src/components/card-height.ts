"use client";

import { useEffect, useState } from "react";
import { CARD_KEY, PLAN_CARD_HEIGHT } from "@/lib/plan-card";

/**
 * One height for every register's card.
 *
 * The schedule's plan decides it: it is drawn a fixed number of bars tall, its
 * card is measured while it is on screen, and the number is kept. Every other
 * register — documents, transmittals, reviews — is then the same height, so
 * moving between them moves nothing on the page.
 *
 * A browser that has never opened the plan has no number, and those registers
 * fall back to filling the window as they always did.
 */
export { CARD_KEY, PLAN_FIRST, PLAN_ROW, CARD_CHROME, PLAN_CARD_HEIGHT } from "@/lib/plan-card";

export function useCardHeight(): number {
  const [height, setHeight] = useState<number>(PLAN_CARD_HEIGHT);
  useEffect(() => {
    try {
      const kept = Number(localStorage.getItem(CARD_KEY));
      if (kept >= PLAN_CARD_HEIGHT) setHeight(kept);
      else if (kept > 0) localStorage.removeItem(CARD_KEY);
    } catch {
      // A browser that refuses storage simply takes the standard height.
    }
  }, []);
  return height;
}
