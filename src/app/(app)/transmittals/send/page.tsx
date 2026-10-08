import Link from "next/link";
import { api } from "@/lib/api/client";
import type { Addressees, ListValue, RegisterPage } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { LISTS } from "@/lib/lists";
import { Banner, PageHeader } from "@/components/ui";
import { SendForm } from "./send-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Send to us" };

/** A revision still being worked on cannot take another beside it; one returned for a correction is sent again. */
const BUSY = new Set(["IN_PREPARATION", "IN_REVIEW", "RECEIVED"]);

/**
 * Sending documents to us, as another organization: its placeholders filled
 * (each at the status it is sent for), corrections Document Control asked for,
 * and anything unplanned (an RFI, an NCR, minutes…). It all goes on one
 * transmittal, received the moment it is sent, with a receipt. Document
 * Control uses the same page to record what an organization working in its
 * own system sent, with its covering letter.
 */
export default async function SendPage({ searchParams }: { searchParams: Promise<{ docs?: string; from?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const onBehalf = session.user.isInternal;
  if (onBehalf && !session.can("CONTROL")) {
    return <div><PageHeader title="Send to us" /><Banner tone="warn" title="This is for other organizations">Another organization sends us its documents here; Document Control records what one sent outside the system.</Banner></div>;
  }
  const [addressees, lists] = await Promise.all([
    // Only Document Control chooses which organization sent it.
    onBehalf ? api<Addressees>(projectPath(session, "/addressees")) : ({ people: [], parties: [] } as Addressees),
    api<Record<string, ListValue[]>>("/api/values", { query: { sets: [LISTS.reasonsForIssue, LISTS.statuses, LISTS.documentTypes].join(",") } }),
  ]);
  const outside = addressees.parties;
  const party = onBehalf ? outside.find((p) => p.code === sp.from) : null;
  const code = onBehalf ? party?.code : session.user.party?.code;
  const register = code ? await api<RegisterPage>(projectPath(session, "/register"), { query: { supplier: code, per: 250, sort: "docNumber", dir: "asc" } }) : null;
  const rows = (register?.rows ?? []).filter((r) => (r.state === "PLANNED" || r.state === "ACTIVE") && !BUSY.has(r.revisionState ?? ""));
  const active = (set: string) => (lists[set] ?? []).filter((v) => v.status === "ACTIVE").map((v) => ({ code: v.code, label: v.label }));
  const chosen = new Set((sp.docs ?? "").split(",").filter(Boolean));

  return (
    <div className="space-y-4">
      <PageHeader title={onBehalf ? "Record what an organization sent" : "Send to us"}
        subtitle={onBehalf ? "For an organization that works in its own system: what they sent, with their reference and covering letter."
          : "Fill your placeholders and send anything else we need. It is received the moment you send it, and you get a receipt."} />
      {onBehalf ? (
        <form className="register register-sheet register-sheet-open flex flex-wrap items-end gap-3 px-5 py-4 sm:px-6">
          <label className="text-xs text-slate-600">Sent by
            <select name="from" defaultValue={party?.code ?? ""} className="ml-2 rounded border border-line px-2 py-1 text-sm">
              <option value="" disabled>Choose…</option>
              {outside.map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}
            </select>
          </label>
          <button className="ask">Show their documents</button>
        </form>
      ) : null}
      {code ? (
        <SendForm key={code} rows={rows.map((r) => ({
          id: r.id, number: r.number, title: r.title, plannedDate: r.plannedDate,
          note: r.isPlaceholder ? "placeholder" : r.revisionState === "CORRECTING" ? "returned: send it corrected" : `next revision after ${r.revision}`,
        }))} chosen={[...chosen]} onBehalf={onBehalf} fromPartyId={party?.id}
          reasons={active(LISTS.reasonsForIssue)} statuses={active(LISTS.statuses)} docTypes={active(LISTS.documentTypes)} />
      ) : onBehalf ? null : <Banner tone="warn" title="Your account is not tied to an organization">Ask Document Control.</Banner>}
      <p className="text-xs text-slate-500"><Link href="/transmittals" className="font-semibold text-link hover:underline">Transmittals</Link> lists what you sent and what we sent you.</p>
    </div>
  );
}
