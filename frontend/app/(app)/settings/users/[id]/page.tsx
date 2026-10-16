import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { api } from "@/lib/client";
import { DataTable, Th, Td, ToneChip } from "@/components/ui";
import { fromToday } from "@/lib/core/days";
import { fmtDate } from "@/lib/core/utils";
import { activityLink, activityWords } from "@/lib/settings/activity-words";
import { adminProjects, orEmpty } from "@/lib/settings/api-admin";
import { NoAccess } from "../../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "A person's activity" };

type Activity = {
  user: { id: string; name: string; email: string; active: boolean; party: string | null; linked: boolean };
  total: number; page: number; per: number; pages: number;
  first: string | null; lastSignIn: string | null;
  kinds: { action: string; count: number }[];
  rows: { id: number; at: string; action: string; entityType: string | null; entityId: string | null; entityLabel: string | null; detail: string | null; projectId: string | null; project: string | null }[];
};

/**
 * One person, from People & access: who they are, and everything they did in the app with its day (signed in, opened,
 * downloaded, reviewed, released, sent…), read from the audit trail. The action page's way: the plate, then the table
 * directly under it. An administrator or the control function only; never on the directory. Reading it is recorded.
 */
export default async function PersonActivityPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ project?: string; action?: string; page?: string }>;
}) {
  const ctx = await requireScope();
  const { user: me } = ctx;
  if (!isAdmin(me) && !ctx.can("CONTROL")) return <NoAccess title="A person's activity" who="control" />;
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const query = new URLSearchParams(Object.entries({ projectId: sp.project, action: sp.action, page: String(page), per: "50" })
    .filter((e): e is [string, string] => !!e[1]));
  const [activity, projects] = await Promise.all([
    api<Activity>(`/api/admin/users/${id}/activity?${query}`).catch(() => null),
    orEmpty(adminProjects),
  ]);
  if (!activity) {
    return (
      <section className="register register-sheet register-sheet-open px-5 pt-6 pb-4 sm:px-6">
        <h1 className="plate-title text-slate-950">A person&rsquo;s activity</h1>
        <p role="alert" className="mt-2 w-fit rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">Their activity could not be read just now. Try again in a moment.</p>
      </section>
    );
  }
  const { user } = activity;
  const href = (q: { project?: string; action?: string; page?: number }) => {
    const next = new URLSearchParams(Object.entries({ project: q.project, action: q.action, page: q.page && q.page > 1 ? String(q.page) : undefined })
      .filter((e): e is [string, string] => !!e[1]));
    return `/settings/users/${id}${next.size ? `?${next}` : ""}`;
  };
  const day = (at: string) => at.slice(0, 10);
  const from = (activity.page - 1) * activity.per + 1;
  const to = Math.min(activity.total, activity.page * activity.per);

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        {/* The plate and the narrowing, one sheet. */}
        <div className="flex flex-col-reverse gap-3 border-b border-line px-5 pt-6 pb-3 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
              {user.email}
              <span className="ml-2 font-sans text-xs font-normal">{user.party ?? "ours"}{user.linked ? " · works here from their own DELIOS" : ""}</span>
            </p>
            <h1 className="plate-name mt-1 min-w-0">{user.name}</h1>
            <p className="plate-meta mt-2">
              {activity.lastSignIn ? `last signed in ${fmtDate(activity.lastSignIn)}` : "never signed in"}
              {activity.first ? ` · first act ${fmtDate(activity.first)}` : ""}
              {` · ${activity.kinds.reduce((n, k) => n + k.count, 0).toLocaleString("en-GB")} acts recorded`}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              Everything {user.name} did in the app, newest first, as the audit trail keeps it. Only an administrator or the control function reads this, and reading it is recorded too.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href={`/settings/users#person-${user.id}`} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> People &amp; access</Link>
            <ToneChip tone={user.active ? "done" : "idle"}>{user.active ? "can sign in" : "switched off"}</ToneChip>
          </div>
        </div>

        {/* The narrowing: a kind of act, and a project. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5 text-xs sm:px-6">
          <span className="stencil mr-1 text-slate-500">What</span>
          <Link href={href({ project: sp.project })} data-on={!sp.action} className="ask">All</Link>
          {activity.kinds.slice(0, 12).map((k) => (
            <Link key={k.action} href={href({ project: sp.project, action: k.action })} data-on={sp.action === k.action} className="ask">
              {activityWords(k.action)} <span className="font-mono tabular-nums opacity-70">{k.count}</span>
            </Link>
          ))}
          {projects.length > 1 ? (
            <>
              <span className="stencil mr-1 ml-3 text-slate-500">Project</span>
              <Link href={href({ action: sp.action })} data-on={!sp.project} className="ask">Any</Link>
              {projects.map((p) => (
                <Link key={p.id} href={href({ project: p.id, action: sp.action })} data-on={sp.project === p.id} className="ask">{p.code}</Link>
              ))}
            </>
          ) : null}
        </div>

        {/* The table directly under it. */}
        <DataTable className="rounded-none border-0 shadow-none" toolbar={false}
          head={<tr><Th>When</Th><Th>What</Th><Th>On</Th><Th>Project</Th><Th>More</Th></tr>}>
          {activity.rows.length ? activity.rows.map((e) => {
            const link = activityLink(e.entityType, e.entityId);
            return (
              <tr key={e.id} className="align-top">
                <Td className="whitespace-nowrap text-xs">
                  <span title={new Date(e.at).toLocaleString("en-GB")}>{fromToday(day(e.at)) ?? fmtDate(e.at)}</span>
                  <span className="block font-mono text-[11px] tabular-nums text-slate-500">{new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
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
            <tr><Td colSpan={5} className="text-xs text-slate-500">{sp.action || sp.project ? "Nothing of theirs matches this." : `${user.name} has done nothing in the app yet.`}</Td></tr>
          )}
        </DataTable>

        {activity.total > 0 ? (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-line px-5 py-2.5 sm:px-6">
            <p className="font-mono text-[11px] tabular-nums text-slate-500">
              {from.toLocaleString("en-GB")}–{to.toLocaleString("en-GB")}
              <span className="ml-1.5 font-sans text-slate-500">of {activity.total.toLocaleString("en-GB")}</span>
            </p>
            {activity.pages > 1 ? (
              <span className="flex items-center gap-2">
                {activity.page > 1
                  ? <Link href={href({ project: sp.project, action: sp.action, page: activity.page - 1 })} aria-label="Previous page" className="rounded-sm p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-ink"><ChevronLeft className="h-4 w-4" /></Link>
                  : <span className="p-1 text-slate-300"><ChevronLeft className="h-4 w-4" /></span>}
                <span className="font-mono text-[11px] tabular-nums text-slate-500">{activity.page} of {activity.pages}</span>
                {activity.page < activity.pages
                  ? <Link href={href({ project: sp.project, action: sp.action, page: activity.page + 1 })} aria-label="Next page" className="rounded-sm p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-ink"><ChevronRight className="h-4 w-4" /></Link>
                  : <span className="p-1 text-slate-300"><ChevronRight className="h-4 w-4" /></span>}
              </span>
            ) : <span />}
            <span />
          </div>
        ) : null}
      </section>
    </div>
  );
}
