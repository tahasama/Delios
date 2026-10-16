import Link from "next/link";
import { PageHeader } from "@/components/ui";

/**
 * A Settings page this person may not open: said plainly, never as an alarm, with who can change it and the way on.
 * Nobody is left on a dead end: Settings itself lists the pages they can use (when there are none, the menu has no
 * Settings link at all).
 */
export function NoAccess({ title, who }: { title: string; who: "admin" | "control" }) {
  const by = who === "admin" ? "an administrator" : "an administrator or the control function";
  return (
    <PageHeader title={title} subtitle={`This page is changed by ${by}. Ask them if something here needs to change.`}>
      <p className="text-xs text-slate-600">
        <Link href="/settings" className="font-semibold text-link hover:underline">Back to Settings</Link> for the pages you can use.
      </p>
    </PageHeader>
  );
}
