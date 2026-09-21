"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { runChecksAction } from "@/lib/actions/conformance";
import { btn } from "@/components/ui";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function RunChecksButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      className={cn(btn("primary"), pending && "opacity-60")}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await runChecksAction();
          router.refresh();
        })
      }
    >
      <ShieldCheck className="h-4 w-4" />
      {pending ? "Checking…" : "Run the checks"}
    </button>
  );
}
