"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Whether the band has already arrived in this page load.
 *
 * It lives in the module, not on the document, because every figure asks the
 * question in the same render: a mark written by the first one would be found
 * by the other three, and only the first would ever count. Module state is
 * reset by a real page load and survives navigation between aspects, which is
 * exactly when the entrance should and should not play.
 */
let arrived = false;

/**
 * A figure in the greeting band, which counts up to its value once.
 *
 * It renders zero — on the server and on the client's first pass alike — and
 * climbs from there once the page is live. That symmetry is the point: an
 * earlier version rendered the true figure and rewrote it before hydration,
 * which React reads as a tree that no longer matches its own HTML. It then
 * regenerates the page, and a regenerated page looks exactly like a reload.
 *
 * Because the markup starts at zero, the true figure is also written in a
 * <noscript> beside it, so a reader without scripts sees the number rather
 * than a nought.
 */
export function Count({ value, unit, delay = 0 }: { value: number; unit?: string; delay?: number }) {
  // Read while the whole band is rendering, so every figure gets the same
  // answer; the mark is set once they have all mounted.
  const play = useRef(!arrived);
  const [shown, setShown] = useState(play.current ? 0 : value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    arrived = true;
    // The mark suppresses the entrance, and the light crossing the band is part
    // of it: set on mount, it cut the sheen off mid-sweep. It is set once the
    // whole entrance has had time to finish.
    const done = window.setTimeout(() => {
      document.documentElement.dataset.homeSeen = "1";
    }, 2200);
    if (value <= 0) return () => window.clearTimeout(done);
    if (!play.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return () => window.clearTimeout(done);
    }
    const ms = 900;
    let start: number | null = null;
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
      window.clearTimeout(done);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [value, delay]);

  return (
    <span className="block font-mono text-[27px] leading-none font-semibold tracking-tight tabular-nums">
      {shown}
      {unit ? <small className="ml-0.5 text-sm font-medium opacity-70">{unit}</small> : null}
      <noscript>
        {value}
        {unit ?? ""}
      </noscript>
    </span>
  );
}
