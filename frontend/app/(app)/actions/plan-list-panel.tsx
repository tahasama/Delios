import { Select } from "@/components/select";
import Link from "next/link";
import { fmtDate } from "@/lib/core/utils";
import { Field, inputCls } from "@/components/ui";
import { chooseHref } from "@/lib/actions/list-sources";
import { CheckedListForm } from "./checked-list-form";
import type { PlanList } from "@/lib/actions/plan-lists";
import { ConfirmOrWhy } from "./confirm-or-why";
import { ScheduleFile } from "./schedule-file";
import { Download, TriangleAlert } from "lucide-react";

const STATE: Record<string, string> = {
  IN_PREPARATION: "in preparation", CORRECTING: "being corrected", RECEIVED: "received", IN_REVIEW: "in review",
  RELEASED: "released", RETURNED: "returned", SUPERSEDED: "superseded", VOID: "void",
};
const said = (state: string) => STATE[state] ?? state.replaceAll("_", " ").toLowerCase();

// The file button takes the app's control size and look from the stylesheet.
// The file field is the app's one (globals.css): only its width is set here.
const fileInput = "w-full";
const fileInputInline = "w-full";

/**
 * One of the schedule's lists: what it is, the document that holds it, and the
 * upload of the spreadsheet of its revision in force. Revisions are made on the
 * document's page; here the released one's list is read. With no document, the
 * way to register one, already filled in — or, knowingly and with a reason, to
 * upload the list without one.
 */
export function PlanListPanel({ list, control, switcher, projectCode }: { list: PlanList; control: boolean; switcher: boolean; projectCode: string }) {
  const type = list.types[0] ?? null;
  const inForce = list.documents.filter((one) => one.released);
  const only = inForce.length === 1 ? inForce[0] : null;
  // The schedule is read from a Primavera P6 export (.xer) too, straight from P6 (owner).
  const accepts = list.kind === "SCHEDULE" ? ".xlsx,.csv,.xer" : ".xlsx,.csv";
  const kinds = list.kind === "SCHEDULE" ? ".xlsx, .csv or a P6 .xer" : ".xlsx or .csv";
  const template = <a href={list.template} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-link hover:underline"><Download className="h-3.5 w-3.5" /> Template to fill (.csv)</a>;

  // The same way out wherever no revision is in force: no document yet, or none released.
  const loose = control ? (
    <details className="mt-4 max-w-xl">
      <summary className="cursor-pointer text-xs font-semibold text-link">Or upload it without a released document</summary>
      <CheckedListForm hidden={{ kind: list.kind, mode: "loose" }} ask="Check it" className="mt-4">
        <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>It is applied at once, with no review, and is not tied to a released document. Your name, the file and your reason are kept in the activity log.</span>
        </p>
        <Field label="File" hint={`the list as ${kinds}`} required>
          {list.kind === "SCHEDULE"
            ? <ScheduleFile accept={accepts} label={`The schedule (${kinds})`} projectCode={projectCode} className={fileInput} />
            : <input type="file" name="file" required accept={accepts} className={fileInput} />}
        </Field>
        <Field label="Why without a released document" required>
          <input name="reason" required className={inputCls} placeholder="e.g. Approver not available; or the organization approves on paper and a stamped scan follows" />
        </Field>
      </CheckedListForm>
    </details>
  ) : null;

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">
            {list.title}
            <span className="ml-2 text-xs font-normal text-slate-500">{list.says}</span>
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Releasing its document reads the Excel by itself. Upload here only if that read is missing or failed.
          </p>
        </div>
        {template}
      </div>
      {list.direct ? (
        // What is in force came from a direct upload: it can be taken back as it was read.
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 ring-1 ring-amber-200">
          <span>
            In force: uploaded directly on {fmtDate(list.direct.at)}{list.direct.by ? ` by ${list.direct.by}` : ""}, without a document.
            {list.direct.why ? <> Why: {list.direct.why}</> : null}
          </span>
          <a href={`/api/plan-direct/${list.kind}`} className="inline-flex items-center gap-1 font-semibold underline">
            <Download className="h-3.5 w-3.5" /> Download it (.csv)
          </a>
        </p>
      ) : null}

      <SourceLine list={list} switcher={switcher} />

      {list.documents.length ? (
        <>
          <ul className="mt-4 space-y-1.5 text-xs leading-5 text-slate-600">
            {list.documents.map((doc) => (
              <li key={doc.id}>
                <Link href={`/documents/${doc.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{doc.number}</Link>
                <span className="text-slate-500">
                  {doc.released ? ` · released: rev ${doc.released.value}${doc.read ? ", list read" : ", list not read yet"}` : " · nothing released yet"}
                  {doc.pending ? ` · rev ${doc.pending.value} ${said(doc.pending.state)}` : ""}
                </span>
                {doc.differs ? (
                  <span className="block whitespace-pre-line text-amber-900">
                    Read from a file that differs from rev {doc.released?.value} as released, uploaded {fmtDate(doc.differs.at)}{doc.differs.by ? ` by ${doc.differs.by}` : ""}. Why: {doc.differs.why}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {!inForce.length ? (
            <>
              <p className="mt-4 text-xs leading-5 text-slate-600">Nothing released yet. Release it from its page and its Excel is read by itself.</p>
              {loose}
            </>
          ) : control ? (
            <CheckedListForm hidden={{ kind: list.kind, mode: "document", ...(only ? { revisionId: only.released!.id } : {}) }} ask="Check it" className="mt-5">
              {only ? null : (
                <Field label="Which list" required>
                  <Select name="revisionId" required className={inputCls} defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {inForce.map((one) => <option key={one.id} value={one.released!.id}>{one.number} rev {one.released!.value} — {one.title}</option>)}
                  </Select>
                </Field>
              )}
              {list.kind === "SCHEDULE" ? (
                <ScheduleFile accept={accepts} projectCode={projectCode} className={fileInputInline}
                  label={only ? `The schedule of rev ${only.released!.value} (${kinds})` : `The schedule of the released revision (${kinds})`} />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="file" name="file" required accept={accepts}
                    aria-label={only ? `The list of rev ${only.released!.value} (${kinds})` : `The list of the released revision (${kinds})`}
                    className={`${fileInputInline} min-w-0 flex-1`}
                  />
                </div>
              )}
              {/* The uploader vouches for the file, or says why it differs. */}
              <ConfirmOrWhy revision={only ? `rev ${only.released!.value}` : "the released revision"} />
            </CheckedListForm>
          ) : (
            <p className="mt-4 text-xs text-slate-500">The control function uploads the spreadsheet of the released revision.</p>
          )}
        </>
      ) : (
        <>
          <p className="mt-4 text-xs leading-5 text-slate-600">
            No document holds it yet.{" "}
            <Link href={`/documents/new?${new URLSearchParams({ ...(type ? { docType: type.code } : {}), title: list.title })}`} className="font-semibold text-link hover:underline">Register one</Link>
            {list.types.length ? <> as a {list.types.map((one) => `${one.label} (${one.code})`).join(" or ")}</> : null}, then release it from its page.
          </p>
          {loose}
        </>
      )}
    </section>
  );
}

/**
 * Where the list is read from (owner): its register document, chosen by the control function in the register (until
 * then, the one the app finds by its type, said so), and what it was read from last, its register document or a file
 * uploaded here: the latest stands. The control function, or whoever holds Manage, reads it again from the other
 * source, always with why, after seeing what it changes.
 */
function SourceLine({ list, switcher }: { list: PlanList; switcher: boolean }) {
  const source = list.source;
  if (!source) return null;
  const doc = source.document;
  const last = source.last;
  const lastSaid = last
    ? `${last.from === "DOCUMENT" ? `its register document${last.label ? `, ${last.label}` : ""}` : `a file uploaded${last.label ? ` (${last.label})` : ""}`}${last.at ? `, ${fmtDate(new Date(last.at))}` : ""}${last.byName ? ` by ${last.byName}` : ""}`
    : null;
  const others = [
    ...(doc?.releasedValue && last?.from !== "DOCUMENT" ? [{ value: "DOCUMENT", label: `Its register document, ${doc.number} rev ${doc.releasedValue}` }] : []),
    ...(last?.from === "DOCUMENT" || (!last && doc) ? [{ value: "UPLOAD", label: "The file last uploaded here" }] : []),
  ];
  return (
    <div className="mt-4 space-y-1.5 rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 text-slate-700 ring-1 ring-line">
      <p>
        <span className="font-semibold">Its register document: </span>
        {doc ? <Link href={`/documents/${doc.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{doc.number}</Link> : <span className="text-slate-500">none chosen</span>}
        {doc?.chosenByApp ? <span className="text-amber-800"> · found by its type, not chosen yet</span> : null}
        {source.mayChoose ? <> · <Link href={chooseHref(source.kind, "SCHEDULE")} className="font-semibold text-link hover:underline">{doc && !doc.chosenByApp ? "Choose another in the register" : "Choose it in the register"}</Link></> : null}
      </p>
      {lastSaid ? <p><span className="font-semibold">Read last from: </span>{lastSaid}. The latest read stands.</p> : null}
      {switcher && others.length ? (
        <details className="pt-1">
          <summary className="cursor-pointer font-semibold text-link">Read it again from the other source</summary>
          <CheckedListForm hidden={{ kind: list.kind, mode: "switch" }} ask="Check what it changes" className="mt-3">
            <Field label="Read it from" required>
              <Select name="from" required defaultValue={others[0].value} className="plain w-full">
                {others.map((one) => <option key={one.value} value={one.value}>{one.label}</option>)}
              </Select>
            </Field>
            <Field label="Why" required hint="kept with the read">
              <input name="reason" required className={inputCls} placeholder="e.g. The direct upload was a draft; the released revision is the reference" />
            </Field>
          </CheckedListForm>
        </details>
      ) : null}
    </div>
  );
}
