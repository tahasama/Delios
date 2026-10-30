"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Every waiter on the page shares one timer: a page waiting for a file's check and a stamp at once reads itself once
// every few seconds, not twice. Nothing is read while the tab is hidden; coming back reads at once.
const waiters = new Map<symbol, number>();
let timer: number | null = null;
let refresh: (() => void) | null = null;

function tick() {
  if (document.hidden || !refresh) return;
  refresh();
  for (const [key, left] of waiters) {
    if (left <= 1) waiters.delete(key);
    else waiters.set(key, left - 1);
  }
  if (!waiters.size) stop();
}
function onShown() { if (!document.hidden) tick(); }
function stop() {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onShown);
}

/** Reads the page again every `everyMs` while mounted, at most `tries` times. */
export function useRefreshWhile(tries: number, everyMs = 3000) {
  const router = useRouter();
  useEffect(() => {
    const key = Symbol();
    refresh = () => router.refresh();
    waiters.set(key, tries);
    if (timer === null) {
      timer = window.setInterval(tick, everyMs);
      document.addEventListener("visibilitychange", onShown);
    }
    return () => { waiters.delete(key); if (!waiters.size) stop(); };
  }, [router, tries, everyMs]);
}
