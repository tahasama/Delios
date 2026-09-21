import { isAdmin } from "@/lib/auth";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, Chip, DataTable, Th, Td, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { addAuthorityRowAction } from "@/lib/actions/admin";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/standard";
import { getActiveSet } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval authority" };

export default async function AdminAuthorityPage() {
  const { user: me, db } = await requireScope();
  if (!isAdmin(me)) return <PageHeader title="Approval authority" subtitle="Administrators only." />;
  const [rows, criticalities, disciplines, types] = await Promise.all([
    db.authorityRow.findMany({ where: { active: true }, orderBy: { version: "desc" } }),
    getActiveSet("CRITICALITY"),
    getActiveSet("DISCIPLINES"),
    getActiveSet("DOCUMENT_TYPES"),
  ]);
  const versions = [...new Set(rows.map((r) => r.version))];

  const current = versions.length ? Math.max(...versions) : null;
  const name = (rows: { code: string; label: string }[], code: string | null) => (code ? rows.find((r) => r.code === code)?.label ?? code : null);
  const table = (v: number) => (
    <DataTable head={<tr><Th>Discipline</Th><Th>Document type</Th><Th>Criticality</Th><Th>Approved by at least</Th></tr>}>
      {rows.filter((r) => r.version === v).map((r) => (
        <tr key={r.id}>
          <Td className="text-xs">{name(disciplines, r.discipline) ?? <span className="text-slate-300">any</span>}</Td>
          <Td className="text-xs">{name(types, r.docType) ?? <span className="text-slate-300">any</span>}</Td>
          <Td className="text-xs">{name(criticalities, r.criticality) ?? <span className="text-slate-300">any</span>}</Td>
          <Td><Chip className="bg-[#eef3f9] text-[#1e3a5f] ring-[#2d5480]/30">{ROLE_LABEL[r.minRole as Role] ?? r.minRole}</Chip></Td>
        </tr>
      ))}
    </DataTable>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Approval authority" subtitle="Who must approve each kind of document. The most specific matching row wins." />

      <Card title={current ? `In force · version ${current}` : "Nothing published yet"}>
        {current ? table(current) : null}
        <details className="mt-4 border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-[#315f83]">+ Add a row (publishes a new version)</summary>
          <div className="mt-3 max-w-3xl">
            <ActionForm action={addAuthorityRowAction} submitLabel="Publish" size="sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Criticality"><select name="criticality" className={inputCls} defaultValue=""><option value="">any</option>{criticalities.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></Field>
                <Field label="Discipline"><select name="discipline" className={inputCls} defaultValue=""><option value="">any</option>{disciplines.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}</select></Field>
                <Field label="Document type"><select name="docType" className={inputCls} defaultValue=""><option value="">any</option>{types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></Field>
                <Field label="Approved by at least" required>
                  <select name="minRole" required className={inputCls} defaultValue="APPROVER">
                    {ROLES.filter((r) => ["REVIEWER", "APPROVER", "CONTROLLER", "ADMIN"].includes(r)).map((r) => <option key={r} value={r}>{ROLE_LABEL[r as Role]}</option>)}
                  </select>
                </Field>
              </div>
            </ActionForm>
            <p className="mt-2 text-[11px] text-slate-500">Past approvals keep pointing at the version that was in force when they were made.</p>
          </div>
        </details>
      </Card>

      {versions.filter((v) => v !== current).length ? (
        <details className="rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">Earlier versions ({versions.length - 1})</summary>
          <div className="mt-3 space-y-4">
            {versions.filter((v) => v !== current).map((v) => <div key={v}><p className="mb-1 text-xs font-semibold text-slate-500">Version {v}</p>{table(v)}</div>)}
          </div>
        </details>
      ) : null}
    </div>
  );
}
