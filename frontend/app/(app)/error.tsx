"use client";

import { useEffect } from "react";
import Link from "next/link";
import { reportError } from "@/components/report-error";
import { btn } from "@/components/ui";

/**
 * What went wrong, said on the page, inside the app's frame: the menu and the top bar stay, so the way on is open.
 * Plain words and a reference to quote to support, never the server's own message or code trace (development keeps
 * them, under the plain words, for whoever is building).
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // A fault drawn on the server is reported there already (instrumentation.ts, its digest here): only the browser's own.
  useEffect(() => { if (!error.digest) reportError(error); }, [error]);
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-surface p-6">
      <h1 className="text-base font-semibold text-red-700">This page could not be shown.</h1>
      <p className="mt-1 max-w-xl text-sm text-slate-600">
        Nothing you saved is lost, and the rest of DELIOS works as usual. Try again; if it happens again, tell support what
        you were doing{error.digest ? <> and quote this reference: <span className="font-mono text-slate-800">{error.digest}</span></> : null}.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={reset} className={btn("primary")}>Try again</button>
        <Link href="/" className={btn("secondary")}>Back to Home</Link>
        <Link href="/guide?support=1" className="ml-1 text-[13px] font-semibold text-link hover:underline">Ask support</Link>
      </div>
      {process.env.NODE_ENV === "development" ? (
        <pre className="mt-4 overflow-x-auto rounded-lg bg-canvas-deep p-3 font-mono text-xs whitespace-pre-wrap text-slate-800">
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ""}
        </pre>
      ) : null}
    </div>
  );
}
