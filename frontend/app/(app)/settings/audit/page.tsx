import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { DataTable, Th, Td } from "@/components/ui";
import { fmtDate } from "@/lib/core/utils";
import { fromToday } from "@/lib/core/days";
import { DateWindow } from "@/components/date-window";
import { adminAudit, adminProjects, orEmpty } from "@/lib/settings/api-admin";
import { activityLink, activityWords } from "@/lib/settings/activity-words";
import { AUDIT_RAIL } from "@/lib/core/rails";
import { NoAccess } from "../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit trail" };

type Search = { q?: string; kind?: string; project?: string; from?: string; to?: string; page?: string };

/**
 * The audit trail: every act kept, newest first, the Schedule's way — the plate saying what it holds, the narrowing
 * (kind of act, project, words, dates) answered by the backend, then the table with each act's side colour by its
 * kind (`AuditKinds`, the key on Help), paged by 50. Who did it opens their activity; what it was done to opens it.
 * Administrators only.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { user } = await requireScope();
  if (!isAdmin(user)) return <NoAccess title="Audit trail" who="admin" />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [log, projects] = await Promise.all([
    adminAudit({ q: sp.q, kind: sp.kind, projectId: sp.project, from: sp.from, to: sp.to, page, per: 50 }).catch(() => null),
    orEmpty(adminProjects),
  ]);
  const href = (q: Search) => {
    const next = new URLSearchParams(Object.entries({ ...q, page: q.page && q.page !== "1" ? q.page : undefined })
      .filter((e): e is [string, string] => !!e[1]));
    return `/settings/audit${next.size ? `?${next}` : ""}`;
  };
  const keep = { q: sp.q, kind: sp.kind, project: sp.project, from: sp.from, to: sp.to };
  const all = log?.kinds.reduce((n, k) => n + k.count, 0) ?? 0;
  const narrowed = !!(sp.q || sp.from || sp.to || sp.kind || sp.project);
  const from = log ? (log.page - 1) * log.per + 1 : 0;
  const to = log ? Math.min(log.total, log.page * log.per) : 0;

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        {/* The plate: what it holds. */}
        <div className="px-5 pt-6 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Audit trail</h1>
          <p className="plate-meta mt-2">
            {log ? `${all.toLocaleString("en-GB")} acts${narrowed ? " match" : " kept"} · every project of the organization` : "—"}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            Every act kept, newest first: who did it, what to, and when. Nothing in it can be changed or taken out. What
            is kept about reading and sign-ins is the organization&rsquo;s choice (<Link href="/organization#tracking" className="font-semibold text-link hover:underline">organization&rsquo;s page</Link>).
          </p>
          {!log ? (
            <p role="alert" className="mt-2 w-fit rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">The audit trail could not be read just now. Try again in a moment.</p>
          ) : null}
        </div>

        {log ? (
          <>
            {/* The narrowing: the kind of act, each with its side colour and count; the project; words and dates. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-2.5 text-xs sm:px-6">
              <span className="stencil mr-1 text-slate-500">What</span>
              <Link href={href({ ...keep, kind: undefined })} data-on={!sp.kind} className="ask">All</Link>
              {log.kinds.filter((k) => k.count > 0 || sp.kind === k.key).map((k) => (
                <Link key={k.key} href={href({ ...keep, kind: k.key })} data-on={sp.kind === k.key} className="ask">
                  <span aria-hidden className={`${AUDIT_RAIL[k.key] ?? "rail-none"} h-2.5 w-1 rounded-full bg-(--rail)`} />
                  {k.label} <span className="font-mono tabular-nums opacity-70">{k.count.toLocaleString("en-GB")}</span>
                </Link>
              ))}
            </div>
            {projects.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-2.5 text-xs sm:px-6">
                <span className="stencil mr-1 text-slate-500">Project</span>
                <Link href={href({ ...keep, project: undefined })} data-on={!sp.project} className="ask">Any</Link>
                {projects.map((p) => (
                  <Link key={p.id} href={href({ ...keep, project: p.id })} data-on={sp.project === p.id} className="ask">{p.code}</Link>
                ))}
              </div>
            ) : null}
            <form className="asking flex flex-wrap items-center gap-2 border-t border-line px-5 py-2.5 text-xs sm:px-6">
              {sp.kind ? <input type="hidden" name="kind" value={sp.kind} /> : null}
              {sp.project ? <input type="hidden" name="project" value={sp.project} /> : null}
              <span className="stencil mr-1 text-slate-500">Find</span>
              <input name="q" defaultValue={sp.q ?? ""} placeholder="a number, a person, words in the detail" aria-label="Find in the audit trail" className="plain w-72 max-w-full" />
              <DateWindow fields={[{ code: "ts", label: "The day it happened" }]} on={sp.from ? "ts" : ""} from={sp.from ?? ""} to={sp.to ?? ""} />
              <button className="ask" data-on={sp.q || sp.from || sp.to ? "true" : "false"}>Find</button>
              {sp.q || sp.from || sp.to ? <Link href={href({ kind: sp.kind, project: sp.project })} className="font-semibold text-link hover:underline">Clear</Link> : null}
            </form>

            {/* The table directly under it, each act on the side colour of its kind. */}
            <DataTable className="rounded-none border-0 shadow-none" toolbar={false}
              head={<tr><Th className="rail-head">When</Th><Th>Who</Th><Th>What</Th><Th>On</Th><Th>Project</Th><Th>More</Th></tr>}>
              {log.rows.length ? log.rows.map((e) => {
                const link = activityLink(e.entityType, e.entityId);
                return (
                  <tr key={e.id} className="align-top">
                    <Td className={`rail ${AUDIT_RAIL[e.kind] ?? "rail-none"} whitespace-nowrap text-xs`}>
                      <span title={new Date(e.at).toLocaleString("en-GB")}>{fromToday(e.at.slice(0, 10)) ?? fmtDate(e.at)}</span>
                      <span className="block font-mono text-[11px] tabular-nums text-slate-500">{new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                    </Td>
                    <Td className="text-xs">
                      {e.actorId
                        ? <Link href={`/settings/users/${e.actorId}`} className="font-medium text-slate-800 hover:text-link hover:underline" title={`What ${e.actorName} did`}>{e.actorName}</Link>
                        : <span className="text-slate-500">{e.actorName}</span>}
                    </Td>
                    <Td className="text-xs font-medium text-slate-800">{activityWords(e.action)}</Td>
                    <Td className="text-xs">
                      {e.entityLabel
                        ? link ? <Link href={link} className="font-mono font-semibold text-brand-ink hover:underline">{e.entityLabel}</Link> : <span className="font-mono">{e.entityLabel}</span>
                        : "—"}
                    </Td>
                    <Td className="text-xs">{e.project ?? "—"}</Td>
                    <Td className="whitespace-pre-line text-xs leading-5 text-slate-600">{e.detail ?? "—"}</Td>
                  </tr>
                );
              }) : (
                <tr><Td colSpan={6} className="text-xs text-slate-500">{narrowed ? "Nothing kept matches this." : "Nothing kept yet: acts appear here as they happen."}</Td></tr>
              )}
            </DataTable>

            {log.total > 0 ? (
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-line px-5 py-2.5 sm:px-6">
                <p className="font-mono text-[11px] tabular-nums text-slate-500">
                  {from.toLocaleString("en-GB")}–{to.toLocaleString("en-GB")}
                  <span className="ml-1.5 font-sans text-slate-500">of {log.total.toLocaleString("en-GB")}</span>
                </p>
                {log.pages > 1 ? (
                  <span className="flex items-center gap-2">
                    {log.page > 1
                      ? <Link href={href({ ...keep, page: String(log.page - 1) })} aria-label="Previous page" className="rounded-sm p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-ink"><ChevronLeft className="h-4 w-4" /></Link>
                      : <span className="p-1 text-slate-300"><ChevronLeft className="h-4 w-4" /></span>}
                    <span className="font-mono text-[11px] tabular-nums text-slate-500">{log.page} of {log.pages}</span>
                    {log.page < log.pages
                      ? <Link href={href({ ...keep, page: String(log.page + 1) })} aria-label="Next page" className="rounded-sm p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-ink"><ChevronRight className="h-4 w-4" /></Link>
                      : <span className="p-1 text-slate-300"><ChevronRight className="h-4 w-4" /></span>}
                  </span>
                ) : <span />}
                <span />
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
