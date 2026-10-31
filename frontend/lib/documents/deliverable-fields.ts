import type { Tenant } from "@/lib/core/tenant";
import { getActiveSet } from "@/lib/settings/config";
import { getMe } from "@/lib/account/api";
import { fieldLabels, fieldRules, ownFields } from "@/lib/settings/field-policy";
import { forType } from "@/lib/settings/serving";
import { servingOf } from "@/lib/settings/serving-api";
import { api } from "@/lib/client";

/** A field of the document form, for one deliverable type: its key (as the backend names it), its words, what it offers. */
export type DocumentField = {
  key: string;
  label: string;
  kind: "text" | "choice" | "date";
  required: boolean;
  /** For a choice: only the values offered for this deliverable type. */
  values?: { code: string; label: string }[];
  note?: string;
  /** Part of the number: shown on an update, never changed. */
  inNumber?: boolean;
};

/** What a document of one deliverable type is asked, in the document form's order. */
export type DeliverableFields = { code: string; label: string; fields: DocumentField[] };

/** The lists the document form may draw from, by its field. */
const LISTED: { key: string; set: string }[] = [
  { key: "subProject", set: "SUBPROJECTS" },
  { key: "phase", set: "PHASES" },
  { key: "contractRef", set: "PURCHASE_ORDERS" },
  { key: "criticality", set: "CRITICALITY" },
  { key: "confidentiality", set: "CONFIDENTIALITY" },
  { key: "retentionClass", set: "RETENTION_CLASSES" },
];
/** The form's field names as the backend's document changes read them. */
const BACKEND_KEY: Record<string, string> = { subProject: "subproject" };
const IN_NUMBER = new Set(["docType", "discipline", "subproject", "originator"]);

/**
 * The document form, per deliverable type, as the app asks it now (owner: the list is the create / update form):
 * Forms & fields decides what is left out, insisted on and how each field is called, the fields of one's own follow,
 * and each list offers only the values of the set serving that type (forms follow the sets). Read once for the
 * deliverable list's template and for correcting a line of it, so both ask exactly what registering by hand asks.
 */
export async function deliverableFields(t: Tenant): Promise<{ project: { code: string; name: string } | null; types: DeliverableFields[] }> {
  const sets = ["DOCUMENT_TYPES", "DISCIPLINES", ...LISTED.map((l) => l.set)];
  const [deliverableTypes, fieldMatrix, project, rules, labels, own, serving, parties, ...lists] = await Promise.all([
    getActiveSet("DELIVERABLE_TYPES"),
    getActiveSet("DELIVERABLE_TYPE_FIELDS"),
    getMe().then((me) => me?.projects.find((one) => one.id === t.projectId) ?? null),
    fieldRules(t, "DOCUMENT"),
    fieldLabels(t, "DOCUMENT"),
    ownFields(t, "DOCUMENT"),
    servingOf(sets),
    // Whose a document is: the outside organizations, as registering checks it.
    api<{ code: string; name: string }[]>("/api/parties", { keep: { areas: [] } }).catch(() => []),
    ...sets.map((set) => getActiveSet(set)),
  ]);
  const rowsOf = new Map(sets.map((set, index) => [set, lists[index]] as const));
  const matrix = new Map(fieldMatrix.map((row) => [row.code, row.props] as const));
  const words = (rows: { code: string; label: string }[]) => rows.map((one) => ({ code: one.code, label: one.label }));

  const types = deliverableTypes.map((type): DeliverableFields => {
    const props = matrix.get(type.code) ?? {};
    const requires = Array.isArray(type.props.required) ? (type.props.required as unknown[]).map(String) : [];
    const offered = (set: string) => forType(serving, set, type.code, (rowsOf.get(set) ?? []) as { code: string; label: string; setId?: string | null; props?: Record<string, unknown> }[]);
    // A document type names the deliverable types it belongs to; one naming none falls back to who produces it.
    const supplied = requires.includes("originator");
    const docTypes = offered("DOCUMENT_TYPES").filter((one) => {
      const of = Array.isArray(one.props?.deliverables) ? (one.props!.deliverables as unknown[]).map(String) : [];
      if (of.length) return of.includes(type.code);
      const applies = typeof one.props?.appliesTo === "string" ? one.props.appliesTo : null;
      return !applies || applies === "Unclassified" || applies === (supplied ? "Supplier" : "Non-supplier");
    });
    const asked = (key: string) => (rules[key] ?? "OPTIONAL") !== "OFF";
    const asField = (field: Omit<DocumentField, "inNumber">): DocumentField => ({ ...field, inNumber: IN_NUMBER.has(field.key) });
    const fields: DocumentField[] = ([
      { key: "title", label: labels.title ?? "Title", kind: "text", required: true },
      { key: "docType", label: labels.docType ?? "Document type", kind: "choice", values: words(docTypes), required: true },
      { key: "discipline", label: labels.discipline ?? "Discipline", kind: "choice", values: words(offered("DISCIPLINES")), required: true },
      ...(supplied || (props.originator ?? "na") !== "na"
        ? [{ key: "originator", label: labels.originator ?? "Supplier", kind: "choice" as const, values: parties.map((p) => ({ code: p.code, label: p.name })), required: supplied || props.originator === "required" }] : []),
      ...LISTED.filter((l) => asked(l.key) && (l.key !== "contractRef" || (props.po ?? "") !== "na")).map((l) => ({
        key: BACKEND_KEY[l.key] ?? l.key, label: labels[l.key] ?? l.key, kind: "choice" as const, values: words(offered(l.set)),
        required: rules[l.key] === "REQUIRED" || (l.key === "contractRef" && props.po === "required"),
      })),
      ...(asked("plannedDate") ? [{ key: "plannedDate", label: labels.plannedDate ?? "Planned date", kind: "date" as const, required: rules.plannedDate === "REQUIRED",
        note: "For a document no action of the schedule needs: the schedule plans the others." }] : []),
      ...own.map((field) => ({
        key: `extra:${field.key}`, label: field.label, kind: field.setKey ? "choice" as const : "text" as const, required: field.rule === "REQUIRED",
        note: field.help ?? undefined,
        values: field.setKey ? forType(serving, field.setKey, type.code, field.options ?? []).map((v) => ({ code: v.code, label: v.label })) : undefined,
      })),
    ] as Omit<DocumentField, "inNumber">[]).map(asField);
    return { code: type.code, label: type.label, fields };
  });
  return { project: project ? { code: project.code, name: project.name } : null, types };
}
