import Link from "next/link";
import { api } from "@/lib/api/client";
import type { RegisterPage, RouteView } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { SendForReview } from "../../documents/[id]/acts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Send for review" };

/**
 * Sending revisions for review, several at once: every document whose newest
 * revision is being prepared (or only the ones chosen in the register), each
 * with the route the organization's rules pick for it.
 */
export default async function SendPage({ searchParams }: { searchParams: Promise<{ revisions?: string }> }) {
  const session = await requireSession();
  const chosen = new Set(((await searchParams).revisions ?? "").split(",").filter(Boolean));
  const register = await api<RegisterPage>(projectPath(session, "/register"), { query: { rev: "IN_PREPARATION", per: 250, sort: "docNumber", dir: "asc" } });
  const rows = register.rows.filter((r) => r.latestRevisionId && (chosen.size === 0 || chosen.has(r.latestRevisionId)));
  const routes = await Promise.all(rows.map((r) => api<RouteView[]>(projectPath(session, `/documents/${r.id}/routes`)).catch(() => [] as RouteView[])));
  return (
    <div className="space-y-4">
      <PageHeader title="Send for review" subtitle={chosen.size ? "The revisions you chose in the register." : "Every revision being prepared on this project."} />
      {rows.length === 0 ? <EmptyState title="Nothing to send" body="A revision can be sent once its files are uploaded and scanned." /> : null}
      {rows.map((r, i) => (
        <Card key={r.id} title={`${r.number} rev ${r.revision}`} description={r.title}>
          {routes[i].length ? <SendForReview documentId={r.id} revisionId={r.latestRevisionId!} routes={routes[i]} />
            : <p className="text-xs text-slate-500">No review route serves this document. <Link href={`/documents/${r.id}`} className="font-semibold text-link hover:underline">Open it</Link></p>}
        </Card>
      ))}
    </div>
  );
}
