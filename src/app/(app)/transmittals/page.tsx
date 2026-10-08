import { api } from "@/lib/api/client";
import type { ListValue, TransmittalLog } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { isMigrated } from "@/lib/migrated";
import { LISTS } from "@/lib/lists";
import { TransmittalRegister } from "./transmittal-register";
import { TransmittalPlate } from "./transmittal-plate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Transmittals" };

/** What a transmittal still waits on, as the log says it. */
const STATUSES = [
  { code: "TO_SEND", label: "To send: an organization outside the system" },
  { code: "OVERDUE", label: "Answer overdue" },
  { code: "AWAITING_REPLY", label: "Awaiting their answer" },
  { code: "AWAITING_ACK", label: "To acknowledge" },
  { code: "TO_REGISTER", label: "Received: something unplanned to register" },
  { code: "COMPLETE", label: "Complete" },
];
const STATUS_LABEL: Record<string, string> = { TO_SEND: "To send", OVERDUE: "Answer overdue", AWAITING_REPLY: "Awaiting answer", AWAITING_ACK: "To acknowledge", TO_REGISTER: "To register", COMPLETE: "Complete" };
const WAYS = [{ code: "OUTGOING", label: "Sent by us" }, { code: "INCOMING", label: "Sent to us" }];
const DATE_FIELDS = [{ code: "issued", label: "Issued" }, { code: "due", label: "Answer due" }];
const PASSED = ["q", "status", "reason", "party", "on", "from", "to", "sort", "page", "per"] as const;
type Search = Partial<Record<(typeof PASSED)[number] | "order" | "way", string>>;

/** The transmittal log: everything issued on the project, and what each still waits on. */
export default async function TransmittalsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const query: Record<string, string> = {};
  for (const key of PASSED) if (sp[key]) query[key] = sp[key]!;
  if (sp.order) query.dir = sp.order;
  if (sp.way) query.direction = sp.way;
  const [log, lists, parties] = await Promise.all([
    api<TransmittalLog>(projectPath(session, "/transmittals/log"), { query }),
    api<Record<string, ListValue[]>>("/api/values", { query: { sets: LISTS.reasonsForIssue } }),
    api<{ code: string; name: string }[]>("/api/parties"),
  ]);
  const reasons = lists[LISTS.reasonsForIssue] ?? [];
  const reasonLabel = (code: string) => reasons.find((r) => r.code === code)?.label ?? code;
  const reasonNotes: Record<string, string> = {};
  for (const r of reasons) {
    const answer = r.props?.response === true ? `An answer is expected${typeof r.props?.responseDays === "number" ? ` within ${r.props.responseDays} working days` : ""}.` : "No answer expected.";
    reasonNotes[r.code] = `${r.label}. ${answer}`;
  }
  const rows = log.rows.map((t) => {
    const dueIn = t.responseDue ? Math.round((new Date(t.responseDue).getTime() - Date.now()) / 86_400_000) : null;
    return {
      id: t.id, number: t.number, subject: t.subject, outgoing: t.direction !== "INCOMING", from: t.from ?? t.issuedBy, to: t.toName, reason: t.reason, reasonLabel: reasonLabel(t.reason),
      issuedAt: t.issuedAt, documents: t.documents, status: t.status, statusLabel: STATUS_LABEL[t.status] ?? t.status,
      recipients: t.recipients, copies: 0, dueAt: t.responseDue, dueIn: t.responseRequired && t.status !== "COMPLETE" ? dueIn : null,
      receivedAt: t.direction === "INCOMING" ? t.issuedAt : null, checkedBy: null, replyNeeded: t.responseRequired, replyDays: null,
    };
  });
  const filterQuery = new URLSearchParams(Object.entries(query).filter(([k]) => k !== "page" && k !== "per" && k !== "direction"));
  if (sp.way) filterQuery.set("way", sp.way);
  return (
    <TransmittalRegister
      plate={<TransmittalPlate project={{ code: session.project.code, name: session.project.name }} canCreate={(session.can("CONTROL") || session.can("TRANSMIT")) && session.user.isInternal && isMigrated("/transmittals/new")}
        canSend={!session.user.isInternal || session.can("CONTROL")} onBehalf={session.user.isInternal} />}
      rows={rows}
      total={log.total}
      reasonNotes={reasonNotes}
      paging={{ page: log.page, pages: log.pages, perPage: log.per, sizes: log.sizes, from: log.total ? (log.page - 1) * log.per + 1 : 0, to: Math.min(log.page * log.per, log.total), query: filterQuery.toString() }}
      sort={{ key: sp.sort ?? "", dir: sp.order === "asc" ? "asc" : "desc" }}
      filters={{ q: sp.q ?? "", terms: (sp.q ?? "").split(",").map((t) => t.trim()).filter(Boolean), way: sp.way ?? "", status: sp.status ?? "", reason: sp.reason ?? "", party: sp.party ?? "", on: sp.on ?? "", from: sp.from ?? "", to: sp.to ?? "" }}
      filterOptions={{
        ways: WAYS, statuses: STATUSES,
        reasons: reasons.map((r) => ({ code: r.code, label: r.label })),
        parties: parties.map((p) => ({ code: p.code, label: p.name })),
        dateFields: DATE_FIELDS,
      }}
      exportHref={`/api/export/transmittals${filterQuery.size ? `?${filterQuery}` : ""}`}
    />
  );
}
