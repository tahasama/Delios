import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Select } from "@/components/select";
import { consoleApi } from "@/lib/console/client";
import { setMatterAction } from "@/lib/console/forms";
import { MATTER_TONE, MATTER_WORDS, type LegalTextRow, type Matter } from "@/lib/console/types";
import { cn, fmtDate } from "@/lib/core/utils";
import { LawyerMark, Plate, Sheet } from "../parts";

export const metadata = { title: "Legal" };

type Legal = { texts: LegalTextRow[]; organizations: number; groups: string[]; matters: Matter[] };

/**
 * Every legal matter running DELIOS for many organizations brings (owner: "very important, list every legal matter we
 * must/may have"), by when it is needed, each a must or a may, with where it stands and our notes; and the texts we
 * publish, each with what a lawyer still has to write marked in red. Nothing here is legal advice: it is the list of
 * what to settle, with a lawyer.
 */
export default async function LegalPage() {
  const l = await consoleApi<Legal>("/api/console/legal");
  const musts = l.matters.filter((m) => m.must);
  const open = (m: Matter) => !["IN_FORCE", "NOT_NEEDED"].includes(m.status);
  const lawyer = l.texts.reduce((n, t) => n + t.lawyerParts, 0);
  return (
    <>
      <Plate
        title="Legal"
        meta={<>Every legal matter DELIOS has or may have, and the texts it publishes. What only a lawyer may write is marked <LawyerMark>For a lawyer</LawyerMark>: the texts are placeholders until then.</>}
        figures={[
          { term: "Must, still open", value: `${musts.filter(open).length} of ${musts.length}`, tone: musts.some(open) ? "text-red-700" : "text-emerald-700", said: "before the first paying customer, or while running" },
          { term: "May, as it grows", value: `${l.matters.filter((m) => !m.must && open(m)).length} open`, said: `of ${l.matters.length - musts.length}` },
          { term: "Parts for a lawyer", value: lawyer, tone: lawyer ? "text-red-700" : undefined, said: `in ${l.texts.filter((t) => t.lawyerParts).length} of ${l.texts.length} texts` },
          { term: "Organizations", value: l.organizations, said: "each accepts the terms and the data processing agreement" },
        ]}
      />

      <Sheet title="The texts we publish" said="public at /legal, linked from the sign-in and sign-up pages; a new version never changes an old one">
        <ul className="divide-y divide-line">
          {l.texts.map((t) => (
            <li key={t.kind} className="flex flex-col gap-1.5 px-5 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
              <div className="min-w-0 flex-1">
                <Link href={`/console/legal/${t.slug}`} className="text-[13px] font-semibold text-slate-900 hover:text-link hover:underline">{t.title}</Link>
                <span className="ml-2 text-[11px] text-slate-500">{t.version ? `version ${t.version}, ${fmtDate(t.publishedAt)}` : "not published: the app's starting text"}</span>
                <p className="text-[12px] text-slate-600">{t.lead}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 text-[11px]">
                {t.lawyerParts ? <LawyerMark>{t.lawyerParts} part{t.lawyerParts === 1 ? "" : "s"} for a lawyer</LawyerMark> : <span className="font-semibold text-emerald-700">written</span>}
                {t.accepted ? <span className="text-slate-500">accepted by {t.acceptedBy} of {l.organizations}</span> : null}
                <a href={`/legal/${t.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-link hover:underline">public page <ExternalLink className="h-3 w-3" /></a>
                <Link href={`/console/legal/${t.slug}`} className="inline-flex items-center gap-1 text-link hover:underline">write <ArrowRight className="h-3 w-3" /></Link>
              </div>
            </li>
          ))}
        </ul>
      </Sheet>

      {l.groups.map((group) => {
        const matters = l.matters.filter((m) => m.group === group);
        return (
          <Sheet key={group} title={group} said={`${matters.filter((m) => m.must).length} must · ${matters.filter((m) => !m.must).length} may`}>
            <ul className="divide-y divide-line">
              {matters.map((m) => (
                <li key={m.key} id={`matter-${m.key}`} className="grid gap-3 px-5 py-3.5 target:bg-tint-soft sm:px-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", m.must ? "bg-red-50 text-red-700 ring-1 ring-red-200" : "bg-slate-100 text-slate-600 ring-1 ring-slate-200")}>
                        {m.must ? "Must" : "May"}
                      </span>
                      <span className="text-[13px] font-semibold text-slate-900">{m.title}</span>
                      <span className={cn("text-[12px] font-semibold", MATTER_TONE[m.status])}>{MATTER_WORDS[m.status] ?? m.status}</span>
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-slate-600">{m.what}</p>
                    {m.textSlug ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Its text: <Link href={`/console/legal/${m.textSlug}`} className="text-link hover:underline">{m.textVersion ? `version ${m.textVersion}` : "the starting text"}</Link>
                        {m.textPlaceholder ? <> · <span className="font-semibold text-red-700">still has parts for a lawyer</span></> : null}
                      </p>
                    ) : null}
                    {m.updatedAt ? <p className="mt-1 text-[11px] text-slate-400">Set {fmtDate(m.updatedAt)} by {m.updatedBy}</p> : null}
                  </div>
                  <ActionForm action={setMatterAction} hidden={{ key: m.key }} submitLabel="Save" size="sm" className="asking flex flex-wrap items-end gap-2 space-y-0">
                    <Select name="status" defaultValue={m.status} className="plain w-44">
                      {Object.entries(MATTER_WORDS).filter(([code]) => !(m.must && code === "NOT_NEEDED")).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </Select>
                    <input name="note" defaultValue={m.note ?? ""} placeholder="A note: who, where it is filed…" className="plain min-w-0 flex-1" />
                  </ActionForm>
                </li>
              ))}
            </ul>
          </Sheet>
        );
      })}
      <p className="px-1 text-[11px] leading-5 text-slate-500">
        This list is where to start, not legal advice: each matter is to be settled with a lawyer of the countries DELIOS is sold in.
      </p>
    </>
  );
}
