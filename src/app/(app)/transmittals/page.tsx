import { requireScope } from "@/lib/scope";
import { addressees, ourOrganizationName, transmittalLog } from "@/lib/api/transmittals";
import { REASONS_FOR_ISSUE, REASON_LABEL, type ReasonForIssue } from "@/lib/standard";
import { TransmittalRegister } from "./transmittal-register";
import { TransmittalPlate } from "./transmittal-plate";
import { isReadOnly } from "@/lib/auth";
import { getSet } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Transmittals" };

/** How many rows a page holds. 50 is the default: a screen and a half. */
const PAGE_SIZES = [25, 50, 100, 250];

/** What a transmittal can be, said the way the log says it. */
const STATUSES = [
  { code: "DRAFT", label: "Draft — nothing sent yet" },
  { code: "ISSUED", label: "Issued — recipients told" },
  { code: "TO_CHECK", label: "To check — arrived, waiting on us" },
  { code: "ACCEPTED", label: "Accepted" },
  { code: "REJECTED", label: "Rejected" },
] as const;
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", ISSUED: "Issued", ACCEPTED: "Accepted", REJECTED: "Rejected",
};

const WAYS = [
  { code: "OUTGOING", label: "Sent — out to another party" },
  { code: "INCOMING", label: "Received — in to us" },
];

/** The dates a transmittal carries, and which one a filter means. */
const DATE_FIELDS = [
  { key: "issued", label: "Issued" },
  { key: "due", label: "Reply due" },
  { key: "received", label: "Received" },
  { key: "created", label: "Written" },
] as const;

type Search = {
  q?: string; way?: string; status?: string; reason?: string; party?: string;
  on?: string; from?: string; to?: string;
  sort?: string; order?: string; page?: string; per?: string;
  /** Older links still say ?view= or ?direction=. */
  view?: string; direction?: string;
};

/** Which date the backend reads for each date filter: it keeps the day a transmittal went (or arrived) and the day an answer is due. */
const DATE_ON: Record<string, string> = {
  issued: "issued",
  due: "due",
  received: "issued",
  created: "issued",
};

/** The orders the log offers. */
const SORT_KEYS = ["number", "from", "to", "reason", "issued", "documents", "subject", "received", "status", "due"];

const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export default async function TransmittalsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const scope = await requireScope();
  const { user, project } = scope;
  const sp = await searchParams;

  // Two rules, and only two, as in the document register: a space narrows, a
  // comma widens. A quoted phrase counts as one word.
  const q = (sp.q ?? "").trim();
  const searches = q.split(",").map((part) => part.trim()).filter(Boolean).slice(0, 8)
    .map((part) => ({ text: part, words: [...part.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean).slice(0, 6) }))
    .filter((search) => search.words.length);
  const terms = searches.map((search) => search.text);

  // Old links: ?view=check meant incoming and still to be checked.
  const legacy = sp.view === "check" ? { way: "INCOMING", status: "TO_CHECK" }
    : sp.view === "drafts" ? { way: "", status: "DRAFT" }
      : sp.view === "out" || sp.direction === "OUTGOING" ? { way: "OUTGOING", status: "" }
        : sp.view === "in" || sp.direction === "INCOMING" ? { way: "INCOMING", status: "" }
          : { way: "", status: "" };
  const way = WAYS.some((item) => item.code === sp.way) ? sp.way! : legacy.way;
  const status = STATUSES.some((item) => item.code === sp.status) ? sp.status! : legacy.status;
  const reason = REASONS_FOR_ISSUE.includes(sp.reason as ReasonForIssue) ? sp.reason! : "";
  const party = (sp.party ?? "").trim();

  const dateOn = DATE_FIELDS.some((field) => field.key === sp.on) ? sp.on! : "";
  const readDay = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");
  const from = readDay(sp.from);
  const to = readDay(sp.to);

  const sort = sp.sort && SORT_KEYS.includes(sp.sort) ? sp.sort : "";
  const dir = sp.order === "asc" ? ("asc" as const) : ("desc" as const);
  const perPage = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 50;
  const page = Math.max(1, Number(sp.page) || 1);

  // What the old log called a status, asked of the backend as what each
  // transmittal still waits on. Nothing is a draft and nothing is rejected
  // there, so those ask for nothing; "to check" is what arrived and waits on us.
  const STATUS_QUERY: Record<string, { status?: string; direction?: string } | null> = {
    DRAFT: null,
    REJECTED: null,
    ISSUED: way === "INCOMING" ? { status: "TO_REGISTER" } : { direction: "OUTGOING" },
    TO_CHECK: { status: "TO_REGISTER", direction: "INCOMING" },
    ACCEPTED: { status: "COMPLETE", direction: "INCOMING" },
  };
  const asked = status ? STATUS_QUERY[status] : {};
  const nothing = !asked || (!!asked.direction && !!way && asked.direction !== way);

  // Which order the backend can give for each: the rest fall back to the day it went.
  const SORTS: Record<string, string> = {
    number: "", from: "from", to: "to", reason: "reason", issued: "", documents: "documents",
    subject: "", received: "", status: "status", due: "due",
  };

  // Parties are filtered by their code; the log offers them by name.
  const [log, found, publishedReasons] = await Promise.all([
    nothing
      ? null
      : transmittalLog(scope, {
          q, direction: asked?.direction ?? way, status: asked?.status, reason, party,
          on: dateOn ? DATE_ON[dateOn] : "", from: dateOn ? from : "", to: dateOn ? to : "",
          sort: sort ? SORTS[sort] : "", dir, page, per: perPage,
        }),
    addressees(scope),
    getSet("REASONS_FOR_ISSUE"),
  ]);
  const total = log?.total ?? 0;

  // The reasons come from the organization's own published list, so the words
  // in the filter and the note on hover are the words it chose. The Standard's
  // own names stand in only until that list is published.
  const reasonLabel = new Map<string, string>([
    ...REASONS_FOR_ISSUE.map((code) => [code, REASON_LABEL[code]] as [string, string]),
    ...publishedReasons.map((item) => [item.code, item.label] as [string, string]),
  ]);
  const reasonNotes: Record<string, string> = {};
  // How many working days an answer is owed in, as the reason publishes it.
  const reasonDays = new Map(publishedReasons.flatMap((item) => (typeof item.props.responseDays === "number" ? [[item.code, item.props.responseDays] as [string, number]] : [])));
  for (const item of publishedReasons) {
    const maturity = typeof item.props.maturity === "string" ? `\nRevision must be: ${item.props.maturity}` : "";
    const owed = typeof item.props.responseDays === "number" ? ` within ${item.props.responseDays} working days` : "";
    const reply = item.props.response ? `\nAn answer is owed${owed}.` : "\nNo answer is owed.";
    reasonNotes[item.code] = `${item.label}${maturity}${reply}`;
  }
  const reasonOptions = (publishedReasons.length ? publishedReasons.map((item) => ({ code: item.code, label: item.label })) : REASONS_FOR_ISSUE.map((code) => ({ code, label: REASON_LABEL[code] })));


  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(page, pages);

  const ourOrganization = await ourOrganizationName();
  const today = midnight(new Date());

  const rows = (log?.rows ?? []).map((item) => {
    const outgoing = item.direction === "OUTGOING";
    // Everything the backend holds was sent; what arrived waits on us while
    // something on it is still to be registered.
    const state = outgoing || item.status === "TO_REGISTER" ? "ISSUED" : "ACCEPTED";
    const due = item.responseDue ? new Date(`${item.responseDue}T00:00:00`) : null;
    return {
      id: item.id,
      number: item.number,
      subject: item.subject,
      outgoing,
      from: outgoing ? ourOrganization : item.from ?? item.issuedBy,
      to: outgoing ? item.toName || "nobody yet" : ourOrganization,
      reason: item.reason,
      reasonLabel: reasonLabel.get(item.reason) ?? item.reason,
      issuedAt: item.issuedAt,
      documents: item.documents,
      status: state,
      // What arrived and has not been answered is said as the job it is.
      statusLabel: !outgoing && state === "ISSUED" ? "To check" : STATUS_LABEL[state] ?? state.toLowerCase(),
      // Seen is the backend's: a person acknowledged it, or an organization
      // with no accounts here was sent it by one of ours.
      recipients: item.recipients.map((person) => ({ id: person.id, name: person.name, seen: person.seen })),
      copies: 0,
      dueAt: due?.toISOString() ?? null,
      dueIn: due ? Math.round((midnight(due) - today) / 86_400_000) : null,
      receivedAt: outgoing ? null : item.issuedAt,
      checkedBy: null,
      replyNeeded: item.responseRequired,
      replyDays: reasonDays.get(item.reason) ?? null,
    };
  });

  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (way) query.set("way", way);
  if (status) query.set("status", status);
  if (reason) query.set("reason", reason);
  if (party) query.set("party", party);
  if (dateOn) query.set("on", dateOn);
  if (sp.from) query.set("from", sp.from);
  if (sp.to) query.set("to", sp.to);
  if (sort) { query.set("sort", sort); query.set("order", dir); }

  const partyOptions = found.parties.map((item) => ({ code: item.code, label: item.name })).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div>
      <TransmittalRegister
        plate={<TransmittalPlate project={{ code: project.code, name: project.name }} canCreate={!isReadOnly(user)} />}
        rows={rows}
        total={total}
        paging={{
          page: current, pages, perPage, sizes: PAGE_SIZES,
          from: total ? (current - 1) * perPage + 1 : 0,
          to: Math.min(current * perPage, total),
          query: query.toString(),
        }}
        sort={{ key: sort, dir }}
        filters={{ q, terms, way, status, reason, party, on: dateOn, from: sp.from ?? "", to: sp.to ?? "" }}
        filterOptions={{
          ways: WAYS,
          statuses: STATUSES.map((item) => ({ code: item.code, label: item.label })),
          reasons: reasonOptions,
          parties: partyOptions,
          dateFields: DATE_FIELDS.map((field) => ({ code: field.key, label: field.label })),
        }}
        reasonNotes={reasonNotes}
        exportHref={`/api/export/transmittals${query.size ? `?${query.toString()}` : ""}`}
      />
    </div>
  );
}
