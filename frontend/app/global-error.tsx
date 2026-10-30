"use client";

import { useEffect } from "react";
import { reportError } from "@/components/report-error";
import "./globals.css";

/** The last resort, when even the page's frame failed: said plainly, reported (a server fault is reported already). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { if (!error.digest) reportError(error); }, [error]);
  return (
    <html lang="en">
      <body className="bg-canvas p-8">
        <h1 className="text-base font-semibold text-red-700">Something went wrong on our side.</h1>
        <p className="mt-1 text-sm text-slate-600">Nothing was saved by this page. We have been told; try again in a moment.</p>
        <button type="button" onClick={reset} className="ask mt-4">Try again</button>
      </body>
    </html>
  );
}
