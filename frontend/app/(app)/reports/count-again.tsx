"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { countReportAgainAction } from "@/lib/conformance/forms";
import { btn } from "@/components/ui";
import { cn } from "@/lib/core/utils";

/** A report stays as it was counted until someone counts it again, for everyone (owner: as the checks). */
export function CountAgainButton({ id, query }: { id: string; query: Record<string, string> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={cn(btn("secondary"), pending && "opacity-60")}
        disabled={pending}
        title="Count this report again, for everyone who reads it"
        onClick={() =>
          start(async () => {
            const answer = await countReportAgainAction(id, query);
            setError(answer.error ?? null);
            router.refresh();
          })
        }
      >
        <RefreshCw className={cn("h-3.5 w-3.5", pending && "animate-spin")} aria-hidden="true" />
        {pending ? "Counting…" : "Count again"}
      </button>
      {error ? <span className="text-[12px] text-rose-700">{error}</span> : null}
    </span>
  );
}
