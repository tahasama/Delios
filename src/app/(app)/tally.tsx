"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A figure in the greeting band, which counts up to its value once.
 *
 * The number is rendered at its true value on the server, so the page is
 * complete and correct before any script runs; the count is an entrance, not
 * the source of the figure. It is skipped entirely when the reader has asked
 * for reduced motion.
 */
export function Count({ value, unit, delay = 0 }: { value: number; unit?: string; delay?: number }) {
  const [shown, setShown] = useState(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (value <= 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ms = 900;
    let start: number | null = null;
    setShown(0);
    const step = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start - delay) / ms);
      if (t < 0) {
        frame.current = requestAnimationFrame(step);
        return;
      }
      // Fast, then settling: the figure lands rather than creeps.
      setShown(Math.round(value * (1 - Math.pow(1 - t, 4))));
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [value, delay]);

  return (
    <span className="block font-mono text-[27px] leading-none font-semibold tracking-tight tabular-nums">
      {shown}
      {unit ? <span className="ml-0.5 text-sm font-medium opacity-70">{unit}</span> : null}
    </span>
  );
}
