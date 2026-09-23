import { isAdmin } from "@/lib/auth";
import { requireScope } from "@/lib/scope";
import { saveDistributionRuleAction, deleteDistributionRuleAction } from "@/lib/actions/retention";
import { getActiveSet } from "@/lib/config";
import { PageHeader, Card, DataTable, Th, Td, Chip, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { savePartyAction } from "@/lib/actions/workflow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Parties & people" };

// §0.3 — our organization and the external parties it exchanges information with.
export default async function AdminPartiesPage() {
  const { user: me, db } = await requireScope();
  if (!isAdmin(me)) return <PageHeader title="Parties" subtitle="Administrators only." />;
  const [parties, rules, deliverables, confs] = await Promise.all([
    db.party.findMany({ orderBy: [{ isInternal: "desc" }, { name: "asc" }], include: { _count: { select: { users: true } } } }),
    db.distributionRule.findMany({ orderBy: [{ deliverableType: "asc" }, { confidentiality: "asc" }] }),
    getActiveSet("DELIVERABLE_TYPES"),
    getActiveSet("CONFIDENTIALITY"),
  ]);
  const users = await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id;
  const mayEdit = true; // this page is administrators only

  return (
    <div className="space-y-4">
      <PageHeader
        title="Parties"
        subtitle="Your organization and the companies you exchange documents with. Assign people to them in People & access."
      />
      <div className="space-y-4">
        <div className="space-y-4">
          <Card title={`Parties (${parties.length})`}>
            <DataTable head={<tr><Th>Code</Th><Th>Name</Th><Th>Type</Th><Th>People</Th><Th></Th></tr>}>
              {parties.map((p) => (
                <tr key={p.id} className={p.active ? "align-top" : "align-top opacity-60"}>
                  <Td className="font-mono text-xs font-semibold">{p.code}</Td>
                  <Td>{p.name}</Td>
                  <Td><Chip className={p.isInternal ? "bg-sky-100 text-sky-800 ring-sky-300" : "bg-violet-100 text-violet-800 ring-violet-300"}>{p.isInternal ? "our organization" : "external"}</Chip></Td>
                  <Td className="tabular-nums text-xs">{p._count.users}{p.active ? "" : <span className="block text-[11px] font-semibold text-red-700">access revoked</span>}</Td>
                  <Td>
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-link">Edit</summary>
                      <div className="mt-2 w-64">
                        <ActionForm action={savePartyAction} submitLabel="Save" size="sm" hidden={{ id: p.id, code: p.code }}>
                          <Field label="Name" required><input name="name" required defaultValue={p.name} className={inputCls} /></Field>
                          {p.isInternal ? null : (
                            <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="active" defaultChecked={p.active} /> Has access — untick to revoke; its {p._count.users} {p._count.users === 1 ? "person" : "people"} can no longer sign in</label>
                          )}
                          {p.isInternal ? <input type="hidden" name="active" value="on" /> : null}
                        </ActionForm>
                      </div>
                    </details>
                  </Td>
                </tr>
              ))}
            </DataTable>
          </Card>
        </div>
        <details className="rounded-2xl border border-slate-200 bg-surface px-5 py-3 shadow-sm"><summary className="cursor-pointer text-sm font-semibold text-brand-ink">+ Add a party</summary><div className="mt-3 max-w-2xl">
          <ActionForm action={savePartyAction} submitLabel="Add party" size="sm">
            <Field label="Code" required hint="short, unique — e.g. MADASUD">
              <input name="code" required maxLength={20} className={inputCls} />
            </Field>
            <Field label="Name" required>
              <input name="name" required className={inputCls} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="isInternal" /> This is our organization (internal)
            </label>
          </ActionForm>
        </div></details>
      <Card
        title={`External parties (${rules.length})`}
        description="Organizations with no account here that must still receive certain documents."
      >
        <div className="space-y-3">
          <div>
            {rules.length === 0 ? (
              <p className="text-xs text-slate-400">
                None.
              </p>
            ) : (
              <DataTable head={<tr><Th>Deliverable type</Th><Th>Confidentiality</Th><Th>Internal</Th><Th>External parties</Th><Th></Th></tr>}>
                {rules.map((r) => {
                  const ids = JSON.parse(r.userIds) as string[];
                  const parties = r.partyNames ? (JSON.parse(r.partyNames) as string[]) : [];
                  return (
                    <tr key={r.id}>
                      <Td className="font-mono text-xs">{r.deliverableType}</Td>
                      <Td><Chip>{r.confidentiality}</Chip></Td>
                      <Td className="text-xs">{ids.map(nameOf).join(", ") || "—"}</Td>
                      <Td className="text-xs">{parties.join(", ") || "—"}</Td>
                      <Td>
                        {mayEdit ? <form action={deleteDistributionRuleAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="text-xs text-slate-400 hover:text-red-600">remove</button>
                        </form> : null}
                      </Td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </div>

          {mayEdit ? <details className="max-w-xl">
            <summary className="cursor-pointer text-xs font-semibold text-link">+ Add an external party</summary>
            <div className="mt-3">
            <ActionForm action={saveDistributionRuleAction} submitLabel="Add" size="sm">
              <Field label="Deliverable type" required>
                <select name="deliverableType" required className={inputCls} defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {deliverables.map((d) => <option key={d.code} value={d.code}>{d.code} — {d.label}</option>)}
                </select>
              </Field>
              <Field label="Confidentiality" required>
                <select name="confidentiality" className={inputCls} defaultValue="INTERNAL">
                  {confs.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="External parties" hint="One per line — organizations without accounts here">
                <textarea name="partyNames" rows={3} className={inputCls} placeholder={"Client engineering\nCertifying authority"} />
              </Field>
              <Field label="Also these people" hint="Only if someone needs it outside their function">
                <select name="userIds" multiple size={4} className={`${inputCls} h-auto py-1.5`}>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
            </ActionForm>
            </div>
          </details> : null}
        </div>
      </Card>
      </div>
    </div>
  );
}
