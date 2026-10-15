import { requireScope } from "@/lib/core/scope";

/**
 * Reports: our own people read them all; another organization's people read their own deliveries against plan
 * (the page offers only that, the backend narrows it to their documents).
 */
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requireScope();
  return children;
}
