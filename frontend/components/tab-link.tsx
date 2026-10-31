"use client";

import Link from "next/link";
import { useLayoutEffect } from "react";

/** Where the window stood when a tab was pressed, put back once the tab it opens is drawn. */
let kept: number | null = null;

/**
 * A tab that leaves the page where it was (owner: "fix the scroll reset on tabs"): the window's place is noted on the
 * press and put back once the tab opened is the one lit, whatever the new answer did to the page's height meanwhile.
 * Everything else is a plain link.
 */
export function TabLink({ active, onClick, ...link }: React.ComponentProps<typeof Link> & { active: boolean }) {
  useLayoutEffect(() => {
    if (!active || kept === null) return;
    const y = kept;
    kept = null;
    window.scrollTo(0, y);
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [active]);
  return (
    <Link
      {...link}
      scroll={false}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        if (!active) kept = window.scrollY;
        onClick?.(event);
      }}
    />
  );
}
