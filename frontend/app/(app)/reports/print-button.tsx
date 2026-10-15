"use client";

import { Printer } from "lucide-react";

/** Prints the report as it is shown: its plate, figures, chart and the lines on this page (the menus and controls stay off paper). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="ask inline-flex items-center gap-1.5">
      <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print
    </button>
  );
}
