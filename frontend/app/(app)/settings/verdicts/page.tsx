import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { api } from "@/lib/client";
import { PageHeader, DataTable, Th, Td, Field, inputCls, ToneChip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { VERDICT_EFFECT } from "@/lib/reviews/verdict-effect";
import { createVerdictListAction, updateVerdictListAction } from "@/lib/settings/forms-verdicts";
import { VerdictRows } from "./verdict-rows";
import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { NoAccess } from "../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verdict lists" };

type VerdictList = {
  key: string; title: string; description: string | null; starter: boolean; routes: string[];
  verdicts: { code: string; label: string; status: string; meaning: string | null }[];
};

const MEANING = Object.fromEntries(VERDICT_EFFECT.map((o) => [o.value, o.label.split(" — ")[0]]));

/**
 * What a review decides with: each verdict list, its verdicts and what each means, and the routes deciding from it.
 * A list is made here as one (`VerdictListEndpoints`): every verdict says its meaning, one at least lets a revision be
 * released. A route then chooses the list (Settings, Review routes); a route for suppliers' documents serves the
 * supplier deliverable type.
 */
export default async function VerdictListsPage() {
  const { user: me } = await requireScope();
  if (!maySetup(me, SETUP_PAGES.find((p) => p.href === "/settings/verdicts")!)) {
    return <NoAccess title="Verdict lists" who="admin" />;
  }
  const lists = await api<VerdictList[]>("/api/admin/verdict-lists");

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-5 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Verdict lists</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            What the deciding step of a review answers with. Each verdict says what it means, whatever it is called: accepted,
            accepted with comments, rejected, or for information. A route chooses its list in{" "}
            <Link href="/settings/workflow-templates" className="text-link hover:underline">Review routes</Link>; a route for
            suppliers&apos; documents serves their deliverable type.
          </p>
        </div>
      </section>

      {lists.map((list) => {
        const unset = list.verdicts.filter((v) => v.status === "ACTIVE" && !v.meaning).length;
        return (
          <section key={list.key} className="register register-sheet register-sheet-open">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 sm:px-6">
              <span className="text-[14px] font-semibold text-slate-900">{list.title}</span>
              {list.starter ? <ToneChip tone="idle">the starter list</ToneChip> : null}
              {unset ? <ToneChip tone="waiting">{unset} without a meaning</ToneChip> : null}
              <span className="text-[11px] text-slate-500">{list.routes.length ? `decides ${list.routes.join(", ")}` : "no route decides from it yet"}</span>
            </div>
            <DataTable className="rounded-none border-0 shadow-none" id={`verdicts-${list.key}`}
              head={<tr><Th>Code</Th><Th>Label</Th><Th>What it means</Th><Th>Status</Th></tr>}>
              {list.verdicts.map((v) => (
                <tr key={v.code}>
                  <Td className="font-mono text-xs font-semibold">{v.code}</Td>
                  <Td className="text-[13px] text-slate-800">{v.label}</Td>
                  <Td className={v.meaning ? "text-xs text-slate-600" : "text-xs text-amber-700"}>{v.meaning ? MEANING[v.meaning] : "not chosen yet"}</Td>
                  <Td className="text-xs text-slate-500">{v.status === "ACTIVE" ? "in use" : "retired"}</Td>
                </tr>
              ))}
            </DataTable>
            <details open={unset > 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-6 [&::-webkit-details-marker]:hidden">
                <span className="text-[13px] text-slate-600">{unset ? "Say what each verdict means, then save." : "A verdict to add, rename or retire?"}</span>
                <span className="ask inline-flex items-center gap-1.5"><Pencil className="h-3.5 w-3.5" /> Edit</span>
              </summary>
              <div className="border-t border-line px-5 py-4 sm:px-6">
                <ActionForm action={updateVerdictListAction} submitLabel="Save" size="sm" hidden={{ key: list.key }}>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
                    <Field label="Name" required><input name="title" required defaultValue={list.title} className={inputCls} /></Field>
                    <Field label="Description" className="md:col-span-2"><input name="description" defaultValue={list.description ?? ""} className={inputCls} /></Field>
                  </div>
                  <VerdictRows verdicts={list.verdicts} />
                </ActionForm>
              </div>
            </details>
          </section>
        );
      })}

      <details className="register register-sheet register-sheet-open">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6 [&::-webkit-details-marker]:hidden">
          <span className="text-[13px] text-slate-600">Some documents decided with other verdicts (suppliers&apos;, say)?</span>
          <span className="ask inline-flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> New verdict list</span>
        </summary>
        <div className="border-t border-line px-5 py-4 sm:px-6">
          <ActionForm action={createVerdictListAction} submitLabel="Publish the list" size="sm">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
              <Field label="Name" required><input name="title" required className={inputCls} /></Field>
              <Field label="Description" className="md:col-span-2"><input name="description" className={inputCls} /></Field>
            </div>
            <VerdictRows verdicts={[]} />
          </ActionForm>
        </div>
      </details>
    </div>
  );
}
