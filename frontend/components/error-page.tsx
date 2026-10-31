"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { reportError } from "@/components/report-error";
import { btn } from "@/components/ui";

/**
 * The page shown when a whole frame failed (the app's or the organization's, or even the site's own), in the app's look:
 * a sheet on the canvas, plain words, the reference to quote, and the ways on. Try again reads the page afresh
 * (`again`: a refresh with the boundary let go; the site's own last resort reloads the window, nothing else being left).
 */
export function ErrorPage({ error, again }: { error: Error & { digest?: string }; again: () => void }) {
  // A fault drawn on the server is reported there already (instrumentation.ts, its digest here): only the browser's own.
  useEffect(() => { if (!error.digest) reportError(error); }, [error]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <section role="alert" className="register register-sheet register-sheet-open w-full max-w-lg overflow-hidden">
        <div className="flex items-start gap-3 border-b border-line px-5 pt-5 pb-4 sm:px-6">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="plate-title text-slate-950">This page could not be shown.</h1>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Something went wrong on our side. Nothing you saved is lost, and we have been told. Try again; if it happens
              again, tell support what you were doing.
            </p>
          </div>
        </div>
        {error.digest ? (
          <p className="border-b border-line bg-tint-soft px-5 py-2.5 text-xs text-slate-600 sm:px-6">
            Reference to quote: <span className="font-mono text-slate-900 select-all">{error.digest}</span>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 px-5 py-4 sm:px-6">
          <button type="button" onClick={again} className={btn("primary")}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Try again
          </button>
          {/* Plain links: whatever failed, they load the page whole. */}
          <a href="/" className={btn("secondary")}>Back to Home</a>
          <a href="/guide?support=1" className="ml-auto text-[13px] font-semibold text-link hover:underline">Ask support</a>
        </div>
        {process.env.NODE_ENV === "development" ? (
          <pre className="mx-5 mb-5 overflow-x-auto rounded-md bg-canvas-deep p-3 font-mono text-xs whitespace-pre-wrap text-slate-800 sm:mx-6">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
        ) : null}
      </section>
    </main>
  );
}
