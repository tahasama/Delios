import { ActionForm } from "@/components/form";
import { DataTable, Th, Td, Field, inputCls } from "@/components/ui";
import { joinPersonAction, switchOrganizationAction } from "@/lib/organization/forms";
import type { OrgScope } from "@/lib/core/org-scope";
import { Sheet } from "./sheet";

type Joined = Awaited<ReturnType<typeof import("@/lib/organization/api").joinedProjects>>;
type Person = { id: string; name: string; active: boolean };

/**
 * The projects of other organizations we take part in: whose, our role there, where it stands, and which of our people
 * work on it, each taken off or put on (with the function its owner gives our people). Shown on Projects.
 */
export function JoinedProjects({ scope, joined, ours, roleLabel }: {
  scope: OrgScope; joined: Joined; ours: Person[]; roleLabel: (code: string | null) => string | null;
}) {
  return (
    <Sheet id="joined" title={`Other organizations' projects (${joined.length})`} note="we take part in them; their owner sets them up">
      {joined.length ? (
        <DataTable className="rounded-none border-0 shadow-none" head={<tr><Th>Project</Th><Th>Whose</Th><Th>Our role</Th><Th>Status</Th><Th>Our people on it</Th></tr>}>
            {joined.map((p) => (
              <tr key={`${p.linkId}-${p.projectId}`} id={`project-${p.projectId}`} className="scroll-mt-4 align-top target:bg-tint-soft">
                <Td>
                  {p.ourPeople.some((one) => one.userId === scope.user.id && one.active) ? (
                    <form action={switchOrganizationAction}>
                      <input type="hidden" name="tenantId" value={p.hostTenantId} />
                      <input type="hidden" name="projectId" value={p.projectId} />
                      <button type="submit" className="text-left hover:underline" title={`Open ${p.code} at ${p.hostOrganization}`}>
                        <span className="font-mono text-xs font-semibold text-link">{p.code}</span> <span className="text-xs text-slate-600">{p.name}</span>
                      </button>
                    </form>
                  ) : (
                    <><span className="font-mono text-xs font-semibold">{p.code}</span> <span className="text-xs text-slate-600">{p.name}</span>
                      <span className="block text-[11px] text-slate-400">you are not on it</span></>
                  )}
                </Td>
                <Td className="text-xs">{p.hostOrganization}</Td>
                <Td className="text-xs">{roleLabel(p.role) ?? <span className="text-slate-400">not stated</span>}</Td>
                <Td className="text-xs">{p.status.toLowerCase()}</Td>
                <Td className="text-xs">
                  {p.ourPeople.length ? (
                    <ul className="space-y-1">
                      {p.ourPeople.map((person) => (
                        <li key={person.userId} className="flex flex-wrap items-center gap-2">
                          <a href={`/organization/people#person-${person.userId}`} className={person.active ? "text-slate-700 hover:underline" : "text-slate-400 line-through"}>{person.name}</a>
                          <span className="text-[11px] text-slate-400">{person.function}</span>
                          {person.active ? (
                            <ActionForm action={joinPersonAction} hideSubmit hidden={{ linkId: p.linkId, projectId: p.projectId, userId: person.userId, active: "off" }} className="space-y-0">
                              <button className="text-[11px] font-semibold text-link hover:underline">take off</button>
                            </ActionForm>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : <span className="text-slate-400">nobody yet</span>}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] font-semibold text-link">+ Put someone of ours on it</summary>
                    <div className="mt-2 w-72">
                      {p.startFunction ? (
                        <ActionForm action={joinPersonAction} submitLabel="Put on the project" size="sm" hidden={{ linkId: p.linkId, projectId: p.projectId }}>
                          <Field label="Who" required>
                            <select name="userId" required defaultValue="" className={inputCls}>
                              <option value="" disabled>Choose…</option>
                              {ours.filter((u) => u.active && !p.ourPeople.some((one) => one.userId === u.id && one.active)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                          </Field>
                          <p className="text-[11px] text-slate-400">They work there as {p.startFunction}, signing in here as usual. {p.hostOrganization} may change it.</p>
                        </ActionForm>
                      ) : <p className="text-[11px] text-amber-700">{p.hostOrganization} has not said yet which function our people hold there.</p>}
                    </div>
                  </details>
                </Td>
              </tr>
            ))}
        </DataTable>
      ) : <p className="px-5 py-3 text-xs text-slate-500 sm:px-6">None: no other organization has us on its projects.</p>}
    </Sheet>
  );
}
