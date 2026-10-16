import { controlDoes, CONFIRM_KEY, effectiveAnswer } from "@/lib/settings/control-activities";
import Link from "next/link";
import { Fragment } from "react";
import { cn } from "@/lib/core/utils";
import { Bell, Pencil, X } from "lucide-react";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { DataTable, Th, Td, Field, inputCls, ToneChip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { savePersonAction, takeOffProjectAction } from "@/lib/settings/forms-admin";
import { holdersOf } from "@/lib/core/permissions";
import { api, projectPath } from "@/lib/client";
import { projectSettings } from "@/lib/settings/api";
import { projectOrganizations } from "@/lib/organization/api";
import { isAdmin } from "@/lib/core/auth";
import { adminFunctions, adminParties, adminProjects, adminUsers } from "@/lib/settings/api-admin";
import { getMe } from "@/lib/account/api";
import { getActiveSet } from "@/lib/settings/config";
import { noticesAbout, noticeHistory } from "@/lib/actions/api";
import { NotifyPanel } from "@/components/notify-panel";
import { fromToday } from "@/lib/core/days";
import { NoAccess } from "../no-access";
import { AddSomeoneForm, AskToJoinForm } from "./join-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "People & access" };

type Pending = {
  membershipId: string; userId: string; name: string; organization: string | null; function: string; department: string | null;
  since: string; proposedBy: string | null; confirmerId: string | null; confirmerName: string | null; mine: boolean;
};

/**
 * Who is on the project, in which function and department; and how someone joins it. Two switches of the project
 * (Control room): who adds (only the control function, the default, or everyone on the project, from the directory)
 * and whether whoever holds Manage confirms (necessary by default). Here: "Add someone" with an account, and "Ask for
 * someone to join" for someone new, with the email or letter it came on as proof. Confirmed, they are put on by
 * themselves and told; the control function may remind whoever confirms. The list: everyone, narrowed by organization
 * and project, each with their place here.
 */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ org?: string; project?: string; edit?: string }> }) {
  const ctx = await requireScope();
  const { user: me, projectId, project } = ctx;
  const sp = await searchParams;
  const withControl = await controlDoes(ctx, "PROJECT_PEOPLE");
  if (!maySetup(me, SETUP_PAGES.find((p) => p.href === "/settings/users")!, !withControl)) {
    return <NoAccess title="People & access" who="control" />;
  }
  const [people, parties, projects, functions, disciplines, answers, managers, taking, pending] = await Promise.all([
    adminUsers(),
    adminParties(),
    // The control function works on the projects it is on; an administrator on any.
    adminProjects().catch(async () => (await getMe())?.projects ?? []).then((all) => all.filter((one) => one.status === "ACTIVE")),
    adminFunctions().then((all) => all.filter((one) => one.active).sort((a, b) => a.name.localeCompare(b.name))),
    getActiveSet("DISCIPLINES").then((all) => all.map((one) => ({ code: one.code, label: one.label })).sort((x, y) => x.label.localeCompare(y.label))),
    projectSettings(projectId).catch(() => new Map<string, string>()),
    holdersOf(ctx, "MANAGE").catch(() => []),
    projectOrganizations(ctx).catch(() => []),
    api<Pending[]>(projectPath(ctx, "/people/pending")).catch(() => [] as Pending[]),
  ]);

  // Whether someone put on here goes straight on, or is asked first (the backend decides the same way).
  const admin = isAdmin(me);
  const mayAdd = admin || ctx.can("CONTROL") || (!withControl && me.isInternal);
  const confirmOn = effectiveAnswer(CONFIRM_KEY("PROJECT_PEOPLE"), answers.get(CONFIRM_KEY("PROJECT_PEOPLE"))) === "ON";
  const asks = !admin && (!mayAdd || confirmOn);

  const deptLabel = (code: string) => disciplines.find((d) => d.code === code)?.label ?? code;
  const takesPart = new Set(taking.filter((one) => one.active).map((one) => one.partyId));
  const ourParties = parties.filter((p) => p.isInternal && p.active);
  const guestParties = parties.filter((p) => !p.isInternal && p.active && p.kind !== "COLLABORATOR" && p.kind !== "NOT_ON_DELIOS" && p.participation !== "BY_PROXY");
  const onProject = people.filter((u) => u.active && u.memberships.some((m) => m.projectId === projectId && m.active));
  const notHere = people.filter((u) => u.active && !u.memberships.some((m) => m.projectId === projectId && (m.active || m.pendingSince)));
  const confirmers = [
    ...managers.map((m) => ({ id: m.id, name: m.name, detail: m.functionName, note: "recommended" })),
    ...onProject.filter((u) => !managers.some((m) => m.id === u.id))
      .map((u) => ({ id: u.id, name: u.name, detail: u.memberships.find((m) => m.projectId === projectId)?.functionName ?? null })),
  ];

  const users = [...people]
    .sort((x, y) => Number(y.active) - Number(x.active) || x.name.localeCompare(y.name))
    .map((one) => ({
      ...one,
      held: one.memberships.find((seat) => !seat.active && seat.projectId === projectId && (seat.pendingSince || seat.refusedAt)) ?? null,
      seats: one.memberships.filter((seat) => seat.active),
    }));
  const shownOrg = sp.org ? parties.find((party) => party.id === sp.org) ?? null : null;
  const projectFilter = sp.project && projects.some((item) => item.id === sp.project) ? sp.project : "";
  const shown = users.filter((person) =>
    (!shownOrg || person.partyId === shownOrg.id) && (!projectFilter || person.seats.some((seat) => seat.projectId === projectFilter)));
  const refused = users.filter((u) => u.held?.refusedAt).length;

  // Reminding whoever confirms: one notice history per person waiting.
  const reminders = await Promise.all(pending.map(async (one) => ({ id: one.membershipId, history: noticeHistory(await noticesAbout(ctx, `join:${one.membershipId}`)) })));
  const editing = sp.edit ?? null;
  const chip = (q: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1]));
    return `/settings/users${next.size ? `?${next}` : ""}`;
  };

  return (
    <div className="space-y-4">
      {/* The masthead: who is here, and how someone joins. */}
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="plate-title text-slate-950">People &amp; access</h1>
            <p className="plate-meta mt-2">
              {onProject.length} on {project.code}
              {pending.length ? <> · <span className="text-amber-800">{pending.length} waiting to be confirmed</span></> : null}
              {refused ? <> · {refused} refused</> : null}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              {withControl ? `On ${project.code} only the control function adds people` : `On ${project.code} everyone on the project adds people, from the project directory`}
              {confirmOn
                ? "; whoever holds Manage confirms each one, and once confirmed they are put on by themselves and told by notification and email."
                : "; no confirmation: they are on at once, and told by notification and email."}
              {admin ? " As an administrator, what you add goes straight on." : ""}
              {" "}<Link href="/settings/flow#how-it-works" className="font-semibold text-link hover:underline">Change it in the Control room</Link>.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link href="/import?kind=people" className="ask">Add a whole team from a spreadsheet</Link>
          </div>
        </div>
      </section>

      {/* Someone joins: someone with an account, or someone new. */}
      <section className="register register-sheet register-sheet-open scroll-mt-24" id="join" aria-labelledby="join-head">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span id="join-head" className="stencil mr-1 text-slate-500">Someone joins {project.code}</span>
          <span className="text-[11px] text-slate-500">
            {asks ? "asked first; confirmed, they are put on and told" : "they are put on at once and told"}
          </span>
        </div>
        <div className="px-5 py-4 sm:px-6">
          <div className="space-y-3">
            {mayAdd ? (
              <AddSomeoneForm
                projectCode={project.code}
                people={notHere.map((u) => ({ id: u.id, name: u.name, detail: [u.partyName, u.email].filter(Boolean).join(" · ") }))}
                functions={functions.map((f) => ({ value: f.id, label: f.name }))}
                disciplines={disciplines.map((d) => ({ value: d.code, label: d.label }))}
                confirmers={confirmers}
                asks={asks}
              />
            ) : null}
            <AskToJoinForm
              projectCode={project.code}
              ourParties={ourParties.map((p) => ({ value: p.id, label: p.name }))}
              guestParties={guestParties.map((p) => ({ value: p.id, label: `${p.name}${takesPart.has(p.id) ? "" : ` (not taking part in ${project.code} yet)`}` }))}
              functions={functions.map((f) => ({ value: f.id, label: f.name }))}
              disciplines={disciplines.map((d) => ({ value: d.code, label: d.label }))}
              confirmers={confirmers}
              asks={asks}
              mayKeepProof={ctx.can("CONTROL")}
            />
          </div>
          <p className="mt-3 text-[11px] leading-4 text-slate-500">
            Someone whose company has its own DELIOS is not added here: link the two organizations on{" "}
            <Link href="/settings/parties" className="font-semibold text-link hover:underline">Organizations</Link>; their administrator puts them on.
          </p>
        </div>
      </section>

      {/* Waiting to be confirmed: who, as what, since when, who confirms; the control function may remind them. */}
      {pending.length ? (
        <section className="register register-sheet register-sheet-open" aria-labelledby="pending-head">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span id="pending-head" className="stencil mr-1 text-slate-500">Waiting to be confirmed</span>
            <span className="text-[11px] text-slate-500">they join once confirmed, on People to confirm</span>
          </div>
          <ul className="divide-y divide-line">
            {pending.map((one) => {
              const history = reminders.find((r) => r.id === one.membershipId)?.history ?? { count: 0, daysSinceFirst: null, lastTo: [] };
              const askedOf = one.confirmerId ? [one.confirmerId] : managers.map((m) => m.id);
              return (
                <li key={one.membershipId} className="space-y-3 px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="text-sm font-semibold text-slate-800">
                      {one.name}
                      <span className="ml-1.5 text-xs font-normal text-slate-500">{[one.organization, one.function, one.department ? deptLabel(one.department) : null].filter(Boolean).join(" · ")}</span>
                    </p>
                    <ToneChip tone="waiting">waiting for {one.confirmerName ?? "whoever holds Manage"}</ToneChip>
                  </div>
                  <p className="text-xs leading-5 text-slate-600">
                    Asked by {one.proposedBy ?? "someone"}, {fromToday(one.since.slice(0, 10))?.toLowerCase() ?? one.since.slice(0, 10)}.{" "}
                    <Link href="/people/confirm" className="font-semibold text-link hover:underline">People to confirm</Link>
                  </p>
                  {ctx.can("CONTROL") && askedOf.length ? (
                    <details>
                      <summary className="ask w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden"><Bell aria-hidden className="h-3.5 w-3.5" /> Remind whoever confirms</summary>
                      <div className="mt-3">
                        <NotifyPanel
                          subject={`join:${one.membershipId}`}
                          title={`${one.name} waits to join ${project.code}`}
                          body={`${one.name} waits for your confirmation to join ${project.code} as ${one.function}. Please confirm or refuse it on People to confirm.`}
                          link="/people/confirm"
                          people={confirmers}
                          chosen={askedOf}
                          history={history}
                          bare
                        />
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Everyone: narrowed by organization and project; each with their place here. */}
      <section className="register register-sheet register-sheet-open" aria-labelledby="list-head">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span id="list-head" className="stencil mr-1 text-slate-500">{shownOrg ? shownOrg.name : "Everyone"}</span>
          <span className="text-[11px] text-slate-500">{shown.length} · function and department shown for {project.code}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5 text-xs sm:px-6">
          <span className="stencil mr-1 text-slate-500">Organization</span>
          <Link href={chip({ project: projectFilter || undefined })} data-on={!shownOrg} aria-current={!shownOrg ? "true" : undefined} className="ask">All</Link>
          {parties.map((party) => (
            <Link key={party.id} href={chip({ org: party.id, project: projectFilter || undefined })}
              data-on={shownOrg?.id === party.id} aria-current={shownOrg?.id === party.id ? "true" : undefined} className="ask">{party.name}</Link>
          ))}
          {projects.length > 1 ? (
            <>
              <span className="stencil mr-1 ml-3 text-slate-500">Project</span>
              <Link href={chip({ org: shownOrg?.id })} data-on={!projectFilter} aria-current={!projectFilter ? "true" : undefined} className="ask">Any</Link>
              {projects.map((item) => (
                <Link key={item.id} href={chip({ org: shownOrg?.id, project: item.id })}
                  data-on={projectFilter === item.id} aria-current={projectFilter === item.id ? "true" : undefined} className="ask">{item.code}</Link>
              ))}
            </>
          ) : null}
        </div>
        <DataTable className="rounded-none border-0 shadow-none" toolbar={false}
          head={<tr><Th>Person</Th><Th>Organization</Th><Th>On {project.code}</Th><Th>Department</Th><Th>Other projects</Th><Th></Th></tr>}>
          {shown.map((u) => {
            const here = u.seats.find((m) => m.projectId === projectId);
            const elsewhere = u.seats.filter((m) => m.projectId !== projectId);
            const open = !!here && editing === u.id;
            // Opening or closing a person's line keeps the narrowing as it is.
            const lineHref = (edit?: string) => `${chip({ org: shownOrg?.id, project: projectFilter || undefined, edit })}#person-${u.id}`;
            return (
              <Fragment key={u.id}>
                <tr id={`person-${u.id}`} className={cn("scroll-mt-20 align-top target:bg-tint-soft", !u.active && "opacity-60", open && "[&>td]:border-b-0")}>
                  <Td>
                    <span className="font-medium text-slate-800">{u.name}</span>{u.id === me.id ? <span className="ml-1 text-xs text-slate-500">(you)</span> : null}
                    <span className="block text-[11px] text-slate-500">
                      {u.email}{u.linked ? " · works here from their own DELIOS" : ""}{u.active ? "" : " · can no longer sign in"}
                    </span>
                  </Td>
                  <Td className="text-xs">{u.partyName ?? "—"}</Td>
                  <Td className="text-xs">
                    {here ? here.functionName
                      : u.held?.pendingSince ? <ToneChip tone="waiting">{u.held.functionName} · waiting for {u.held.confirmerName ?? "whoever holds Manage"}</ToneChip>
                      : u.held?.refusedAt ? <span className="whitespace-pre-line text-red-700">{u.held.functionName} · refused by {u.held.refusedByName}: {u.held.refusedReason}</span>
                      : <span className="text-slate-500">not on it</span>}
                  </Td>
                  <Td className="text-xs">{here?.department ? deptLabel(here.department) : "—"}</Td>
                  <Td className="text-xs">{elsewhere.length ? elsewhere.map((m) => `${m.projectCode} · ${m.functionName}`).join(", ") : "—"}</Td>
                  <Td className="w-px whitespace-nowrap text-right">
                    {here ? (
                      open ? (
                        <Link href={lineHref()} scroll={false} className="inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Close">
                          <X aria-label={`Close ${u.name}`} className="h-4 w-4" />
                        </Link>
                      ) : (
                        <Link href={lineHref(u.id)} scroll={false} className="inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title={`Change ${u.name}`}>
                          <Pencil aria-label={`Change ${u.name}`} className="h-4 w-4" />
                        </Link>
                      )
                    ) : u.held?.pendingSince ? null : u.active ? (
                      <Link href="#join" className="text-xs font-semibold text-link hover:underline">Ask for them to join</Link>
                    ) : null}
                  </Td>
                </tr>
                {open && here ? (
                  // The person's line opened under it, the width of the table, as a row of a sheet: the fields side
                  // by side, then one row of acts; an opened act takes the whole width under them.
                  <tr>
                    <td colSpan={6} className="space-y-3 border-b border-line px-5 py-4 sm:px-6">
                      <p className="text-xs leading-5 text-slate-600">
                        {u.linked
                          ? `${u.name} works here from their own organization’s DELIOS: their name, email and sign-in are theirs. Only their place on ${project.code} changes here.`
                          : `What ${u.name} is on ${project.code}, and their account.`}
                      </p>
                      <ActionForm action={savePersonAction} submitLabel="Save" hidden={{ userId: u.id, partyId: u.partyId ?? "" }} className="space-y-3">
                        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
                          {u.linked ? null : (
                            <>
                              <Field label="Name" required><input name="name" required defaultValue={u.name} autoComplete="off" className={inputCls} /></Field>
                              <Field label="Email" required hint="where their notices go"><input type="email" name="email" required defaultValue={u.email} autoComplete="off" className={inputCls} /></Field>
                            </>
                          )}
                          <Field label={`Function on ${project.code}`} required>
                            <select name="functionId" defaultValue={here.functionId} className={inputCls}>
                              {functions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                          </Field>
                          <Field label="Department" hint="their discipline: told about actions, confirms going ahead">
                            <select name="department" defaultValue={here.department ?? ""} className={inputCls}>
                              <option value="">None</option>
                              {disciplines.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                            </select>
                          </Field>
                        </div>
                        {u.linked ? null : (
                          <label className="flex w-fit cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700">
                            <input type="checkbox" name="active" defaultChecked={u.active} />
                            Can sign in <span className="font-normal text-slate-500">— untick to switch their account off on every project</span>
                          </label>
                        )}
                      </ActionForm>
                      {u.id !== me.id ? (
                        <div className="flex flex-wrap items-start gap-2 border-t border-line pt-3">
                          <details className="group text-xs open:basis-full">
                            <summary className="ask cursor-pointer list-none [&::-webkit-details-marker]:hidden">Take off {project.code}</summary>
                            <ActionForm action={takeOffProjectAction} submitLabel={`Take ${u.name} off`} hidden={{ userId: u.id }} className="mt-3 space-y-3"
                              confirmText={`Take ${u.name} off ${project.code}? Their account and their other projects stay, and everything they did here keeps their name.`}>
                              <p className="text-xs leading-5 text-slate-600">
                                They leave {project.code} only. Their account and their other projects stay, and everything they did here keeps their name.
                              </p>
                            </ActionForm>
                          </details>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </DataTable>
      </section>
    </div>
  );
}
