import { requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { adminAudit, adminProjects, orEmpty } from "@/lib/settings/api-admin";
import { Logbook, readingLine } from "@/components/logbook";
import { AUDIT_KINDS } from "@/lib/core/rails";
import Link from "next/link";
import { inputCls } from "@/components/ui";
import { NoAccess } from "../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit trail" };

type Search = { q?: string; kind?: string; action?: string; project?: string; from?: string; to?: string; page?: string };

/**
 * The log: what was done, to what, by whom, on the day it happened (the logbook, `components/logbook.tsx`). Every
 * narrowing (kind, act, project, words, dates) is answered by the backend, and the pager goes further back, so nothing
 * older is silently left out. Administrators only.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { user } = await requireScope();
  if (!isAdmin(user)) return <NoAccess title="Audit trail" who="admin" />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [log, projects] = await Promise.all([
    adminAudit({ q: sp.q, kind: sp.kind, action: sp.action, projectId: sp.project, from: sp.from, to: sp.to, page, per: 50 }).catch(() => null),
    orEmpty(adminProjects),
  ]);
  const address = (q: Search) => {
    const next = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1] && !(e[0] === "page" && e[1] === "1")));
    return `/settings/audit${next.size ? `?${next}` : ""}`;
  };
  const words = { q: sp.q, project: sp.project, from: sp.from, to: sp.to };

  return (
    <Logbook
      title={<h1 className="dispatch-title">Audit trail</h1>}
      lede={<p>
        Every controlled act, in the order it happened: who did it, what it was done to, and when. The evidence for one
        document is on the document; this is the whole memory. What is kept about reading and sign-ins is the
        organization&rsquo;s choice (<Link href="/organization/settings/tracking" className="font-semibold text-link hover:underline">organization&rsquo;s page</Link>).
      </p>}
      reading={log ? readingLine({ from: sp.from, to: sp.to, kindLabel: AUDIT_KINDS.find((k) => k.key === sp.kind)?.label, q: sp.q })
        : "The audit trail could not be read just now. Try again in a moment."}
      acts={log?.rows ?? []}
      counts={log?.actions ?? []}
      chosen={{ kind: sp.kind, action: sp.action }}
      href={(q) => address({ ...words, kind: q.kind, action: q.action, page: q.page ? String(q.page) : undefined })}
      find={{
        q: sp.q, from: sp.from, to: sp.to, hidden: { kind: sp.kind, action: sp.action }, clear: address({ kind: sp.kind, action: sp.action }),
        extra: projects.length > 1 ? (
          <select name="project" defaultValue={sp.project ?? ""} className={inputCls} aria-label="Project">
            <option value="">Every project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        ) : null,
      }}
      paging={{ page: log?.page ?? 1, pages: log?.pages ?? 1, total: log?.total ?? 0 }}
    />
  );
}
