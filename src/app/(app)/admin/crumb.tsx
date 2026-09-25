"use client";

import { usePathname } from "next/navigation";

/**
 * Which settings screen this is, read from the address rather than repeated on
 * every page. A screen under one of them (a controlled list, say) shows its
 * parent, so the way back is always one click and never the browser's guess.
 */
export function AdminCrumb({ pages }: { pages: { href: string; title: string }[] }) {
  const path = usePathname();
  if (!path || path === "/admin") return null;
  const page = pages
    .filter((p) => path === p.href || path.startsWith(`${p.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!page) return null;
  const deeper = path !== page.href;
  return (
    <>
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
    </>
  );
}
