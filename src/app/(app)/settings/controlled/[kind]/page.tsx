import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, Chip, Field, btn, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import {
  uploadControlledVersionAction,
  submitControlledVersionAction,
  decideControlledVersionAction,
  discardControlledVersionAction,
} from "@/lib/actions/controlled";
import { handlerFor, summariseDiff, type DiffLine } from "@/lib/controlled/registry";
import "@/lib/controlled/handlers";
import { getSets } from "@/lib/config";
import { fmtDate } from "@/lib/utils";
import { ArrowLeft, Download, CircleCheck, CircleX, Clock, FileClock, Upload } from "lucide-react";

import { controlledSets } from "@/lib/api/admin";

export const dynamic = "force-dynamic";

const STATE_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-300",
  SUBMITTED: "bg-amber-100 text-amber-800 ring-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  REJECTED: "bg-red-100 text-red-800 ring-red-300",
  SUPERSEDED: "bg-violet-100 text-violet-800 ring-violet-300",
};

const CHANGE_STYLE: Record<DiffLine["change"], string> = {
  ADDED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  CHANGED: "bg-amber-50 text-amber-800 ring-amber-200",
  REMOVED: "bg-red-50 text-red-800 ring-red-200",
  UNCHANGED: "bg-slate-50 text-slate-500 ring-slate-200",
};

function parseDiff(json: string | null): DiffLine[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    return Array.isArray(raw) ? (raw as DiffLine[]) : [];
  } catch {
    return [];
  }
}

function DiffView({ lines }: { lines: DiffLine[] }) {
  const material = lines.filter((l) => l.change !== "UNCHANGED");
  if (!material.length) return <p className="text-xs text-slate-500">Nothing differs from the version in use now.</p>;
  return (
    <ul className="scroll-thin max-h-80 space-y-1 overflow-y-auto pr-1">
      {material.map((line, i) => (
        <li key={`${line.subject}-${i}`} className="flex items-start gap-2 text-xs">
          <Chip className={`${CHANGE_STYLE[line.change]} shrink-0`}>{line.change.toLowerCase()}</Chip>
          <span className="min-w-0">
            <span className="font-medium text-slate-700">{line.subject}</span>
            {line.detail ? <span className="block text-[11px] text-slate-500">{line.detail}</span> : null}
          </span>
        </li>
      ))}
      {lines.length > material.length ? (
        <li className="pt-1 text-[11px] text-slate-400">{lines.length - material.length} row(s) unchanged, not listed.</li>
      ) : null}
    </ul>
  );
}

export default async function ControlledKindPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const handler = handlerFor(kind);
  if (handler?.direct) redirect("/settings/config");
  if (!handler) notFound();

  const ctx = await requireScope();
  const { user } = ctx;
  const mayOwn = !!handler.ownerVerb && ctx.can(handler.ownerVerb);
  const mayChange = ctx.can("CONFIGURE") || ctx.can("CONTROL") || mayOwn;
  const mayApprove = ctx.can("CONFIGURE") || (!!handler.ownerApproves && (ctx.can("CONTROL") || mayOwn));
  if (!mayChange && !mayApprove) return <PageHeader title={handler.title} subtitle={ctx.why("CONFIGURE")} />;

  const projectId = handler.level === "PROJECT" ? ctx.projectId : null;
  const [sets, valueSets] = await Promise.all([
    controlledSets(ctx),
    handler.kind === "VALUE_SET" ? getSets() : Promise.resolve([]),
  ]);

  const keys = handler.kind === "VALUE_SET" ? valueSets.map((v) => v.key) : ["default"];

  return (
    <div className="space-y-4">
      <PageHeader
        title={handler.title}
        subtitle={handler.blurb}
        actions={
          <Link href="/settings/controlled" className="inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:underline">
            <ArrowLeft className="h-4 w-4" /> All controlled changes
          </Link>
        }
      />

      <p className="text-[11px] text-slate-400">
        
        {handler.level === "PROJECT" ? `Project ${ctx.project.code}` : "Organization-wide"} · approved by {handler.approverHint}
      </p>

      {/* ── Upload ───────────────────────────────────────────────────────── */}
      {mayChange ? (
        <Card title="Propose a change" description="Start from what is in use now — download, edit, upload back">
          <div className="mb-4 flex flex-wrap gap-2">
            {keys.map((key) => (
              <a key={key} href={`/api/controlled/current/${handler.kind}?key=${encodeURIComponent(key)}`} className={btn("primary", "sm")}>
                <Download className="h-4 w-4" /> In use now{keys.length > 1 ? `: ${key}` : ""}
              </a>
            ))}
            <a href={`/api/controlled/template/${handler.kind}`} className={btn("secondary", "sm")}>
              <Download className="h-4 w-4" /> Blank template
            </a>
          </div>

          <ActionForm action={uploadControlledVersionAction} submitLabel="Upload as draft">
            <input type="hidden" name="kind" value={handler.kind} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {handler.kind === "VALUE_SET" ? (
                <Field label="Which set" required>
                  <select name="key" required className={inputCls} defaultValue="">
                    <option value="" disabled>Choose a value set…</option>
                    {valueSets.map((v) => <option key={v.key} value={v.key}>{v.title} ({v.key})</option>)}
                  </select>
                </Field>
              ) : (
                <input type="hidden" name="key" value="default" />
              )}
              <Field label="Version label" required hint="Never reused — e.g. Rev 04, 2026-W38">
                <input name="versionLabel" required className={inputCls} placeholder="Rev 04" />
              </Field>
            </div>
            <Field label="CSV file" required>
              <input type="file" name="file" accept=".csv,text/csv" required className={inputCls} />
            </Field>
            <Field label="Note" hint="What changed and why — this is read by whoever approves it">
              <input name="notes" className={inputCls} placeholder="Added commissioning team to electrical drawings" />
            </Field>
            <p className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
              <Upload className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Columns: {handler.columns.join(" · ")}
                {handler.kind === "DISTRIBUTION_MATRIX" ? (
                  <span className="mt-1 block font-medium text-amber-800">
                    This file replaces the whole matrix. Every rule you want to keep must be in it — which is why
                    starting from “In use now” is the safe route.
                  </span>
                ) : null}
              </span>
            </p>
          </ActionForm>
        </Card>
      ) : null}

      {/* ── Pending and history ──────────────────────────────────────────── */}
      {sets.length === 0 ? (
        <Card title="Nothing uploaded yet">
          <p className="text-xs text-slate-500">
            What is in use now came from the configuration published when your organization was created. Upload a file
            above to change it.
          </p>
        </Card>
      ) : null}

      {sets.map((set) => {
        const pending = set.versions.find((v) => v.state === "DRAFT" || v.state === "SUBMITTED");
        const inForce = set.versions.find((v) => v.state === "APPROVED");
        const history = set.versions.filter((v) => v !== pending);

        return (
          <Card
            key={set.id}
            title={set.title}
            description={
              inForce
                ? `In use now: ${inForce.versionLabel} — approved by ${inForce.decidedByName} on ${fmtDate(inForce.decidedAt)}`
                : "No approved version yet"
            }
          >
            {pending ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip className={STATE_STYLE[pending.state]}>{pending.state.toLowerCase()}</Chip>
                  <span className="text-sm font-semibold text-slate-800">{pending.versionLabel}</span>
                  <span className="text-[11px] text-slate-500">
                    {pending.rowCount} row(s) · {summariseDiff(parseDiff(pending.diff))}
                    {pending.sourceName ? ` · ${pending.sourceName}` : ""}
                  </span>
                </div>
                {pending.notes ? <p className="mt-1.5 text-xs text-slate-600">{pending.notes}</p> : null}
                {pending.submittedByName ? (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock className="h-3 w-3" /> Submitted by {pending.submittedByName} on {fmtDate(pending.submittedAt)}
                  </p>
                ) : null}

                <div className="mt-4">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                    What this would change
                  </p>
                  <DiffView lines={parseDiff(pending.diff)} />
                </div>

                <div className="mt-4 flex flex-wrap items-start gap-3">
                  {pending.state === "DRAFT" && handler.ownerApproves && mayApprove ? (
                    <>
                      <ActionForm action={decideControlledVersionAction} submitLabel="Approve and apply" size="sm" hidden={{ versionId: pending.id, decision: "APPROVE" }} className="space-y-0" />
                      <ActionForm action={discardControlledVersionAction} submitLabel="Discard draft" variant="secondary" size="sm" hidden={{ versionId: pending.id }} confirmText="Discard this draft? Nothing in use changes." className="space-y-0" />
                    </>
                  ) : pending.state === "DRAFT" && mayChange ? (
                    <>
                      <ActionForm action={submitControlledVersionAction} submitLabel="Submit for approval" size="sm" hidden={{ versionId: pending.id }} className="space-y-0" />
                      <ActionForm action={discardControlledVersionAction} submitLabel="Discard draft" variant="secondary" size="sm" hidden={{ versionId: pending.id }} confirmText="Discard this draft? Nothing in use changes." className="space-y-0" />
                    </>
                  ) : null}

                  {pending.state === "SUBMITTED" ? (
                    mayApprove && (handler.ownerApproves || pending.submittedById !== user.id) ? (
                      <div className="grid grid-cols-1 w-full gap-3 sm:grid-cols-2">
                        <ActionForm action={decideControlledVersionAction} submitLabel="Approve and apply" size="sm" hidden={{ versionId: pending.id, decision: "APPROVE" }}>
                          <Field label="Reason (optional)"><input name="reason" className={inputCls} placeholder="Why this is accepted" /></Field>
                        </ActionForm>
                        <ActionForm action={decideControlledVersionAction} submitLabel="Reject" variant="danger" size="sm" hidden={{ versionId: pending.id, decision: "REJECT" }}>
                          <Field label="Reason" required><input name="reason" required className={inputCls} placeholder="Why it is not accepted" /></Field>
                        </ActionForm>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-800">
                        {pending.submittedById === user.id
                          ? "You submitted this. Someone else has to approve it."
                          : "Waiting on an approver."}
                      </p>
                    )
                  ) : null}
                </div>
              </div>
            ) : null}

            {history.length ? (
              <details className={pending ? "mt-4" : ""}>
                <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-600">
                  <FileClock className="mr-1 inline h-3 w-3" /> History ({history.length})
                </summary>
                <ul className="mt-2 space-y-1">
                  {history.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <Chip className={STATE_STYLE[v.state]}>{v.state.toLowerCase()}</Chip>
                      <span className="font-medium text-slate-700">{v.versionLabel}</span>
                      <span>{v.rowCount} row(s)</span>
                      {v.decidedByName ? (
                        <span>
                          {v.state === "REJECTED" ? <CircleX className="mr-1 inline h-3 w-3 text-red-500" /> : <CircleCheck className="mr-1 inline h-3 w-3 text-emerald-600" />}
                          {v.decidedByName} · {fmtDate(v.decidedAt)}
                        </span>
                      ) : null}
                      {v.decisionReason ? <span className="text-slate-400">— {v.decisionReason}</span> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
