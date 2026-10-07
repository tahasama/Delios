import Link from "next/link";
import { api } from "@/lib/api/client";
import type { Work } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { isMigrated } from "@/lib/migrated";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

/** What each kind of work asks of the person, in their words. */
const ASK: Record<string, string> = {
  ANSWER_STEP: "Your answer on this review step",
  DISPATCH_STEP: "Send it to the other organization",
  RECORD_ANSWER: "Record the other organization's answer",
  READY_TO_RELEASE: "Decided: ready to release",
  SEND_BACK: "Decided: changes asked, send it back",
  ACCEPT_SUBMISSION: "Received: check it and accept it",
  CORRECT_AND_RESUBMIT: "Returned to you: correct it and send it again",
  CARRY_OUT_REQUEST: "Someone asked for this to be issued",
  DISPATCH_TRANSMITTAL: "Send this transmittal and record how it went",
  ACKNOWLEDGE_TRANSMITTAL: "Open it and acknowledge it",
};

type Row = { key: string; what: string; label: string; detail: string; due: string | null; since: string; href: string | null };

function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

/** A link only to a screen already working; otherwise plain text. */
function linkTo(href: string): string | null {
  return isMigrated(href) ? href : null;
}

/**
 * Home: what is waiting on the signed-in person in this project. Review steps
 * they sit on, Document Control's gate, submissions to accept or correct, and
 * transmittals to send or acknowledge, oldest first.
 */
export default async function HomePage() {
  const session = await requireSession();
  const work = await api<Work>(projectPath(session, "/work"));

  const rows: Row[] = [
    ...work.steps.map((w) => ({ key: `s${w.reviewId}`, what: ASK[w.kind], label: `${w.documentNumber} rev ${w.revisionValue}`, detail: `${w.title} · ${w.number}${w.stepTitle ? ` · ${w.stepTitle}` : ""}`, due: w.dueDate, since: w.since, href: linkTo(`/reviews/${w.reviewId}`) })),
    ...work.gate.map((w) => ({ key: `g${w.reviewId}`, what: ASK[w.kind], label: `${w.documentNumber} rev ${w.revisionValue}`, detail: `${w.title} · ${w.number}`, due: null, since: w.since, href: linkTo(`/reviews/${w.reviewId}`) })),
    ...work.revisions.map((w) => ({ key: `r${w.revisionId}`, what: ASK[w.kind], label: `${w.documentNumber} rev ${w.revision}`, detail: `${w.title}${w.note ? ` · ${w.note}` : ""}`, due: null, since: w.since, href: linkTo(`/documents/${w.documentId}`) })),
    ...work.issues.map((w) => ({ key: `i${w.requestId ?? w.transmittalId}${w.recipientId ?? ""}`, what: ASK[w.kind], label: w.label, detail: [w.reason, w.who].filter(Boolean).join(" · "), due: w.dueDate, since: w.since, href: w.transmittalId ? linkTo(`/transmittals/${w.transmittalId}`) : null })),
  ].sort((a, b) => a.since.localeCompare(b.since));

  return (
    <>
      <PageHeader eyebrow={session.project.code} title={`Good to see you, ${session.user.name.split(" ")[0]}`} subtitle={`What is waiting on you in ${session.project.name}.`} />
      <Card title="Waiting on you" description={rows.length ? `${rows.length} item${rows.length === 1 ? "" : "s"}, oldest first` : undefined}>
        {rows.length === 0 ? (
          <EmptyState title="Nothing is waiting on you" body="When a review, a submission or a transmittal needs you, it appears here." />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const body = (
                <>
                  <p className="text-xs font-semibold text-slate-500">{r.what}</p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">{r.label}</p>
                  <p className="text-xs text-slate-500">{r.detail}</p>
                </>
              );
              return (
                <li key={r.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">{r.href ? <Link href={r.href} className="hover:underline">{body}</Link> : body}</div>
                  <div className="text-right text-[11px] text-slate-400">
                    <p>since {day(r.since)}</p>
                    {r.due ? <p className={new Date(r.due) < new Date() ? "font-semibold text-red-600" : ""}>due {day(r.due)}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
