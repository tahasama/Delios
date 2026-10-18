import { Fragment } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { DataTable, Th, Td, ToneChip } from "@/components/ui";
import { Switch } from "@/components/switch";
import { adminUsers } from "@/lib/settings/api-admin";
import { setSignInAction } from "@/lib/organization/forms";
import { cn, fmtDate, fmtDateTime, timeAgo } from "@/lib/core/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "People" };

type Search = { who?: string; open?: string };
type Who = "all" | "ours" | "guests" | "linked";

/**
 * Everyone with an account here (owner): ours, the people of other organizations we made accounts for, and those who
 * joined from their own DELIOS. Each line: their organization, the projects they are on with their function, since
 * when, their last sign-in, and whether they may sign in (a switch, at once). A name opens their card under the line, in place: every project
 * they were on, with function, department and since when. The card shows no sign-ins or acts (owner: we are not
 * monitoring people; a person's activity stays in Settings, for its purpose only).
 */
export default async function OrganizationPeoplePage({ searchParams }: { searchParams: Promise<Search> }) {
  const scope = await requireOrgAdmin();
  const sp = await searchParams;
  const users = await adminUsers().catch(() => []);
  const whoOf = (u: (typeof users)[number]): Exclude<Who, "all"> => (u.internal ? "ours" : u.linked ? "linked" : "guests");
  const counts = { all: users.length, ours: 0, guests: 0, linked: 0 };
  for (const u of users) counts[whoOf(u)]++;
  const who: Who = sp.who === "ours" || sp.who === "guests" || sp.who === "linked" ? sp.who : "all";
  const shown = users
    .filter((u) => who === "all" || whoOf(u) === who)
    // Ours first, then by name: switching someone off never moves their line.
    .sort((a, b) => Number(b.internal) - Number(a.internal) || a.name.localeCompare(b.name));
  const signingIn = users.filter((u) => u.active && !u.linked).length;
  const href = (q: Search, anchor?: string) => {
    const next = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1] && e[1] !== "all"));
    return `/organization/people${next.size ? `?${next}` : ""}${anchor ? `#${anchor}` : ""}`;
  };
  const TABS: { key: Who; label: string }[] = [
    { key: "all", label: "Everyone" }, { key: "ours", label: "Ours" }, { key: "guests", label: "Accounts we made" }, { key: "linked", label: "From their own DELIOS" },
  ];

  return (
    <>
      <header className="register register-sheet register-sheet-open">
        <div className="px-5 pt-5 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">People</h1>
          <p className="plate-meta mt-2">
            {counts.ours} of ours · {counts.guests} with accounts from us · {counts.linked} from their own DELIOS · {signingIn} may sign in here
          </p>
        </div>
        <nav aria-label="Whose people" className="seg mx-5 mb-4 w-fit max-w-full sm:mx-6">
          {TABS.map((t) => (
            <Link key={t.key} href={href({ who: t.key })} aria-current={who === t.key ? "page" : undefined} className="segment">
              {t.label}<span className="segment-n">{counts[t.key]}</span>
            </Link>
          ))}
        </nav>
      </header>

      <section className="register register-sheet register-sheet-open" aria-label="People">
        <DataTable className="rounded-none border-0 shadow-none" toolbar={false}
          head={<tr><Th>Name</Th><Th>Organization</Th><Th>Projects</Th><Th>Account since</Th><Th>Last sign-in</Th><Th className="text-right">May sign in</Th></tr>}>
          {shown.map((u) => {
            const open = sp.open === u.id;
            const seats = u.memberships.filter((m) => m.active);
            const Chevron = open ? ChevronDown : ChevronRight;
            const me = u.id === scope.user.id;
            return (
              <Fragment key={u.id}>
                <tr id={`person-${u.id}`} className={cn("scroll-mt-20 align-top target:bg-tint-soft", !u.active && "opacity-60", open && "bg-tint-soft [&>td]:border-b-0")}>
                  <Td>
                    <Link href={href({ who, open: open ? undefined : u.id }, `person-${u.id}`)} scroll={false} aria-expanded={open} className="group inline-flex items-start gap-1 text-left">
                      <Chevron className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 group-hover:text-link" aria-hidden="true" />
                      <span className="text-[13px] font-medium text-slate-800 group-hover:text-link group-hover:underline">{u.name}</span>
                    </Link>
                    {u.isAdmin ? <span className="ml-1.5"><ToneChip tone="moving">administrator</ToneChip></span> : null}
                    <span className="block pl-5 text-[11px] text-slate-500">{u.email}</span>
                    {u.lockedUntil && new Date(u.lockedUntil) > new Date() ? <span className="block pl-5 text-[11px] font-semibold text-amber-700">locked until {fmtDateTime(u.lockedUntil)}</span> : null}
                  </Td>
                  <Td className="text-xs">
                    {u.internal ? <span className="text-slate-700">{scope.organization.name}</span> : (
                      <>
                        <code className="code-chip mr-1">{u.partyCode}</code>{u.partyName}
                        <span className="block text-[11px] text-slate-500">{u.linked ? `from its own DELIOS${u.homeFunction ? ` · ${u.homeFunction}` : ""}` : "account from us"}</span>
                      </>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {seats.length ? (
                      <ul className="space-y-0.5">
                        {seats.map((m) => (
                          <li key={m.id}><code className="code-chip mr-1.5">{m.projectCode}</code><span className="text-slate-600">{m.functionName}</span></li>
                        ))}
                      </ul>
                    ) : <span className="text-slate-500">on no project</span>}
                  </Td>
                  <Td className="text-xs whitespace-nowrap">{fmtDate(u.createdAt)}</Td>
                  <Td className="text-xs whitespace-nowrap">
                    {u.linked ? <span className="text-slate-500">at home</span>
                      : u.lastSignInAt ? <span title={fmtDateTime(u.lastSignInAt)}>{timeAgo(u.lastSignInAt)}</span> : <span className="text-slate-500">never</span>}
                  </Td>
                  <Td className="w-px whitespace-nowrap text-right">
                    {u.linked ? <span className="text-[11px] text-slate-500">signs in at home</span> : me ? <span className="text-[11px] text-slate-500">you</span> : (
                      <form action={setSignInAction} className="inline-flex">
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="active" value={u.active ? "off" : "on"} />
                        <Switch on={u.active} label={u.active ? `Stop ${u.name} signing in` : `Let ${u.name} sign in again`} />
                      </form>
                    )}
                  </Td>
                </tr>
                {open ? (
                  <tr>
                    <td colSpan={6} className="border-b border-line bg-tint-soft p-0">
                      <PersonCard user={u} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </DataTable>
        {shown.length ? null : <p className="px-5 py-4 text-xs text-slate-500 sm:px-6">Nobody here yet.</p>}
        <p className="border-t border-line px-5 py-2.5 text-[11px] text-slate-500 sm:px-6">
          Switched off, a person can no longer sign in, on any project; everything they did stays. Who is on which project, with which function, is
          changed in each project&rsquo;s People &amp; access.
        </p>
      </section>
    </>
  );
}

/** A person's card, open under their line: who they are here, then every project they were on, from when until when. */
function PersonCard({ user: u }: { user: Awaited<ReturnType<typeof adminUsers>>[number] }) {
  const fact = (term: string, value: React.ReactNode, said?: string) => (
    <div className="px-5 py-3 sm:px-6">
      <dt className="stencil text-slate-500">{term}</dt>
      <dd className="mt-1 text-[13px] font-medium text-slate-900">{value}</dd>
      {said ? <dd className="text-[11px] text-slate-500">{said}</dd> : null}
    </div>
  );
  const seats = [...u.memberships].sort((a, b) => Number(b.active) - Number(a.active) || (a.since ?? "").localeCompare(b.since ?? ""));
  const state = (m: (typeof seats)[number]) =>
    m.refusedAt ? <ToneChip tone="refused">refused</ToneChip>
      : m.pendingSince ? <ToneChip tone="waiting">waiting to be confirmed</ToneChip>
      : m.active ? <ToneChip tone="done">on it</ToneChip> : <ToneChip tone="idle">taken off</ToneChip>;

  return (
    <div className="border-t border-line">
      <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {fact("Account made", fmtDate(u.createdAt), u.linked ? "stands for their own account at home" : undefined)}
        {fact("Two-step sign-in", u.linked ? "At home" : u.mfa ? "On" : "Off")}
        {fact("Projects", `${u.memberships.filter((m) => m.active).length} now`, `${u.memberships.length} in all`)}
      </dl>
      {seats.length ? (
        <table className="w-full border-t border-line text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              {["Project", "Function", "Department", "On it since", ""].map((h, i) => (
                <th key={i} className="stencil px-5 py-2 font-normal sm:first:pl-6">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-t border-line bg-surface">
            {seats.map((m) => (
              <tr key={m.id} className={m.active ? undefined : "opacity-60"}>
                <td className="px-5 py-2 sm:pl-6"><code className="code-chip mr-1.5">{m.projectCode}</code><span className="font-medium text-slate-800">{m.projectName}</span></td>
                <td className="px-5 py-2">{m.functionName}</td>
                <td className="px-5 py-2">{m.department ?? <span className="text-slate-500">—</span>}</td>
                <td className="px-5 py-2 whitespace-nowrap">{m.since ? fmtDate(m.since) : "—"}</td>
                <td className="px-5 py-2 text-right">
                  {state(m)}
                  {m.refusedReason ? <span className="mt-0.5 block text-[11px] text-slate-500">{m.refusedReason}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="border-t border-line px-5 py-3 text-xs text-slate-500 sm:px-6">On no project yet.</p>}
    </div>
  );
}
