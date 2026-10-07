import { api } from "@/lib/api/client";
import type { ListValue, ReviewsPage as Page } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { isMigrated } from "@/lib/migrated";
import { ReviewsRegister, type ReviewRow } from "./reviews-register";
import { ReviewsPlate } from "./reviews-plate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

const STATUSES = [{ code: "OPEN", label: "Open" }, { code: "CLOSED", label: "Closed" }];
const DUES = [{ code: "OVERDUE", label: "Overdue" }, { code: "SOON", label: "Due within three days" }, { code: "NONE", label: "No date given" }];
const DATE_FIELDS = [{ code: "opened", label: "Opened" }, { code: "due", label: "Due" }, { code: "closed", label: "Closed" }];
const PASSED = ["q", "status", "verdict", "due", "discipline", "docType", "supplier", "deliverable", "on", "from", "to", "sort", "dir", "page", "per"] as const;
type Search = Partial<Record<(typeof PASSED)[number] | "kind" | "po", string>>;

function day(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : null;
}

/** Where a step stands against its day. */
function dueState(due: string | null, open: boolean): string {
  if (!open || !due) return "none";
  const days = (new Date(due).getTime() - Date.now()) / 86_400_000;
  return days < -1 ? "overdue" : days <= 3 ? "at risk" : "on time";
}

/**
 * Every review on the project, one row per review: where it stands, who it
 * waits on, its verdict. The backend filters, sorts and pages.
 */
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const query: Record<string, string> = {};
  for (const key of PASSED) if (sp[key]) query[key] = sp[key]!;
  const [data, lists, parties] = await Promise.all([
    api<Page>(projectPath(session, "/reviews"), { query }),
    api<Record<string, ListValue[]>>("/api/values", { query: { sets: "REVIEW_OUTCOMES,DISCIPLINES,DOCUMENT_TYPES,DELIVERABLE_TYPES" } }),
    api<{ code: string; name: string }[]>("/api/parties"),
  ]);
  const label = (set: string, code: string | null) => (code ? lists[set]?.find((v) => v.code === code)?.label ?? code : null);
  const proceeds = (code: string) => lists.REVIEW_OUTCOMES?.find((v) => v.code === code)?.props?.proceed;

  const rows: ReviewRow[] = data.rows.map((r) => ({
    id: r.id, number: r.number, documentId: r.documentId, docNumber: r.documentNumber, title: r.title, revision: r.revision,
    kind: "decision",
    verdict: r.verdict, verdictLabel: label("REVIEW_OUTCOMES", r.verdict), verdictProceeds: r.verdict ? (proceeds(r.verdict) as boolean | undefined) ?? null : null,
    decidedBy: r.decidedBy, open: r.open,
    reviewers: r.reviewers, doneCount: r.reviewers.filter((p) => p.done).length,
    dueAt: day(r.dueDate), dueState: dueState(r.dueDate, r.open),
    routeName: r.stepTitle ? `${r.routeName} · step ${r.currentStep}: ${r.stepTitle}` : r.routeName, routeDays: null,
    routeDueAt: day(r.routeDueDate), routeDueState: dueState(r.routeDueDate, r.open) as ReviewRow["routeDueState"],
    notifyHref: null, warnedAt: null,
    openedAt: day(r.startedAt)!, openedBy: r.startedBy, closedAt: day(r.closedAt),
    discipline: label("DISCIPLINES", r.discipline)!, docType: label("DOCUMENT_TYPES", r.docType)!, producedBy: label("DELIVERABLE_TYPES", r.deliverableType)!,
    from: r.originator, contract: r.contractRef, receivedAt: day(r.receivedAt), receivedFrom: r.originator,
    comments: r.comments.map((c) => ({ ...c, review: r.number })),
  }));

  const filterQuery = new URLSearchParams(Object.entries(query).filter(([k]) => k !== "page" && k !== "per"));
  const drop = (key: string) => {
    const q = new URLSearchParams(filterQuery);
    q.delete(key);
    return `/reviews${q.size ? `?${q}` : ""}`;
  };
  const facets: { key: string; label: string; without: string }[] = [];
  if (sp.q) facets.push({ key: "search", label: sp.q, without: drop("q") });
  if (sp.verdict) facets.push({ key: "verdict", label: sp.verdict, without: drop("verdict") });
  if (sp.due) facets.push({ key: "due", label: DUES.find((d) => d.code === sp.due)?.label ?? sp.due, without: drop("due") });
  if (sp.discipline) facets.push({ key: "discipline", label: label("DISCIPLINES", sp.discipline)!, without: drop("discipline") });
  if (sp.docType) facets.push({ key: "type", label: label("DOCUMENT_TYPES", sp.docType)!, without: drop("docType") });
  if (sp.supplier) facets.push({ key: "supplier", label: parties.find((p) => p.code === sp.supplier)?.name ?? sp.supplier, without: drop("supplier") });
  if (sp.deliverable) facets.push({ key: "produced by", label: label("DELIVERABLE_TYPES", sp.deliverable)!, without: drop("deliverable") });
  if (sp.on && (sp.from || sp.to)) facets.push({ key: DATE_FIELDS.find((f) => f.code === sp.on)?.label.toLowerCase() ?? sp.on, label: `${sp.from ?? "…"} to ${sp.to ?? "…"}`, without: drop("on") });

  const active = (set: string) => (lists[set] ?? []).filter((v) => v.status === "ACTIVE").map((v) => ({ code: v.code, label: v.label }));
  return (
    <ReviewsRegister
      plate={<ReviewsPlate canStart={(session.can("CREATE") || session.can("REVISE")) && isMigrated("/reviews/send")} />}
      rows={rows}
      total={data.total}
      filters={{ q: sp.q ?? "", status: sp.status ?? "", kind: "", verdict: sp.verdict ?? "", due: sp.due ?? "", discipline: sp.discipline ?? "", docType: sp.docType ?? "", supplier: sp.supplier ?? "", po: "", deliverable: sp.deliverable ?? "", on: sp.on ?? "", from: sp.from ?? "", to: sp.to ?? "" }}
      filterOptions={{
        statuses: STATUSES, kinds: [],
        verdicts: (lists.REVIEW_OUTCOMES ?? []).map((v) => ({ code: v.code, label: `${v.code}: ${v.label}` })),
        dues: DUES, disciplines: active("DISCIPLINES"), types: active("DOCUMENT_TYPES"),
        suppliers: parties.map((p) => ({ code: p.code, label: p.name })), pos: [], deliverables: active("DELIVERABLE_TYPES"),
        dateFields: DATE_FIELDS,
      }}
      facets={facets}
      paging={{
        page: data.page, pages: data.pages, perPage: data.per, sizes: data.sizes,
        from: data.total ? (data.page - 1) * data.per + 1 : 0, to: Math.min(data.page * data.per, data.total), query: filterQuery.toString(),
      }}
      sort={{ key: sp.sort ?? "", dir: sp.dir === "desc" ? "desc" : "asc" }}
      exportHref={`/api/export/reviews${filterQuery.size ? `?${filterQuery}` : ""}`}
    />
  );
}
