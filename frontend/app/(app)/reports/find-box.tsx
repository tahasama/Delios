"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";

/**
 * Finding in the lines of a report: typed words, then Enter or Find (lit only while new words wait). Clear lets go.
 * The download follows what is found, so it is said beside it.
 */
export function FindBox({ value, keep, clearHref }: { value: string; keep: Record<string, string>; clearHref: string }) {
  const [typed, setTyped] = useState(value);
  const waiting = typed.trim() !== value;
  return (
    <form className="flex min-w-0 items-center gap-2" role="search">
      {Object.entries(keep).map(([name, v]) => <input key={name} type="hidden" name={name} value={v} />)}
      <label className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
        <span className="sr-only">Find in these lines</span>
        <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input name="rq" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Find in these lines" className="plain w-full !pl-7" />
      </label>
      <button type="submit" className="ask" data-on={waiting ? "true" : "false"} disabled={!waiting}>Find</button>
      {value ? (
        <Link href={clearHref} scroll={false} className="inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline">
          <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
        </Link>
      ) : null}
    </form>
  );
}
