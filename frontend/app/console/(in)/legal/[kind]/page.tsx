import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { LegalText, lawyerParts } from "@/components/legal-text";
import { consoleApi } from "@/lib/console/client";
import { publishLegalAction } from "@/lib/console/forms";
import { fmtDateTime } from "@/lib/core/utils";
import { LawyerMark, Nothing, Plate, Sheet } from "../../parts";

export const metadata = { title: "Legal text" };

type Kind = {
  current: { kind: string; slug: string; title: string; lead: string; version: number; publishedAt: string | null; body: string; note: string | null; placeholder: boolean };
  versions: { version: number; title: string; note: string | null; publishedAt: string; publishedBy: string; acceptedBy: number }[];
  accepted: boolean;
};

/** One legal text: as it reads now (a lawyer's parts in red), every version published, and the next version written. */
export default async function LegalKind({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const k = await consoleApi<Kind>(`/api/console/legal/${kind}`);
  const c = k.current;
  const parts = lawyerParts(c.body);
  return (
    <>
      <Link href="/console/legal" className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-link"><ArrowLeft className="h-3.5 w-3.5" /> Legal</Link>
      <Plate
        title={c.title}
        meta={c.lead}
        acts={<a href={`/legal/${c.slug}`} target="_blank" rel="noreferrer" className="ask"><ExternalLink className="h-3.5 w-3.5" /> Public page</a>}
        figures={[
          { term: "Version", value: c.version || "none", said: c.version ? fmtDateTime(c.publishedAt) : "the app's starting text, not published" },
          { term: "For a lawyer", value: parts, tone: parts ? "text-red-700" : "text-emerald-700", said: parts ? "parts still to write" : "nothing left" },
          { term: "Accepted", value: k.accepted ? "by each organization" : "read only", said: k.accepted ? "a new version is announced to every administrator" : "published, not signed" },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Sheet title="As it reads now" said={parts ? <LawyerMark>red: a lawyer writes it</LawyerMark> : undefined}>
          <div className="px-5 py-4 sm:px-6"><LegalText body={c.body} /></div>
        </Sheet>
        <Sheet title={`Write version ${c.version + 1}`} said="published as a new version; the old ones stay, with who accepted them">
          <ActionForm action={publishLegalAction} hidden={{ kind: c.kind }} submitLabel={`Publish version ${c.version + 1}`}
            confirmText={k.accepted ? "Every organization's administrators are told, and asked to accept it." : undefined} className="asking space-y-4 px-5 py-4 sm:px-6">
            <Field label="Title" required><input name="title" required defaultValue={c.title} className="plain w-full" /></Field>
            <Field label="The text" required hint="## a heading · - a list line · [[LAWYER: …]] a part still for a lawyer">
              <textarea name="body" required rows={28} defaultValue={c.body} className={`${inputCls} font-mono text-[12px] leading-5`} />
            </Field>
            <Field label="What changed" hint="said to whoever accepted the version before"><input name="note" className="plain w-full" /></Field>
          </ActionForm>
        </Sheet>
      </div>
      <Sheet title="Versions published">
        {k.versions.length ? (
          <ul className="divide-y divide-line">
            {k.versions.map((v) => (
              <li key={v.version} className="px-5 py-2.5 text-[13px] sm:px-6">
                <span className="font-medium text-slate-900">Version {v.version}</span> · {fmtDateTime(v.publishedAt)} by {v.publishedBy}
                {k.accepted ? <span className="text-slate-500"> · accepted by {v.acceptedBy} organization{v.acceptedBy === 1 ? "" : "s"}</span> : null}
                {v.note ? <span className="block text-[12px] text-slate-600">{v.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : <Nothing>None yet: the public page shows the app&rsquo;s starting text, marked as not published.</Nothing>}
      </Sheet>
    </>
  );
}
