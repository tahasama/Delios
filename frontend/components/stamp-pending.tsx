"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Just released: the stamped copy is made by the worker a few seconds later. The page reads itself again every few
 * seconds until it is there (a minute at most), so the PDF shown is the stamped one without a reload by hand.
 */
export function StampPending() {
  const router = useRouter();
  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      router.refresh();
      if (tries >= 20) clearInterval(timer);
    }, 3000);
    return () => clearInterval(timer);
  }, [router]);
  return <p className="px-5 py-2 text-[11px] text-slate-500 sm:px-6">The stamped copy is being made: it shows here in a few seconds.</p>;
}
