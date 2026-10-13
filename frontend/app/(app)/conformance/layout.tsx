import { requireInternalScope } from "@/lib/core/scope";

/** Our own organization's section: another organization never reaches it. */
export default async function InternalOnlyLayout({ children }: { children: React.ReactNode }) {
  await requireInternalScope();
  return children;
}
