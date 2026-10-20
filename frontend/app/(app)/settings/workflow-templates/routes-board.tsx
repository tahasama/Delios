import Link from "next/link";
import { ArrowRight, Pencil, Plus, Ban } from "lucide-react";
import { ToneChip } from "@/components/ui";
import { ConfirmButton } from "@/components/form";
import { deleteTemplateAction } from "@/lib/reviews/forms";
import { getActiveSet } from "@/lib/settings/config";
import { WorkflowTemplateBuilder, type WorkflowBuilderStep } from "./workflow-template-builder";
import { VERDICT_EFFECT_SHORT } from "@/lib/reviews/verdict-effect";
import { api, projectPath } from "@/lib/client";
import { requireScope } from "@/lib/core/scope";
import { scopeWords, patternsOf } from "@/lib/reviews/route-scope";
import { adminFunctions, adminParties, adminUsers, routesForEditor } from "@/lib/settings/api-admin";

type Step = WorkflowBuilderStep;
type ListSets = { lists: { key: string; sets: { id: string | null; name: string; isDefault: boolean; deliverableTypes: string[] }[] }[] };

/**
 * The review routes, read or changed, in the reference style: the plate, then one sheet per route (its sets, its steps
 * with who answers, their days and what the decision may release at, the documents it takes), a route opened for
 * changing in its own sheet (`?edit=`), a new one under the plate (`?new=1`). The organization's Settings and a
 * project's draw them the same way; `editable` says whether this person may change them here, `level` where the change goes.
 */
export async function RoutesBoard({ level, editable, lead, editing, adding }: {
  level: "organization" | "project";
  editable: boolean;
  lead?: React.ReactNode;
  /** The route opened for changing. */
  editing?: string;
  /** The new route's form is open. */
  adding?: boolean;
}) {
  const here = level === "organization" ? "/organization/settings/routes" : "/settings/workflow-templates";
  // On a project, what each person holds there; on the organization's card, on any project.
  const projectId = level === "project" ? (await requireScope()).projectId : null;
  const [templates, users, classValues, functions, outsideParties, reasons, statuses, adviceValues, lists] = await Promise.all([
    routesForEditor(level),
    // Who may be put on a step: their organization (none: ours), the functions they hold and their disciplines.
    adminUsers().then((all) => all.filter((u) => u.active).map((u) => {
      const held = u.memberships.filter((m) => m.active && (!projectId || m.projectId === projectId));
      return {
        id: u.id, name: u.name, partyId: u.partyId && !u.internal ? u.partyId : null,
        functions: [...new Set(held.map((m) => m.functionCode))], departments: [...new Set(held.map((m) => m.department).filter((d): d is string => !!d))],
      };
    }).filter((u) => !projectId || u.functions.length > 0)),
    Promise.all(["DOCUMENT_TYPES", "DISCIPLINES", "CRITICALITY", "DELIVERABLE_TYPES"].map(async (setKey) =>
      (await getActiveSet(setKey)).map((v) => ({ ...v, setKey })))).then((all) => all.flat()),
    // A step names a function by its code.
    adminFunctions().then((all) => all.filter((f) => f.active).map((f) => ({ id: f.code, name: f.name }))),
    // The organizations that can answer a step: a client, a control office, a supplier.
    adminParties().then((all) => all.filter((p) => !p.isInternal && p.active)),
    getActiveSet("REASONS_FOR_ISSUE"),
    getActiveSet("STATUSES"),
    getActiveSet("REVIEW_ADVICE"),
    (level === "organization" ? api<ListSets>("/api/admin/lists") : requireScope().then((scope) => api<ListSets>(projectPath(scope, "/lists")))).catch(() => ({ lists: [] }) as ListSets),
  ]);
  const organizations = outsideParties.map((p) => ({ code: p.code, name: p.name }));
  const parties = outsideParties.map((p) => ({ id: p.id, name: p.name, participation: p.participation }));
  // The sets of the review outcomes (each verdict with its meaning) and of the review advice; none named, a route
  // answers from the set serving each document's deliverable type.
  const outcomeSets = await api<{ key: string; title: string; verdicts: { code: string; label: string; status: string; meaning: string | null }[] }[]>("/api/admin/verdict-lists").catch(() => []);
  const adviceSets = (lists.lists.find((l) => l.key === "REVIEW_ADVICE")?.sets ?? []).map((s) => ({ key: s.name, title: s.name }));
  const classOptions = {
    documentTypes: classValues.filter((value) => value.setKey === "DOCUMENT_TYPES").map(({ code, label }) => ({ code, label })),
    disciplines: classValues.filter((value) => value.setKey === "DISCIPLINES").map(({ code, label }) => ({ code, label })),
    criticalities: classValues.filter((value) => value.setKey === "CRITICALITY").map(({ code, label }) => ({ code, label })),
    // Who produces it: a supplier drawing and one of ours are the same type and take different routes.
    deliverableTypes: classValues.filter((value) => value.setKey === "DELIVERABLE_TYPES").map(({ code, label }) => ({ code, label })),
    // A document's originator is the organization it came from, by its code: the organizations taking part.
    originators: organizations.map(({ code, name }) => ({ code, label: name })),
  };
  const statusChoices = statuses.map((v) => ({ code: v.code, label: v.label }));
  const reasonChoices = reasons.map((v) => ({ code: v.code, label: v.label }));
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "someone no longer here";
  const typeName = (code: string) => classOptions.deliverableTypes.find((d) => d.code === code)?.label ?? code;
  const builder = (route?: (typeof templates)[number], steps?: Step[]) => (
    <WorkflowTemplateBuilder level={level} cancelHref={here} outsideParties={parties} functions={functions}
      users={users}
      outcomeSets={outcomeSets.map((s) => ({ key: s.key, title: s.title }))} adviceSets={adviceSets} classOptions={classOptions} statuses={statusChoices}
      {...(route ? { id: route.id, name: route.name, description: route.description ?? "", classes: route.classes, outcomeSetKey: route.outcomeSetKey,
        adviceSetKey: route.adviceSetKey, isDefault: route.isDefault, initialSteps: steps } : {})} />
  );

  return (
    <>
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="plate-title text-slate-950">Review routes</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              The ways a document goes for review: a step advises, from a set of advice, or decides, from a set of verdicts. The last
              always decides; where several decide, each answers in turn and the most severe verdict stands.
            </p>
            {lead ? <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">{lead}</p> : null}
          </div>
          {editable && !adding ? (
            <Link href={`${here}?new=1`} scroll={false} className="ask inline-flex shrink-0 items-center gap-1.5"><Plus className="h-3.5 w-3.5" aria-hidden /> New review route</Link>
          ) : null}
        </div>
      </section>

      {editable && adding ? (
        <section className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-baseline gap-2 border-b border-line px-5 py-3 sm:px-6">
            <span className="text-[14px] font-semibold text-slate-900">New review route</span>
            <span className="text-[11px] text-slate-500">offered on Send for review once added</span>
          </div>
          {builder()}
        </section>
      ) : null}

      {templates.length === 0 && !adding ? (
        <section className="register register-sheet register-sheet-open">
          <p className="px-5 py-4 text-xs leading-5 text-slate-600 sm:px-6">No review route yet: nobody can send a document for review until one is added.</p>
        </section>
      ) : null}

      {templates.length ? (
        <p className="flex items-center gap-2 px-1 pt-2">
          <span className="stencil text-slate-500">Routes in use</span>
          <span className="text-[11px] text-slate-500">{templates.length} · offered on Send for review where they take the documents</span>
        </p>
      ) : null}

      {templates.map((t) => {
        const steps = JSON.parse(t.steps) as Step[];
        const open = editable && editing === t.id;
        const verdicts = t.outcomeSetKey ? outcomeSets.find((s) => s.key === t.outcomeSetKey) : null;
        const adviceIn = (set: string | null) => {
          const list = lists.lists.find((l) => l.key === "REVIEW_ADVICE")?.sets ?? [];
          const one = list.find((s) => s.name === set);
          const defaultId = list.find((s) => s.isDefault)?.id ?? null;
          return set && one ? adviceValues.filter((v) => (v.setId ?? defaultId) === one.id) : adviceValues;
        };
        const unserved = (codes: string[]) => codes.map(typeName).join(", ");
        return (
          <section key={t.id} id={`route-${t.id}`} className="register register-sheet register-sheet-open scroll-mt-20">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3 sm:px-6">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-slate-900">{t.name}</span>
                  {t.isDefault ? <ToneChip tone="done">offered first</ToneChip> : null}
                  {open ? <span className="stencil text-brand-ink">being changed</span> : null}
                </p>
                {t.description ? <p className="mt-0.5 text-xs leading-5 text-slate-600">{t.description}</p> : null}
              </div>
              {editable && !open ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Link href={`${here}?edit=${t.id}#route-${t.id}`} scroll={false} title="Change it" aria-label={`Change ${t.name}`}
                    className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-tint-soft hover:text-slate-900"><Pencil className="h-4 w-4" /></Link>
                  <form action={deleteTemplateAction}>
                    <input type="hidden" name="level" value={level} />
                    <input type="hidden" name="id" value={t.id} />
                    <ConfirmButton className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-700" title="Stop using it"
                      confirm={`Stop using the route "${t.name}"? It is no longer offered for new reviews; reviews already on it carry on.`}>
                      <Ban className="h-4 w-4" aria-label={`Stop using ${t.name}`} />
                    </ConfirmButton>
                  </form>
                </div>
              ) : null}
            </div>

            {open ? builder(t, steps) : (
              <div className="space-y-3 px-5 py-4 sm:px-6">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs leading-5 md:grid-cols-[auto_minmax(0,1fr)]">
                  <dt className="font-semibold text-slate-700">Advice</dt>
                  <dd className="text-slate-600">
                    {t.adviceSetKey || "The set serving each document’s deliverable type"}
                    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                      {adviceIn(t.adviceSetKey || null).map((v) => <span key={v.code} title={v.code} className="rounded bg-tint-soft px-1.5 py-0.5 text-[11px] text-slate-700 ring-1 ring-line">{v.label}</span>)}
                    </span>
                    {t.adviceMismatch.length ? <span className="ml-2 text-amber-800">does not serve {unserved(t.adviceMismatch)}, which this route takes</span> : null}
                  </dd>
                  <dt className="font-semibold text-slate-700">Verdicts</dt>
                  <dd className="text-slate-600">
                    {verdicts ? verdicts.title : "The set serving each document’s deliverable type"}
                    {verdicts ? (
                      <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                        {verdicts.verdicts.filter((v) => v.status === "ACTIVE").map((v) => (
                          <span key={v.code} title={v.label} className="rounded bg-tint-soft px-1.5 py-0.5 text-[11px] ring-1 ring-line">
                            <span className="font-mono font-semibold text-slate-700">{v.code}</span> <span className="text-slate-500">{v.meaning ? VERDICT_EFFECT_SHORT[v.meaning] ?? "" : "meaning not chosen yet"}</span>
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {t.verdictsMismatch.length ? <span className="ml-2 text-amber-800">does not serve {unserved(t.verdictsMismatch)}, which this route takes</span> : null}
                  </dd>
                  <dt className="font-semibold text-slate-700">Takes</dt>
                  <dd className="text-slate-600">{scopeWords(patternsOf(t.classes), classOptions)}</dd>
                </dl>

                <div className="scroll-thin flex items-stretch gap-1 overflow-x-auto pb-1">
                  {steps.map((s, i) => {
                    const decides = !!s.decides || i === steps.length - 1;
                    const last = i === steps.length - 1;
                    const party = s.partyId ? parties.find((p) => p.id === s.partyId) : null;
                    // Who answers it: its organization (with its people or function), or ours; the matrix where it says so.
                    const parts = [...s.participantIds.map(nameOf), ...(s.functionIds ?? []).map((fid) => `any ${functions.find((f) => f.id === fid)?.name ?? fid}`),
                      ...(s.fromMatrix ? ["recommended for each document"] : [])];
                    const who = party ? [parts.length ? `${party.name}: ${parts.join(", ")}` : party.name] : parts;
                    return (
                      <div key={i} className="flex items-stretch gap-1">
                        <div className="w-56 shrink-0 rounded-md bg-surface px-3 py-2.5 ring-1 ring-line">
                          <p className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-slate-500">Step {i + 1}</span>
                            <ToneChip tone={decides ? "done" : "moving"}>{decides ? "decides" : "advises"}</ToneChip>
                          </p>
                          <p className="mt-1 text-[13px] font-semibold text-slate-900">{s.title || (decides ? "Decision" : `Review ${i + 1}`)}</p>
                          <p className={`mt-1 text-[11px] leading-4 ${who.length ? "text-slate-700" : "text-amber-700"}`}>{who.length ? who.join(", ") : "Nobody named: the sender names them"}</p>
                          {party && s.reason ? <p className="mt-0.5 text-[11px] text-slate-500">on a transmittal, {reasonChoices.find((r) => r.code === s.reason)?.label ?? s.reason}</p> : null}
                          {who.length > 1 ? <p className="mt-0.5 text-[11px] text-slate-500">{s.mode === "ANY_OF" ? "whoever gets to it first" : "all of them, any order"}</p> : null}
                          <p className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-slate-500">
                            {s.days ? `${s.days} working day${s.days === 1 ? "" : "s"}` : "no days: no due date"}
                            {last && s.grantsStatuses?.length ? <> · {s.grantsStatuses.length === 1 ? "releases at" : "releases at one of"} {s.grantsStatuses.join(", ")}</> : null}
                          </p>
                        </div>
                        {i < steps.length - 1 ? <ArrowRight className="h-4 w-4 shrink-0 self-center text-slate-400" aria-hidden /> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
