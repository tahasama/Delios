"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/core/utils";

/** The top bar's tools share one size and one look; the one whose pages you are on stays lit. */
export const TOOL = "relative grid h-9 w-9 place-items-center rounded-lg text-slate-500 outline-none transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-link/30";
const LIT = "bg-tint text-brand-ink hover:bg-tint hover:text-brand-ink";

export function ToolLink({ href, label, children, also = [], wide }: {
  href: string; label: string; children: React.ReactNode; also?: string[];
  /** Its words beside the icon on a wide screen. */
  wide?: string;
}) {
  const pathname = usePathname();
  const lit = [href, ...also].some((one) => pathname === one || pathname.startsWith(`${one}/`));
  return (
    <Link href={href} title={label} aria-label={label} aria-current={lit ? "page" : undefined}
      className={cn(TOOL, lit && LIT, wide && "xl:flex xl:w-auto xl:gap-2 xl:px-2.5 xl:text-xs xl:font-semibold")}>
      {children}
      {wide ? <span className="hidden xl:inline">{wide}</span> : null}
    </Link>
  );
}
