"use client";

import { btn } from "@/components/ui";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className={btn("secondary")}>
      Print / save as PDF
    </button>
  );
}
