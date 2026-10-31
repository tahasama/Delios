"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Draws its children into the element of that id elsewhere on the page (a card of its own, the page's whole width),
 * while they keep the state of the component they belong to; where the page has no such element, in place.
 */
export function InSlot({ id, children }: { id: string; children: React.ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setTarget(document.getElementById(id)), [id]);
  return target ? createPortal(children, target) : <>{children}</>;
}
