import { requireScope } from "@/lib/scope";
import { fmtDate } from "@/lib/utils";
import { getSets, getActiveSet } from "@/lib/config";
import { holdersOf } from "@/lib/permissions";
import { policies, PROJECT_MODE_LABEL, controlSettings } from "@/lib/control-activities";
import { stateNames, STATE_NAMES } from "@/lib/state-names";
import { CATALOG, PHASE_LABEL, type Phase } from "@/lib/checks/catalog";
import { PREVENTED } from "@/lib/checks/prevented";

/**
 * The Document Management Plan, written from what is configured.
 *
 * A plan typed into a word processor says what somebody intended; this one says
 * what the application will actually do, because every line of it is read from
 * the configuration that does it. The two cannot drift: change a scheme, a
 * route or a list, and the plan changes with it.
 *
 * Nothing here is editable. What an organization wants to say beyond what the
 * application knows — its cover page, its client's clauses, its own
 * conventions — belongs in the plan it uploads and registers, which this page
 * points at.
 */

const PHASES: Phase[] = ["SETUP", "RUNNING", "HANDOVER"];

/** A numbered section of the plan. */
function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="text-[13px] font-semibold text-slate-900">
        <span className="mr-2 font-mono text-slate-400">{n}</span>
        {title}
      </h2>
      <div className="mt-1.5 space-y-1.5 text-[12px] leading-[1.5] text-slate-700">{children}</div>
    </section>
  );
}

/** A fact and its value, the way the plan states one. */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="grid grid-cols-[11rem_minmax(0,1fr)] gap-3 border-b border-line py-1 last:border-0">
      <span className="text-[11px] uppercase tracking-wide text-slate-400">{label}</span>
      <span>{children}</span>
    </p>
  );
}

import { adminFunctions, legacyNumbering, legacyRoutes, orEmpty, scopeConfig } from "@/lib/api/admin";
import { backendDocument } from "@/lib/api/legacy";

export async function DocumentManagementPlan({ readiness }: { readiness: { title: string; done: boolean; todo: string }[] }) {
  const ctx = await requireScope();
  const { project } = ctx;

  const [
    scope, sets, schemes, routings, templates, distribution, exceptions, chosen, settings, names,
    controlHolders, statuses, outcomes, retention, criticality, native, rendition, preservation, dmpDoc,
  ] = await Promise.all([
    scopeConfig(ctx.projectId),
    getSets(),
    legacyNumbering().then((n) => n.schemes),
    legacyNumbering().then((n) => n.routing),
    legacyRoutes().then((all) => [...all].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))),
    // Who receives what is the matrix's Receive rows.
    orEmpty(adminFunctions).then((all) => all.flatMap((f) => f.rules.filter((r) => r.verbs.includes("RECEIVE")))),
    // Published exceptions to the standard are not kept by the backend yet.
    Promise.resolve([] as { id: string; item: string; clauses: string; reason: string; authority: string; startDate: Date; reviewPoint: Date | null }[]),
    policies(ctx),
    controlSettings(ctx),
    stateNames(ctx),
    holdersOf(ctx, "CONTROL"),
    getActiveSet("STATUSES"),
    getActiveSet("REVIEW_OUTCOMES"),
    getActiveSet("RETENTION_CLASSES"),
    getActiveSet("CRITICALITY"),
    getActiveSet("NATIVE_FORMATS"),
    getActiveSet("RENDITION_FORMATS"),
    getActiveSet("PRESERVATION_FORMATS"),
    scopeConfig(ctx.projectId).then(async (s) => {
      const found = s?.dmpDocumentId ? await backendDocument(ctx, s.dmpDocumentId) : null;
      return found ? { docNumber: found.number, title: found.title, latestRevValue: found.revisions.at(-1)?.value ?? null } : null;
    }),
  ]);

  const outstanding = readiness.filter((r) => !r.done);
  // The lists a document is classified by, with the values each one holds.
  const classified = await Promise.all(
    ["DOCUMENT_TYPES", "DISCIPLINES", "DELIVERABLE_TYPES", "PHASES", "SUBPROJECTS"].map(async (key) => ({
      key,
      title: sets.find((s) => s.key === key)?.title ?? key,
      live: await getActiveSet(key),
    })),
  );
  const values = (items: { code: string; label: string }[]) => items.map((v) => v.code).join(" · ");

  return (
    <article className="print-sheet register register-sheet px-8 py-8 print:border-0 print:p-0 print:shadow-none">
      <header className="border-b border-line pb-4 text-center">
        <p className="stencil text-slate-400">Document management plan</p>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">{scope?.organizationName ?? "—"}</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          {project.name} ({project.code}) · in force since {scope ? fmtDate(scope.effectiveDate) : "—"} · printed {fmtDate(new Date())}
        </p>
        {dmpDoc ? (
          <p className="mt-1 text-[11px] text-slate-400">
            Issued as {dmpDoc.docNumber}{dmpDoc.latestRevValue ? ` rev ${dmpDoc.latestRevValue}` : ""} — {dmpDoc.title}
          </p>
        ) : null}
      </header>

      <Section n={1} title="What this plan covers">
        <Line label="Scope">{scope?.scopeStatement ?? "Not stated."}</Line>
        <Line label="Measured against">
          {scope ? `${scope.integrityThreshold}% of documents carrying nothing critical or major, checked at least every ${scope.measurementIntervalDays} days` : "—"}
        </Line>
        <Line label="Control function">
          {controlHolders.length
            ? `${scope?.controlFunctionName ?? "Document Control"} — ${controlHolders.map((h) => h.name).join(", ")}`
            : "Nobody holds it: the people doing the work run the register themselves."}
        </Line>
        <Line label="Who carries each act">{PROJECT_MODE_LABEL[settings.projectMode]}</Line>
      </Section>

      <Section n={2} title="How a document is identified">
        {schemes.length ? (
          <ul className="space-y-1">
            {schemes.map((s) => {
              const used = routings.filter((r) => r.schemeName === s.name && r.status === "ACTIVE").map((r) => r.deliverableType);
              return (
                <li key={s.id}>
                  <span className="font-medium">{s.name}</span>
                  <span className="text-slate-500"> — {s.fields.map((f) => f.label).join(` ${s.delimiter} `)}</span>
                  <span className="block text-[11px] text-slate-400">
                    {used.length ? `Used by ${used.join(", ")}` : "Not in use"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>No numbering scheme is published.</p>
        )}
        <p className="text-[11px] text-slate-400">
          Numbers are allocated by the application as a document is registered. None is typed, none is reused, and a number
          already issued keeps the scheme it was issued under.
        </p>
      </Section>

      <Section n={3} title="How a document is classified">
        {classified.map(({ key, title, live }) => (
          <Line key={key} label={title}>
            {live.length} published
            <span className="block text-[11px] text-slate-400">
              {values(live.slice(0, 14))}
              {live.length > 14 ? " …" : ""}
            </span>
          </Line>
        ))}
        <Line label="Criticality">{values(criticality)}</Line>
      </Section>

      <Section n={4} title="How a revision is reviewed and approved">
        <Line label="Verdicts">{values(outcomes)}</Line>
        <Line label="Who may be put on a review">{chosen.find((p) => p.policy.key === "POLICY_MATRIX")?.value === "STRICT" ? "Only people the distribution matrix names for that act." : "The matrix proposes; anyone on the project may be named, and the record says who chose them."}</Line>
        <Line label="Routes">
          {templates.length ? (
            <ul className="space-y-0.5">
              {templates.map((t) => {
                let days = 0;
                let steps = 0;
                try {
                  const parsed = JSON.parse(t.steps) as { days?: number }[];
                  steps = parsed.length;
                  days = parsed.reduce((n, s) => n + Number(s.days ?? 0), 0);
                } catch {
                  steps = 0;
                }
                return (
                  <li key={t.id}>
                    {t.name}
                    <span className="text-slate-400">
                      {" — "}{steps} step{steps === 1 ? "" : "s"}{days ? `, ${days} working days in all` : ", no time limits"}
                      {t.isDefault ? " · the default" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : "None published."}
        </Line>
        <p className="text-[11px] text-slate-400">
          Approval authority is read from the distribution matrix for the discipline and document type. A release with no
          approval recorded is refused, except for types published as not reviewed.
        </p>
      </Section>

      <Section n={5} title="How a revision is released and issued">
        <Line label="States">{STATE_NAMES.map((one) => names[one.code]).join(" · ")}</Line>
        <Line label="Statuses">{values(statuses)}</Line>
        <Line label="Releasing">{chosen.find((p) => p.policy.key === "POLICY_RELEASE")?.value === "SEPARATE" ? "Releasing puts a revision in force; issuing it is a separate act." : "Releasing sends it: whoever decides says who receives it, and the issue is recorded in the same act."}</Line>
        <Line label="Stamping">{chosen.find((p) => p.policy.key === "POLICY_PDF_STAMP")?.value === "OFF" ? "The verdict is kept in the record; the file is not stamped." : "The verdict, who gave it and when are stamped on the PDF people open."}</Line>
        <Line label="Distribution">{distribution.length ? `${distribution.length} rule${distribution.length === 1 ? "" : "s"} published, by deliverable type.` : "No distribution rules published."}</Line>
      </Section>

      <Section n={6} title="Files kept, and in what form">
        <Line label="Native formats">{native.length ? values(native) : "Not published."}</Line>
        <Line label="Rendition">{rendition.length ? values(rendition) : "Not published."}</Line>
        <Line label="For long keeping">{preservation.length ? values(preservation) : "Not published."}</Line>
        <p className="text-[11px] text-slate-400">
          A released revision carries a fixed, viewable copy; release is refused without one. Every file is fingerprinted as
          it is stored, so a file altered afterwards is found by the checks.
        </p>
      </Section>

      <Section n={7} title="How long information is kept">
        <Line label="Retention classes">{retention.length ? values(retention) : "Not published."}</Line>
        <p className="text-[11px] text-slate-400">
          A class is set on every document, from its criticality where nothing else says. Disposal records who authorised it
          and on what basis, is refused while a legal hold stands, and the register entry is kept and marked disposed.
        </p>
      </Section>

      <Section n={8} title="How this is checked">
        <Line label="Checks">
          {CATALOG.length} questions the application answers from its own records
          <span className="block text-[11px] text-slate-400">
            {PHASES.map((p) => `${CATALOG.filter((c) => c.phase === p).length} ${PHASE_LABEL[p].toLowerCase()}`).join(" · ")}
          </span>
        </Line>
        <Line label="Refused outright">{PREVENTED.length} conditions the application does not allow to arise</Line>
        <Line label="Measured">{scope ? `At least every ${scope.measurementIntervalDays} days, against ${scope.integrityThreshold}%` : "—"}</Line>
      </Section>

      {exceptions.length ? (
        <Section n={9} title="Agreed departures">
          <ul className="space-y-1">
            {exceptions.map((e) => (
              <li key={e.id}>
                <span className="font-medium">{e.item}</span>
                <span className="block text-[11px] text-slate-400">
                  {e.reason} — granted by {e.authority}, from {fmtDate(e.startDate)}
                  {e.reviewPoint ? `, looked at again ${fmtDate(e.reviewPoint)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section n={exceptions.length ? 10 : 9} title="What is still to settle">
        {outstanding.length ? (
          <ul className="space-y-1">
            {outstanding.map((r) => (
              <li key={r.title}>
                <span className="font-medium">{r.title}</span>
                <span className="block text-[11px] text-slate-400">{r.todo}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing. Every list, matrix and rule this project runs on is published.</p>
        )}
      </Section>

      <p className="mt-7 border-t border-line pt-4 text-[11px] leading-5 text-slate-500">
        Every statement above is read from this project&rsquo;s own configuration at the moment of printing, not written by
        hand: change a scheme, a route or a list and this plan changes with it.
        {dmpDoc
          ? " The organization's own plan, with its cover and anything this application does not hold, is registered as the document named above."
          : " An organization's own plan — its cover page, its client's clauses, its own conventions — is registered as a document and named on the settings screen."}
      </p>
    </article>
  );
}
