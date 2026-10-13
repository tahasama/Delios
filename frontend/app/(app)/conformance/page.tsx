import { redirect } from "next/navigation";

/**
 * What to fix was the catalogue filtered to what failed, which is what the
 * catalogue's own filters now do. The address is kept because links, bookmarks
 * and older notifications point at it.
 */
export default async function WhatToFixPage({ searchParams }: { searchParams: Promise<{ owner?: string; check?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.check) q.set("check", sp.check);
  else {
    q.set("result", "FAIL");
    if (sp.owner) q.set("owner", sp.owner);
  }
  redirect(`/conformance/checks?${q}`);
}
