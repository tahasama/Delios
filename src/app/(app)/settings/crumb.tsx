"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";

/**
 * Which settings screen this is, read from the address rather than repeated on
 * every page. A screen under one of them (a controlled list, say) shows its
 * parent, so the way back is always one click and never the browser's guess.
 */
export function SettingsCrumb({ pages }: { pages: { href: string; title: string }[] }) {
  const path = usePathname();
  if (!path || path === "/settings") return null;
  const page = pages
    .filter((p) => path === p.href || path.startsWith(`${p.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!page) return null;
  const deeper = path !== page.href;
  return (
    <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      <Link href="/settings" className="inline-flex items-center gap-1 font-semibold text-link hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Settings
      </Link>
      <span aria-hidden className="text-slate-300">/</span>
      {deeper ? (
        <a href={page.href} className="font-semibold text-link hover:underline">{page.title}</a>
      ) : (
        <span className="font-semibold text-slate-700">{page.title}</span>
      )}
      {deeper ? (
        <>
          <span aria-hidden className="text-slate-300">/</span>
          <span className="font-semibold text-slate-700">{path.split("/").filter(Boolean).slice(-1)[0].replaceAll("_", " ").replaceAll("-", " ")}</span>
        </>
      ) : null}
    </nav>
  );
}
