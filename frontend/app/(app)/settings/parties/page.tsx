import { Fragment } from "react";
import Link from "next/link";
import { Pencil, X } from "lucide-react";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { DataTable, Th, Td, Field } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { SearchPick } from "@/components/search-pick";
import { formPolicy } from "@/lib/settings/field-policy";
import { OrganizationJoins } from "./organization-joins";
import { PARTY_KINDS } from "@/lib/settings/party-kinds";
import { adminFunctions, adminUsers, partiesWithAnswers } from "@/lib/settings/api-admin";
import { projectOrganizations } from "@/lib/organization/api";
import { setProjectOrganizationAction } from "@/lib/organization/forms";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { IDENTIFIER_KINDS, countryName } from "@/lib/organization/countries";
import { holdersOf } from "@/lib/core/permissions";
import { cn, fmtDate } from "@/lib/core/utils";
import { NoAccess } from "../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organizations" };

/** A field as on the new-document form: grey, no box, inside the sheet's `asking` body. */
const field = "plain w-full";
const icon = "inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800";

type Search = { part?: string };

/**
 * Settings → Organizations, at the project's level: the organizations working on this project, and nothing else. Each
 * line, opened by its pencil, says its role here, the number of its contract with us, who of theirs answers for it
 * here, and the function its people get. One search brings one on: from our list, else from DELIOS, else it is created. The list of every organization, and its details, are the organization's (its own page).
 */
export default async function ProjectOrganizationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireScope();
  const { user: me } = ctx;
  if (!maySetup(me, SETUP_PAGES.find((p) => p.href === "/settings/parties")!)) return <NoAccess title="Organizations" who="control" />;
  const sp = await searchParams;
  const [parties, onProject, roles, functionList, users, policy, controllers] = await Promise.all([
    partiesWithAnswers(ctx.projectId), projectOrganizations(ctx), contractRoleOptions(), adminFunctions(), adminUsers(), formPolicy(ctx, "PARTY"),
    holdersOf(ctx, "CONTROL").catch(() => []),
  ]);
  const ours = users.filter((one) => one.active && one.internal).map((one) => ({ id: one.id, name: one.name, detail: one.email }));
  const control = controllers.map((one) => one.name);
  const functions = functionList.filter((one) => one.active).sort((a, b) => a.name.localeCompare(b.name));
  const kindLabel = (kind: string) => PARTY_KINDS.find((k) => k.value === (kind === "NOT_ON_DELIOS" ? "OFFLINE" : kind))?.label ?? kind;
  const working = onProject.filter((one) => one.active);
  const href = (q: Search, anchor?: string) => {
    const next = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1]));
    return `/settings/parties${next.size ? `?${next}` : ""}${anchor ? `#${anchor}` : ""}`;
  };
  const band = (id: string, title: string, said: string, extra?: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
      <span id={id} className="stencil mr-1 text-slate-500">{title}</span>
      <span className="text-[11px] text-slate-500">{said}</span>
      {extra}
    </div>
  );
  const roleSelect = (value: string | null) => (
    <select name="role" defaultValue={value ?? ""} className={field}>
      <option value="">Not stated</option>
      {roles.filter((r) => r.code !== "GENERIC").map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
    </select>
  );
  const startSelect = (value: string | null) => (
    <select name="startFunctionId" defaultValue={value ?? ""} className={field}>
      <option value="">Not said</option>
      {functions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  );

  return (
    <div className="space-y-4">
      {/* The plate: who works on this project. */}
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="plate-title text-slate-950">Organizations</h1>
            <p className="plate-meta mt-2">{working.length} working on {ctx.project.code}</p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              Who works on {ctx.project.code} besides us: the role each plays here, the number of its contract with us, who of
              theirs answers for it, and the function its people get.
              {isAdmin(me) ? <> Every organization we work with, and its details, are on the <Link href="/organization/organizations" className="font-semibold text-link hover:underline">organization&rsquo;s list</Link>.</> : null}
            </p>
          </div>
        </div>
      </section>

      {/* One way to bring an organization onto the project: look for it (our list, then DELIOS), else create it. */}
      <OrganizationJoins projectCode={ctx.project.code} onProject={onProject.filter((o) => o.active).map((o) => o.partyId)} ours={ours} control={control} own={policy.own} />

      {/* The organizations working on this project. */}
      <section className="register register-sheet register-sheet-open" aria-labelledby="list-head">
        {band("list-head", `Organizations on ${ctx.project.code}`, `${working.length} · the pencil opens one to give its role, contract and who answers for it`)}
        {onProject.length ? (
          <DataTable className="rounded-none border-0 shadow-none" toolbar={false}
            head={<tr><Th>Organization</Th><Th>How they work with us</Th><Th>Role here</Th><Th>Contract</Th><Th>Who answers for it</Th><Th>Their people start as</Th><Th></Th></tr>}>
            {onProject.map((one) => {
              const open = sp.part === one.partyId;
              const party = parties.find((p) => p.id === one.partyId);
              const c = party?.changed;
              const theirPeople = users.filter((u) => u.active && u.partyId === one.partyId).map((u) => ({ id: u.id, name: u.name, detail: u.email }));
              return (
                <Fragment key={one.partyId}>
                  <tr id={`part-${one.partyId}`} className={cn("scroll-mt-20 align-top target:bg-tint-soft", !one.active && "opacity-60", open && "[&>td]:border-b-0")}>
                    <Td>
                      <code className="code-chip mr-1.5">{one.code}</code><span className="text-slate-800">{one.name}</span>
                      {c?.identifier ? (
                        <span className="block text-[11px] text-slate-500">
                          {countryName(c.identifier.country)} · {IDENTIFIER_KINDS.find((k) => k.value === c.identifier!.kind)?.label.toLowerCase()} {c.identifier.number}
                        </span>
                      ) : null}
                      {one.active ? null : <span className="block text-[11px] text-slate-500">no longer works on it</span>}
                    </Td>
                    <Td className="text-xs">{kindLabel(one.kind)}{one.linkedOrganization ? <span className="block text-[11px] text-slate-500">{one.linkedOrganization}</span> : null}</Td>
                    <Td className="text-xs">{one.role ? roles.find((r) => r.code === one.role)?.label ?? one.role : <span className="text-slate-500">not stated</span>}</Td>
                    <Td className="text-xs">
                      {one.contractNumber ? <span className="font-mono">{one.contractNumber}</span> : <span className="text-slate-500">not given</span>}
                      {one.previousContractNumber ? <span className="block text-[11px] text-slate-500">was {one.previousContractNumber}</span> : null}
                    </Td>
                    <Td className="text-xs">
                      {party?.contact ? <>{party.contact.name}<span className="block text-[11px] text-slate-500">{party.backup ? `backup: ${party.backup.name}` : "no backup"}</span></> : <span className="text-slate-500">—</span>}
                    </Td>
                    <Td className="text-xs">{one.startFunction ?? (one.kind === "COLLABORATOR" ? <span className="font-semibold text-amber-700">not said yet</span> : <span className="text-slate-500">—</span>)}</Td>
                    <Td className="w-px whitespace-nowrap text-right">
                      {open
                        ? <Link href={href({}, `part-${one.partyId}`)} scroll={false} className={icon} title="Close"><X aria-label={`Close ${one.name}`} className="h-4 w-4" /></Link>
                        : <Link href={href({ part: one.partyId }, `part-${one.partyId}`)} scroll={false} className={icon} title={`Change ${one.name} on ${ctx.project.code}`}><Pencil aria-label={`Change ${one.name}`} className="h-4 w-4" /></Link>}
                    </Td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={7} className="border-b border-line p-0">
                        <ActionForm id={`part-form-${one.partyId}`} action={setProjectOrganizationAction} hideSubmit hidden={{ partyId: one.partyId, answers: "1" }}
                          className="asking space-y-5 px-5 py-5 sm:px-6">
                          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                            <Field label="Role here" hint="optional">{roleSelect(one.role)}</Field>
                            <Field label="Contract number"
                              hint={one.contractChangedAt
                                ? `fixed: changed once, from ${one.previousContractNumber}, by ${one.contractChangedByName}, ${fmtDate(one.contractChangedAt)}`
                                : `its contract with us for ${ctx.project.code}; unique on DELIOS, changed once only`}>
                              {one.contractChangedAt
                                ? <input defaultValue={one.contractNumber ?? ""} disabled className={cn(field, "font-mono text-slate-500")} aria-label="Contract number (fixed)" />
                                : <input name="contractNumber" defaultValue={one.contractNumber ?? ""} maxLength={64} className={cn(field, "font-mono")} />}
                            </Field>
                            {theirPeople.length ? (
                              <>
                                <SearchPick single name="contactId" items={theirPeople} initial={party?.contactId ? [party.contactId] : []}
                                  label="Who answers for it here" hint="optional — one of their people, so we know whom to ask" placeholder="Nobody yet" />
                                <SearchPick single name="backupId" items={theirPeople} initial={party?.backupId ? [party.backupId] : []}
                                  label="Backup" hint="optional — who stands in when they are away" placeholder="No backup" />
                              </>
                            ) : null}
                            <Field label="Their people start as" hint="the function their people get here">{startSelect(one.startFunctionId)}</Field>
                            <Field label="Works on it">
                              <select name="active" defaultValue={one.active ? "on" : "off"} className={field}>
                                <option value="on">Yes</option>
                                <option value="off">No longer</option>
                              </select>
                            </Field>
                          </div>
                        </ActionForm>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
                          <Link href={href({}, `part-${one.partyId}`)} scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                          <button type="submit" form={`part-form-${one.partyId}`} data-on="true" className="ask">Save</button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </DataTable>
        ) : <p className="px-5 py-4 text-xs text-slate-500 sm:px-6">No other organization works on {ctx.project.code} yet.</p>}
      </section>
    </div>
  );
}
