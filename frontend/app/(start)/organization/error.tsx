"use client";

import { useEffect } from "react";
import { reportError } from "@/components/report-error";
import { useTryAgain } from "@/components/try-again";

/**
 * A read that failed on the organization's pages, said as it is: never shown as "nothing set" or "none", which an
 * administrator would take for a fact. Nothing was changed; trying again reads everything afresh.
 */
export default function OrganizationError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // A fault drawn on the server is reported there already (instrumentation.ts, its digest here): only the browser's own.
  useEffect(() => { if (!error.digest) reportError(error); }, [error]);
  const again = useTryAgain(reset);
  return (
    <section role="alert" className="register register-sheet register-sheet-open px-5 py-5 sm:px-6">
      <h1 className="plate-title text-red-700">This page could not be read.</h1>
      <p className="plate-meta mt-1.5 font-normal">
        The server did not answer as it should, so nothing on it can be trusted until it is read again. Nothing was changed.
      </p>
      <p className="mt-3 rounded-md bg-tint-soft px-3 py-2 font-mono text-xs whitespace-pre-wrap text-slate-700">
        {error.message}{error.digest ? ` · ${error.digest}` : ""}
      </p>
      <button type="button" onClick={again} data-on="true" className="ask mt-3">Try again</button>
    </section>
  );
}
