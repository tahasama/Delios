"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Just uploaded (owner: "the preview does not refresh unless the page is refreshed by hand"): the page reads itself
 * again every few seconds while the file is checked (three minutes at most), so the Preview shows it on its own.
 */
export function FilesChecking({ names }: { names: string[] }) {
  const router = useRouter();
  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      router.refresh();
      if (tries >= 60) clearInterval(timer);
    }, 3000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <p className="px-5 py-2 text-[11px] text-slate-500 sm:px-6">
      {names.join(", ")} {names.length === 1 ? "is" : "are"} being checked for viruses: {names.length === 1 ? "it shows" : "they show"} here in a moment.
    </p>
  );
}
