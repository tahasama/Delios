import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { getActiveSet } from "@/lib/config";
import { PageHeader, Card, DataTable, Th, Td, Chip } from "@/components/ui";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Codes explained" };

/**
 * What the short codes on a document mean. Three different things are often
 * all called "status"; this page keeps them apart and shows the organization's
 * own lists, since those — not a fixed international list — are what apply.
 */
export default async function CodesPage() {
  const ctx = await requireScope();
  const [statuses, outcomes] = await Promise.all([getActiveSet("STATUSES"), getActiveSet("REVIEW_OUTCOMES")]);
  const canEdit = ctx.can("CONFIGURE");
  const text = (v: unknown) => (typeof v === "string" && v !== "—" ? v : null);

  return (
    <div className="space-y-5">
      <Link href="/guide" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" /> Help & orientation</Link>
      <PageHeader
        title="Codes explained"
        subtitle="A document carries three separate pieces of information that are easy to mix up. Each answers a different question."
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Explainer n="1" title="Where it is" example="Draft · In review · Released" body="How far the document has gone through the process. Set by the system as work moves — nobody types it." />
        <Explainer n="2" title="Status code" example="IFC · AFC · IFI" body="What a released revision may be used for. Chosen when the revision is released, and printed on the document and transmittal." />
        <Explainer n="3" title="Review outcome" example="Code 1 … Code 4" body="What the reviewer decided about a submitted revision. It decides whether the originator may proceed or must resubmit." />
      </div>

      <Card
        title="Status codes — what a released revision may be used for"
        description="A revision can only be used for what its code allows. Codes that permit work on site or in the shop are marked; a transmittal for execution only accepts those."
      >
        <DataTable id="codes-statuses" toolbar={false} head={<tr><Th>Code</Th><Th>Meaning</Th><Th>Allows work</Th><Th>You may</Th><Th>You may not</Th></tr>}>
          {statuses.map((s) => (
            <tr key={s.code}>
              <Td className="font-mono text-sm font-bold text-slate-900">{s.code}</Td>
              <Td className="whitespace-nowrap font-medium text-slate-800">{s.label}</Td>
              <Td>{s.props.executionFlag ? <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">yes</Chip> : <Chip className="bg-slate-100 text-slate-500 ring-slate-200">no</Chip>}</Td>
              <Td className="text-xs">{text(s.props.may) ?? <span className="text-slate-300">—</span>}</Td>
              <Td className="text-xs">{text(s.props.mayNot) ?? <span className="text-slate-300">—</span>}</Td>
            </tr>
          ))}
        </DataTable>
        <div className="mt-4 rounded-xl bg-tint-soft p-4 text-xs leading-5 text-slate-600">
          <p className="font-semibold text-slate-800">IFC or AFC?</p>
          <p className="mt-1">
            Both let people build. <strong>IFC — Issued for construction</strong> is released by the author&apos;s side for building.{" "}
            <strong>AFC — Approved for construction</strong> says the client or engineer has also approved it, typically after a review that returned Code 1 or 2.
            Which one a project uses is a contract decision; many use only one of them.
          </p>
        </div>
      </Card>

      <Card title="Review outcomes — what the reviewer decided" description="Some projects write these as A / B / C / D; they mean the same.">
        <DataTable id="codes-outcomes" toolbar={false} head={<tr><Th>Code</Th><Th>Meaning</Th><Th>Originator may proceed</Th><Th>Must resubmit</Th></tr>}>
          {outcomes.map((o) => (
            <tr key={o.code}>
              <Td className="font-mono text-sm font-bold text-slate-900">{o.code}</Td>
              <Td className="whitespace-nowrap font-medium text-slate-800">{o.label}</Td>
              <Td>{o.props.proceed ? "yes" : "no"}</Td>
              <Td>{o.props.resubmit ? "yes" : "no"}</Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Who decides these lists">
        <div className="space-y-2 text-sm leading-6 text-slate-600">
          <p>
            There is no single international list. IFI, IFR, IFC, AFC and As-built are common industry practice, but every client and contract
            words them a little differently — and some use other schemes altogether, such as the S1–S4 / A1–A3 suitability codes of ISO 19650.
          </p>
          <p>
            So the codes are not built into the system. Your organization publishes its own lists, started from a profile when the organization was set up;
            every project then uses them. Changing a list goes through the same review and approval as any other controlled setting.
          </p>
          {canEdit ? (
            <p className="flex flex-wrap gap-3 pt-1 text-xs font-semibold">
              <Link href="/admin/config?set=STATUSES" className="text-link hover:underline">Edit status codes →</Link>
              <Link href="/admin/config?set=REVIEW_OUTCOMES" className="text-link hover:underline">Edit review outcomes →</Link>
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function Explainer({ n, title, example, body }: { n: string; title: string; example: string; body: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><span className="grid h-6 w-6 place-items-center rounded-full bg-tint text-xs font-bold text-brand-ink">{n}</span>{title}</p>
      <p className="mt-2 font-mono text-xs text-slate-500">{example}</p>
      <p className="mt-2 text-xs leading-5 text-slate-600">{body}</p>
    </div>
  );
}
