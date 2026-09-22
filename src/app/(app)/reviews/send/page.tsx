import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card } from "@/components/ui";
import { SendForReview } from "@/components/send-for-review-panel";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Send for review" };

/** Several documents at once, through the same form a single document uses. */
export default async function SendForReviewPage({ searchParams }: { searchParams: Promise<{ revisions?: string }> }) {
  const { db } = await requireScope();
  const ids = ((await searchParams).revisions ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const revisions = await db.revision.findMany({ where: { id: { in: ids }, state: "IN_PREPARATION" }, include: { document: true } });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Send for review"
        subtitle={`${revisions.length} document${revisions.length === 1 ? "" : "s"} — each follows the route with the people chosen below.`}
        actions={<Link href="/documents" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Documents</Link>}
      />
      <Card className="max-w-3xl">
        <ul className="mb-4 space-y-1 text-xs">
          {revisions.map((r) => (
            <li key={r.id}><Link href={`/documents/${r.documentId}`} className="font-mono font-semibold text-brand-ink hover:underline">{r.document.docNumber}</Link> <span className="text-slate-500">rev {r.value} — {r.document.title}</span></li>
          ))}
        </ul>
        {revisions.length ? <SendForReview revisionIds={revisions.map((r) => r.id)} /> : <p className="text-sm text-slate-500">None of the selected documents has a revision ready to send.</p>}
      </Card>
    </div>
  );
}
