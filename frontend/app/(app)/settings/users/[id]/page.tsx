import { Select } from "@/components/select";
import Link from "next/link";
import { inputCls } from "@/components/ui";
import { requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/core/utils";
import { adminProjects, orEmpty } from "@/lib/settings/api-admin";
import { Logbook, readingLine, type LogAct } from "@/components/logbook";
import { AUDIT_KINDS } from "@/lib/core/rails";
import { NoAccess } from "../../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "A person's activity" };

type Activity = {
  user: { id: string; name: string; email: string; active: boolean; party: string | null; linked: boolean };
  total: number; page: number; per: number; pages: number;
  first: string | null; lastSignIn: string | null; keepsReading: boolean; showsSignIns: boolean;
  kinds: { action: string; count: number; kind: string }[];
  rows: (LogAct & { projectId: string | null })[];
};

type Search = { q?: string; kind?: string; action?: string; project?: string; from?: string; to?: string; page?: string };

/**
 * One person, from People & access: who they are, then everything they did in the app on the audit trail's logbook
 * (`components/logbook.tsx`): day by day, each act a slip in its kind's colour, every kind and act listed beside it.
 * What is kept is the organization's choice. An administrator or the control function only; never on the directory.
 * Reading it is recorded.
 */
export default async function PersonActivityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const ctx = await requireScope();
  const { user: me } = ctx;
  if (!isAdmin(me) && !ctx.can("CONTROL")) return <NoAccess title="A person's activity" who="control" />;
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const query = new URLSearchParams(Object.entries({ projectId: sp.project, kind: sp.kind, action: sp.action, q: sp.q, from: sp.from, to: sp.to, page: String(page), per: "50" })
    .filter((e): e is [string, string] => !!e[1]));
  const [activity, projects] = await Promise.all([
    api<Activity>(`/api/admin/users/${id}/activity?${query}`).catch(() => null),
    orEmpty(adminProjects),
  ]);
  const address = (q: Search) => {
    const next = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1] && !(e[0] === "page" && e[1] === "1")));
    return `/settings/users/${id}${next.size ? `?${next}` : ""}`;
  };
  const words = { q: sp.q, project: sp.project, from: sp.from, to: sp.to };
  const user = activity?.user;

  return (
    <Logbook
      title={
        <div className="flex flex-col-reverse gap-3 lg:flex-row lg:items-start lg:justify-between">
          {/* The way back is the breadcrumb above (Settings / People & access), once. */}
          <div className="min-w-0">
            <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
              {user?.email}
              {user ? <span className="ml-2 font-sans text-xs font-normal">{user.party ?? "ours"}{user.linked ? " · works here from their own DELIOS" : ""}{user.active ? "" : " · can no longer sign in"}</span> : null}
            </p>
            <h1 className="dispatch-title mt-1">{user?.name ?? "A person's activity"}</h1>
          </div>
        </div>
      }
      lede={activity && user ? (
        <p>
          {activity.showsSignIns ? (activity.lastSignIn ? `Last signed in ${fmtDate(activity.lastSignIn)}. ` : "Never signed in. ") : ""}
          {activity.first ? `First act ${fmtDate(activity.first)}. ` : "Nothing recorded yet. "}
          What {user.name} did in the app, day by day: their acts on documents
          {activity.keepsReading ? ", what they opened and downloaded" : ""}{activity.showsSignIns ? ", and their sign-ins" : ""}, as the organization chose to keep them
          {isAdmin(me) ? <> (<Link href="/organization/settings/tracking" className="font-semibold text-link hover:underline">change it</Link>)</> : null}.
          Only an administrator or the control function reads this, and reading it is recorded too.
        </p>
      ) : <p>Their activity could not be read just now. Try again in a moment.</p>}
      reading={readingLine({ from: sp.from, to: sp.to, kindLabel: AUDIT_KINDS.find((k) => k.key === sp.kind)?.label, q: sp.q })}
      acts={activity?.rows ?? []}
      counts={activity?.kinds ?? []}
      chosen={{ kind: sp.kind, action: sp.action }}
      href={(q) => address({ ...words, kind: q.kind, action: q.action, page: q.page ? String(q.page) : undefined })}
      find={{
        q: sp.q, from: sp.from, to: sp.to, hidden: { kind: sp.kind, action: sp.action }, clear: address({ kind: sp.kind, action: sp.action }),
        extra: projects.length > 1 ? (
          <Select name="project" defaultValue={sp.project ?? ""} className={inputCls} aria-label="Project">
            <option value="">Every project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </Select>
        ) : null,
      }}
      paging={{ page: activity?.page ?? 1, pages: activity?.pages ?? 1, total: activity?.total ?? 0 }}
      showWho={false}
    />
  );
}
