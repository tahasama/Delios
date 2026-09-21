"use client";

import { btn } from "@/components/ui";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className={btn("primary", "sm")}>
      Print / save as PDF
    </button>
  );
}
