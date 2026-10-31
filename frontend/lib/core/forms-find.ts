"use server";

import { requireScope } from "@/lib/core/scope";
import { api, projectPath } from "@/lib/client";
import { transmittalLog } from "@/lib/transmittals/api";
import { planPage } from "@/lib/actions/api";
import { packagesOf } from "@/lib/packages/api";

/** One thing the quick find found: what it is, its number and name, where it opens. */
export type Found = { kind: "document" | "transmittal" | "action" | "package"; label: string; detail: string; href: string };

/**
 * The quick find (Ctrl K, owner): a few words find documents, transmittals, actions and packages at once, each read
 * through the backend as the person may read it (documents by their number and title only, never their files; another
 * organization's people only what is theirs). A handful of each, the first matches; the register and the lists hold
 * the rest. Nothing below two characters is looked for.
 */
export async function quickFindAction(words: string): Promise<Found[]> {
  const q = words.trim();
  if (q.length < 2) return [];
  const ctx = await requireScope();
  const lower = q.toLowerCase();
  const [documents, transmittals, actions, packages] = await Promise.all([
    api<{ items: { id: string; number: string; title: string; latestRevision: string | null }[] }>(
      projectPath(ctx, "/search"), { query: { q, limit: "6" } }).then((r) => r.items).catch(() => []),
    transmittalLog(ctx, { q, per: "6" }).then((r) => r.rows).catch(() => []),
    planPage(ctx, { q, view: "table", per: 6, all: "1" }).then((r) => r.actions).catch(() => []),
    Promise.all([packagesOf(ctx, "DELIVERY").catch(() => []), packagesOf(ctx, "SUPPLY").catch(() => [])])
      .then(([delivery, supply]) => [...delivery, ...supply]
        .filter((p) => p.number.toLowerCase().includes(lower) || p.title.toLowerCase().includes(lower)).slice(0, 6)),
  ]);
  return [
    ...documents.map((d): Found => ({ kind: "document", label: d.number, detail: [d.title, d.latestRevision ? `rev ${d.latestRevision}` : null].filter(Boolean).join(" · "), href: `/documents/${d.id}` })),
    ...transmittals.map((t): Found => ({ kind: "transmittal", label: t.number, detail: t.subject, href: `/transmittals/${t.id}` })),
    ...actions.map((a): Found => ({ kind: "action", label: a.code, detail: [a.name, a.externalId].filter(Boolean).join(" · "), href: `/actions/${a.code}` })),
    ...packages.map((p): Found => ({ kind: "package", label: p.number, detail: p.title, href: `/packages/${p.number}` })),
  ];
}
