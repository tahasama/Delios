"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** How a figure is written: what comes before its number, the number, its decimals, whether it groups thousands, what follows. */
function parse(text: string) {
  const m = /^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/s.exec(text);
  if (!m) return null;
  const raw = m[2];
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const dot = raw.indexOf(".");
  return { before: m[1], n, decimals: dot < 0 ? 0 : raw.length - dot - 1, grouped: raw.includes(","), after: m[3] };
}

/** The last figure shown under this id, this session (the browser's own; empty in a private window, which is fine). */
function remembered(key: string): number | null {
  try {
    const v = window.sessionStorage.getItem(key);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}
function remember(key: string, n: number) {
  try { window.sessionStorage.setItem(key, String(n)); } catch { /* kept nowhere: it shows as it is next time */ }
}

/**
 * A figure that counts to its value (owner: "numbers incrementing / decrementing… while keeping the professional
 * elegance"): from the figure last shown under the same id to the new one, 600 ms, fast then settling; from zero only
 * the first time in a session, never on every visit; already right, or the person asked for less motion, it is shown as
 * it is. The page draws the true figure first (server and browser alike), the count starts before the first paint, and a
 * screen reader reads only the true figure. Text around the number ("95%", "€1,240", "12 days") stays as written.
 */
export function CountUp({ value, id, className }: { value: string | number; id: string; className?: string }) {
  const text = String(value);
  const [shown, setShown] = useState(text);
  const frame = useRef<number | null>(null);

  useLayoutEffect(() => {
    const parts = parse(text);
    const key = `count:${id}`;
    if (!parts) { setShown(text); return; }
    const before = remembered(key);
    remember(key, parts.n);
    const from = before ?? 0;
    if (from === parts.n || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(text); return; }
    const write = (n: number) => {
      const fixed = n.toFixed(parts.decimals);
      const body = parts.grouped ? Number(fixed).toLocaleString("en-US", { minimumFractionDigits: parts.decimals, maximumFractionDigits: parts.decimals }) : fixed;
      return `${parts.before}${body}${parts.after}`;
    };
    setShown(write(from));
    const ms = 600;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(t < 1 ? write(from + (parts.n - from) * eased) : text);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [text, id]);

  return (
    <span className={className}>
      <span aria-hidden className="tabular-nums">{shown}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
