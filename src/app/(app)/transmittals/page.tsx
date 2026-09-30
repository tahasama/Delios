import type { Prisma } from "@prisma/client";
import { requireScope } from "@/lib/scope";
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
  { code: "CLOSED", label: "Closed" },
] as const;
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", ISSUED: "Issued", ACCEPTED: "Accepted", REJECTED: "Rejected", CLOSED: "Closed",
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

/** Which column each date filter reads. */
const DATE_COLUMN: Record<string, string> = {
  issued: "dateOfIssue",
  due: "responseDueDate",
  received: "receivedDate",
  created: "createdAt",
};

/** The orders the log offers. */
const SORT_KEYS = ["number", "from", "to", "reason", "issued", "documents", "subject", "received", "status", "due"];

const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export default async function TransmittalsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { user, db, project } = await requireScope();
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
  const readDay = (value: string | undefined, endOfDay: boolean) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const at = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
    return Number.isNaN(at.getTime()) ? null : at;
  };
  const from = readDay(sp.from, false);
  const to = readDay(sp.to, true);

  const sort = sp.sort && SORT_KEYS.includes(sp.sort) ? sp.sort : "";
  const dir = sp.order === "asc" ? ("asc" as const) : ("desc" as const);
  const perPage = PAGE_SIZES.includes(Number(sp.per)) ? Number(sp.per) : 50;
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.TransmittalWhereInput = {
    AND: [
      ...(searches.length
        ? [{ OR: searches.map((search) => ({
            AND: search.words.map((word) => ({ OR: [
              { number: { contains: word } }, { subject: { contains: word } }, { issuingParty: { contains: word } },
              { recipients: { some: { OR: [{ name: { contains: word } }, { organization: { contains: word } }] } } },
            ] })),
          })) }]
        : []),
      way ? { direction: way } : {},
      // "To check" is a state of affairs rather than a stored word: it arrived,
      // it was issued to us, and nobody has accepted or rejected it yet.
      status === "TO_CHECK" ? { direction: "INCOMING", status: "ISSUED" } : status ? { status } : {},
      reason ? { reasonForIssue: reason } : {},
      party ? { OR: [{ issuingParty: party }, { recipients: { some: { organization: party } } }] } : {},
      // Which date, and between which two days. Every one of them is a column,
      // so the window is asked of the database rather than applied afterwards.
      dateOn && (from || to)
        ? ({ [DATE_COLUMN[dateOn]]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } as Prisma.TransmittalWhereInput)
        : {},
    ],
  };

  // Which column each order reads. The two that are not columns — who it went
  // to, and how many documents it carried — are a list and a count, so they
  // are ordered by the party that sent it and by the count itself.
  const SORTS: Record<string, Prisma.TransmittalOrderByWithRelationInput> = {
    number: { number: dir },
    from: { issuingParty: dir },
    to: { issuingParty: dir },
    reason: { reasonForIssue: dir },
    issued: { dateOfIssue: dir },
    documents: { items: { _count: dir } },
    subject: { subject: dir },
    received: { receivedDate: dir },
    status: { status: dir },
    due: { responseDueDate: dir },
  };
  const orderBy = sort ? SORTS[sort] : { createdAt: "desc" as const };

  const [total, parties, recipientParties, publishedReasons] = await Promise.all([
    db.transmittal.count({ where }),
    db.transmittal.findMany({ select: { issuingParty: true }, distinct: ["issuingParty"] }),
    db.transmittalRecipient.findMany({ where: { organization: { not: null } }, select: { organization: true }, distinct: ["organization"] }),
    getSet("REASONS_FOR_ISSUE"),
  ]);

  // The reasons come from the organization's own published list, so the words
  // in the filter and the note on hover are the words it chose. The Standard's
  // own names stand in only until that list is published.
  const reasonLabel = new Map<string, string>([
    ...REASONS_FOR_ISSUE.map((code) => [code, REASON_LABEL[code]] as [string, string]),
    ...publishedReasons.map((item) => [item.code, item.label] as [string, string]),
  ]);
  const reasonNotes: Record<string, string> = {};
  for (const item of publishedReasons) {
    const maturity = typeof item.props.maturity === "string" ? `\nRevision must be: ${item.props.maturity}` : "";
    const owed = typeof item.props.responsePeriodDays === "number" ? ` within ${item.props.responsePeriodDays} working days` : "";
    const reply = item.props.response ? `\nAn answer is owed${owed}.` : "\nNo answer is owed.";
    reasonNotes[item.code] = `${item.label}${maturity}${reply}`;
  }
  const reasonOptions = (publishedReasons.length ? publishedReasons.map((item) => ({ code: item.code, label: item.label })) : REASONS_FOR_ISSUE.map((code) => ({ code, label: REASON_LABEL[code] })));


  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(page, pages);

  // The page itself: the database orders and cuts it, and the joins touch the
  // fifty rows on screen rather than every transmittal the filters match.
  const slice = await db.transmittal.findMany({
    where,
    orderBy,
    skip: (current - 1) * perPage,
    take: perPage,
    include: { recipients: true, _count: { select: { items: true } } },
  });

  const ourOrganization = (await db.party.findFirst({ where: { isInternal: true }, select: { name: true } }))?.name ?? "Our organization";
  const today = midnight(new Date());

  const rows = slice.map((item) => {
    const outgoing = item.direction === "OUTGOING";
    return {
      id: item.id,
      number: item.number,
      subject: item.subject,
      outgoing,
      from: outgoing ? ourOrganization : item.issuingParty,
      to: outgoing
        ? [...new Set(item.recipients.map((person) => person.organization ?? person.name))].join(", ") || "nobody yet"
        : ourOrganization,
      reason: item.reasonForIssue,
      reasonLabel: reasonLabel.get(item.reasonForIssue) ?? item.reasonForIssue,
      issuedAt: (item.dateOfIssue ?? item.createdAt).toISOString(),
      documents: item._count.items,
      status: item.status,
      // What arrived and has not been answered is said as the job it is.
      statusLabel: !outgoing && item.status === "ISSUED" ? "To check" : STATUS_LABEL[item.status] ?? item.status.toLowerCase(),
      // Seen is read from the people it was addressed to. Somebody copied in
      // was told, not asked, and their opening it settles nothing.
      recipients: item.recipients
        .filter((person) => person.kind !== "CC")
        .map((person) => ({ id: person.id, name: person.name, seen: !!person.openedAt })),
      copies: item.recipients.filter((person) => person.kind === "CC").length,
      dueAt: item.responseDueDate?.toISOString() ?? null,
      dueIn: item.responseDueDate && item.status !== "DRAFT"
        ? Math.round((midnight(item.responseDueDate) - today) / 86_400_000)
        : null,
      receivedAt: item.receivedDate?.toISOString() ?? null,
      checkedBy: item.checkedByName,
      replyNeeded: item.responseRequired,
      replyDays: item.responsePeriodDays,
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

  const partyOptions = [...new Set([
    ...parties.map((item) => item.issuingParty).filter(Boolean),
    ...recipientParties.map((item) => item.organization).filter((name): name is string => !!name),
  ])].sort().map((name) => ({ code: name, label: name }));

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
