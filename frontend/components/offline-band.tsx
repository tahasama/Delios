"use client";

import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";

/**
 * Said the moment the connection is lost, and taken back when it returns (the browser's own word, `online` / `offline`):
 * a quiet band at the top of the window, taking no room and letting clicks through. Forms refuse to send meanwhile and
 * keep what was written (`ActionForm`), so nothing typed is lost.
 */
export function OfflineBand() {
  const [offline, setOffline] = useState(false);
  const [back, setBack] = useState(false);
  useEffect(() => {
    setOffline(!navigator.onLine);
    let timer: number | undefined;
    const down = () => { setOffline(true); setBack(false); window.clearTimeout(timer); };
    const up = () => { setOffline(false); setBack(true); window.clearTimeout(timer); timer = window.setTimeout(() => setBack(false), 3000); };
    window.addEventListener("offline", down);
    window.addEventListener("online", up);
    return () => { window.removeEventListener("offline", down); window.removeEventListener("online", up); window.clearTimeout(timer); };
  }, []);
  if (!offline && !back) return null;
  return (
    <p role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-2 z-[70] flex justify-center px-4 print:hidden">
      {offline ? (
        <span className="flex max-w-full items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-[11.5px] font-semibold text-white shadow-md dark:bg-slate-100 dark:text-slate-900">
          <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">You are offline. What you write stays on the page; send it once the connection is back.</span>
        </span>
      ) : (
        <span className="flex max-w-full items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11.5px] font-semibold text-emerald-800 shadow-sm ring-1 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-700">
          <Wifi className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">Back online.</span>
        </span>
      )}
    </p>
  );
}
