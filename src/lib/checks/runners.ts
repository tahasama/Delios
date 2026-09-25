import { existsSync } from "fs";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import type { Tenant, ScopedDb } from "@/lib/tenant";
import { UPLOAD_ROOT } from "@/lib/files";
import { REV_STATES, DOC_STATES, EXCLUDED_REV_LETTERS, isEmptyTitle } from "@/lib/standard";

// Annex H runners — each returns the failing items for its check, or the
// special strings NOT_CHECKED / NOT_EXECUTABLE. Evidence only; no judgement (§17.1).

export type Failure = {
  entityKey: string;
  entityType?: string;
  entityId?: string;
  documentId?: string | null;
  entityLabel?: string;
  description?: string;
};
export type RunResult = Failure[] | "NOT_CHECKED" | "NOT_EXECUTABLE";

// A check run is evidence about one project's register (§17.4 — "the measured
// object"). The tenancy travels on the context so no runner can reach across
// projects, and so two concurrent runs cannot share module state.
type Ctx = {
  activeSets: Map<string, Set<string>>;
  allSets: Map<string, Set<string>>;
  db: ScopedDb;
  projectId: string;
};

const doc = (d: { id: string; docNumber: string }, extra?: string): Failure => ({
  entityKey: `Document:${d.id}`, entityType: "Document", entityId: d.id, documentId: d.id, entityLabel: d.docNumber, description: extra,
});
const rev = (r: { id: string; value: string; documentId: string; document?: { docNumber: string } }, extra?: string): Failure => ({
  entityKey: `Revision:${r.id}`, entityType: "Revision", entityId: r.id, documentId: r.documentId,
  entityLabel: `${r.document?.docNumber ?? ""} rev ${r.value}`, description: extra,
});
const cfg = (description: string): Failure => ({ entityKey: "config", entityType: "Config", entityLabel: "Configuration", description });
/** Rules of the distribution matrix that grant Approve — the approval authority (§8.2). */
async function approveRules(ctx: Ctx) {
  const rules = await ctx.db.permissionRule.findMany({ select: { verbs: true, criticality: true, docType: true, discipline: true } });
  return rules.filter((r) => r.verbs.includes('"APPROVE"') || r.verbs.includes('"CONFIGURE"'));
}
const spine = (key: string, description: string): Failure => ({ entityKey: `spine:${key}`, entityType: "Spine", entityLabel: "Traceability Spine", description });
const org = (description: string): Failure => ({ entityKey: "config", entityType: "Organization", entityLabel: "Organization", description });

function partsOf(docNumber: string, delimiter: string): string[] {
  return docNumber.split(delimiter);
}

async function loadSets(t: Tenant, activeOnly: boolean): Promise<Map<string, Set<string>>> {
  const rows = await t.db.configValue.findMany({ where: activeOnly ? { status: "ACTIVE" } : {}, select: { setKey: true, code: true } });
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.setKey)) map.set(r.setKey, new Set());
    map.get(r.setKey)!.add(r.code);
  }
  return map;
}

export async function buildCtx(t: Tenant): Promise<Ctx> {
  const [allSets, activeSets] = await Promise.all([loadSets(t, false), loadSets(t, true)]);
  return { allSets, activeSets, db: t.db, projectId: t.projectId };
}

type Runners = Record<string, (ctx: Ctx) => Promise<RunResult>>;

export const RUNNERS: Runners = {
  // ── Identity ──────────────────────────────────────────────────────────────
  "ID-01": async (ctx) => {
    const bad = await ctx.db.document.findMany({ where: { docNumber: "" }, select: { id: true, docNumber: true } });
 return bad.map((d) => doc(d, "Document number absent."));
  },
  "ID-02": async (ctx) => {
    const all = await ctx.db.document.findMany({ select: { id: true, docNumber: true } });
    const seen = new Map<string, number>();
    for (const d of all) seen.set(d.docNumber, (seen.get(d.docNumber) ?? 0) + 1);
    return all.filter((d) => (seen.get(d.docNumber) ?? 0) > 1).map((d) => doc(d, `One number resolves to two documents — structural contradiction (ID-02 ▲).`));
  },
  "ID-03": async (ctx) => {
    // Unique constraint makes reuse impossible in-system; verify no cancelled doc shares a number with a live one.
    const cancelled = await ctx.db.document.findMany({ where: { state: "CANCELLED" }, select: { docNumber: true } });
    const live = await ctx.db.document.findMany({ where: { state: { not: "CANCELLED" }, docNumber: { in: cancelled.map((c) => c.docNumber) } }, select: { docNumber: true } });
    return live.map((l) => cfg(`Number reused after cancellation: ${l.docNumber} (ID-03 ▲).`));
  },
  "ID-04": async (ctx) => {
    const [docs, schemes, routing] = await Promise.all([
      ctx.db.document.findMany({ select: { id: true, docNumber: true, deliverableType: true } }),
      ctx.db.scheme.findMany({ include: { fields: { orderBy: { position: "asc" } } } }),
      ctx.db.schemeRouting.findMany(),
    ]);
    const failures: Failure[] = [];
    for (const d of docs) {
      const route = routing.find((r) => r.deliverableType === d.deliverableType && r.status === "ACTIVE");
      const scheme = schemes.find((s) => s.name === route?.schemeName);
      if (!scheme) { failures.push(doc(d, `No active numbering scheme routed for deliverable type "${d.deliverableType}".`)); continue; }
      const parts = partsOf(d.docNumber, scheme.delimiter);
      if (parts.length !== scheme.fields.length) {
 failures.push(doc(d, `Field count ${parts.length} ≠ scheme "${scheme.name}" count ${scheme.fields.length}.`));
      }
    }
    return failures;
  },
  "ID-05": async (ctx) => {
    const [docs, schemes] = await Promise.all([
      ctx.db.document.findMany({ select: { id: true, docNumber: true, deliverableType: true } }),
      ctx.db.scheme.findMany({ include: { fields: true } }),
    ]);
    const routing = await ctx.db.schemeRouting.findMany();
    const failures: Failure[] = [];
    for (const d of docs) {
      const scheme = schemes.find((s) => s.name === routing.find((r) => r.deliverableType === d.deliverableType)?.schemeName);
      if (!scheme) continue;
      const parts = partsOf(d.docNumber, scheme.delimiter);
 if (parts.some((p) => p.trim() === "")) failures.push(doc(d, `Delimiter appears within/adjacent to a field.`));
    }
    return failures;
  },
  "ID-06": async (ctx) => {
    const [docs, schemes, routing] = await Promise.all([
      ctx.db.document.findMany({ select: { id: true, docNumber: true, deliverableType: true } }),
      ctx.db.scheme.findMany({ include: { fields: { orderBy: { position: "asc" } } } }),
      ctx.db.schemeRouting.findMany(),
    ]);
    const failures: Failure[] = [];
    for (const d of docs) {
      const scheme = schemes.find((s) => s.name === routing.find((r) => r.deliverableType === d.deliverableType)?.schemeName);
      if (!scheme) continue;
      const parts = partsOf(d.docNumber, scheme.delimiter);
      if (parts.length !== scheme.fields.length) continue;
      for (let i = 0; i < scheme.fields.length; i++) {
        const f = scheme.fields[i];
        if (f.rule?.startsWith("COUNTER")) {
          const digits = Number(f.rule.match(/DIGITS\((\d+)\)/)?.[1] ?? 5);
 if (!new RegExp(`^\\d{${digits}}$`).test(parts[i])) failures.push(doc(d, `Sequence "${parts[i]}" is not ${digits} digits.`));
          continue;
        }
        if (!f.valueSetKey) continue;
        const set = ctx.allSets.get(f.valueSetKey);
 if (set && !set.has(parts[i])) failures.push(doc(d, `Field "${f.label}" value "${parts[i]}" is not in the published set — retired or unknown.`));
      }
    }
    return failures;
  },
  "ID-07": async (ctx) => {
    const [docs, schemes, routing] = await Promise.all([
      ctx.db.document.findMany({ select: { id: true, docNumber: true, deliverableType: true } }),
      ctx.db.scheme.findMany({ include: { fields: { orderBy: { position: "asc" } } } }),
      ctx.db.schemeRouting.findMany(),
    ]);
    const failures: Failure[] = [];
    for (const d of docs) {
      const scheme = schemes.find((s) => s.name === routing.find((r) => r.deliverableType === d.deliverableType)?.schemeName);
      if (!scheme) continue;
      const parts = partsOf(d.docNumber, scheme.delimiter);
      const labels = scheme.fields.map((f) => f.label);
      const required = ["Project code", "Discipline", "Document type"];
      for (const req of required) {
        const idx = labels.findIndex((l) => l.toLowerCase().includes(req.toLowerCase()));
 if (idx >= 0 && (!parts[idx] || parts[idx] === "")) failures.push(doc(d, `Required field "${req}" absent from the number.`));
      }
    }
    return failures;
  },
  "ID-08": async (ctx) => {
    const docs = await ctx.db.document.findMany({ select: { id: true, docNumber: true } });
    return docs
      .filter((d) => /rev|revision|\d{4}-\d{2}-\d{2}/i.test(d.docNumber))
.map((d) => doc(d, `Excluded value (revision/status/date) encoded in the number.`));
  },
  "ID-09": async (ctx) => {
    const files = await ctx.db.storedFile.findMany({ include: { revision: { include: { document: { select: { docNumber: true } } } } } });
    return files
      .filter((f) => f.revision && !safeName(f.path).startsWith(f.revision.document.docNumber))
.map((f) => ({ entityKey: `StoredFile:${f.id}`, entityType: "StoredFile", entityId: f.id, documentId: f.revision?.documentId, entityLabel: safeName(f.path), description: "File name does not begin with the document number." }));
  },
  "ID-10": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { deliverableType: { in: ["CTR", "VND", "TPY", "CLT"] }, receivedDate: { not: null }, docNumber: "" }, select: { id: true, docNumber: true } });
 return docs.map((d) => doc(d, "External item received without a number issued first."));
  },
  "ID-11": async (ctx) => {
    const [docs, counters, schemes, routing] = await Promise.all([
      ctx.db.document.findMany({ select: { id: true, docNumber: true, deliverableType: true } }),
      ctx.db.numberCounter.findMany({ select: { prefix: true } }),
      ctx.db.scheme.findMany({ include: { fields: { orderBy: { position: "asc" } } } }),
      ctx.db.schemeRouting.findMany(),
    ]);
    const prefixes = new Set(counters.map((c) => c.prefix));
    const failures: Failure[] = [];
    for (const d of docs) {
      const scheme = schemes.find((s) => s.name === routing.find((r) => r.deliverableType === d.deliverableType)?.schemeName);
      if (!scheme) continue;
      const parts = partsOf(d.docNumber, scheme.delimiter);
      if (parts.length !== scheme.fields.length) continue;
      const prefix = parts.slice(0, -1).join(scheme.delimiter);
 if (!prefixes.has(prefix)) failures.push(doc(d, `Number prefix "${prefix}" was never issued by the system — outside any issued range.`));
    }
    return failures;
  },
  "ID-16": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { legacyScheme: { not: null }, previousId: null }, select: { id: true, docNumber: true } });
 return docs.map((d) => doc(d, "Renumbered legacy item with no previous identifier retained."));
  },

  // ── Description ───────────────────────────────────────────────────────────
  "MD-02": async (ctx) => {
    const scope = await ctx.db.scopeConfig.findFirst();
 return scope ? []: [cfg("No authoritative register/scope nominated.")];
  },
  "MD-04": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { state: { in: ["RELEASED", "SUPERSEDED"] } }, include: { document: true } });
    return revs
      .filter((r) => !r.document.title || !r.document.docType || !r.document.discipline || !r.document.retentionClass || !r.document.criticality || !r.document.confidentiality)
.map((r) => rev(r, "Core document metadata empty on a released item."));
  },
  "MD-05": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { state: { in: ["RELEASED", "SUPERSEDED"] } } });
    return revs
      .filter((r) => !r.statusCode || !r.reasonForRevision || !r.changeDescription)
.map((r) => rev(r, "Core revision metadata empty on a released revision."));
  },
  "MD-06": async (ctx) => {
    const docs = await ctx.db.document.findMany({ select: { id: true, docNumber: true, title: true } });
 return docs.filter((d) => isEmptyTitle(d.title)).map((d) => doc(d, "The title only repeats the document type."));
  },
  "MD-07": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { isPlaceholder: false } });
    const matrixRows = await ctx.db.configValue.findMany({ where: { setKey: "DELIVERABLE_TYPE_FIELDS" } });
    const failures: Failure[] = [];
    for (const d of docs) {
      const row = matrixRows.find((m) => m.code === d.deliverableType);
      if (!row || !row.props) continue; // matrix not published for this type — SC-03 territory
      const props = JSON.parse(row.props) as Record<string, string>;
      const missing: string[] = [];
      if (props.originator === "required" && !d.originator) missing.push("originator");
      if (props.po === "required" && !d.contractRef) missing.push("contract/PO");
      if (props.receivedDate === "required" && !d.receivedDate) missing.push("date received");
 if (missing.length) failures.push(doc(d, `Conditional field empty where the type-to-field matrix requires it: ${missing.join(", ")}.`));
    }
    return failures;
  },
  "MD-08": async (ctx) => {
    const docs = await ctx.db.document.findMany({});
    const placeholderRe = /^(n\/?a|tbd|tbc|xxx|—|-)$/i;
    return docs
      .filter((d) => placeholderRe.test(d.originator ?? "") || placeholderRe.test(d.contractRef ?? "") || placeholderRe.test(d.subProject ?? ""))
.map((d) => doc(d, "Placeholder value in a non-applicable field."));
  },
  "MD-10": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { deliverableType: { in: ["CTR", "VND", "TPY", "CLT"] }, receivedDate: null, isPlaceholder: false } });
 return docs.map((d) => doc(d, "Date received absent on an external deliverable type."));
  },
  "MD-13": async (ctx) => {
    const docs = await ctx.db.document.findMany({});
    const failures: Failure[] = [];
    for (const d of docs) {
      const checks: [string, string | null, string][] = [
        ["DOCUMENT_TYPES", d.docType, "document type"],
        ["DISCIPLINES", d.discipline, "discipline"],
        ["CRITICALITY", d.criticality, "criticality"],
        ["CONFIDENTIALITY", d.confidentiality, "confidentiality"],
        ["RETENTION_CLASSES", d.retentionClass, "retention class"],
      ];
      for (const [setKey, value, labelName] of checks) {
        if (!value) continue;
        const set = ctx.allSets.get(setKey);
 if (set && !set.has(value)) failures.push(doc(d, `${labelName} "${value}" is not in the published set.`));
      }
    }
    return failures;
  },
  "MD-14": async (ctx) => {
    const sets = await ctx.db.configSet.findMany({ where: { version: { lte: 0 } } });
 return sets.map((s) => cfg(`Value list "${s.key}" is unversioned.`));
  },
  "MD-17": async (ctx) => {
    // every metadata update writes an audit event by construction; verify docs whose updatedAt moved without a matching event
    const recent = await ctx.db.auditEvent.count({ where: { action: "METADATA_CHANGE" } });
    const changed = await ctx.db.auditEvent.count({ where: { action: "REGISTER_ENTRY" } });
 return recent === 0 && changed === 0 ? [org("No metadata change log found.")]: [];
  },

  // ── Classification ────────────────────────────────────────────────────────
  "CL-02": async (ctx) => {
    const docs = await ctx.db.document.findMany({});
    const failures: Failure[] = [];
    const disc = ctx.allSets.get("DISCIPLINES");
    const types = ctx.allSets.get("DOCUMENT_TYPES");
    for (const d of docs) {
 if (disc?.has(d.docType) || types?.has(d.discipline)) failures.push(doc(d, "Value of one classification held in another classification's field."));
    }
    return failures;
  },
  "CL-05": async (ctx) => {
    const deliverables = ctx.allSets.get("DELIVERABLE_TYPES");
 if (!deliverables || deliverables.size === 0) return [cfg("Deliverable type set not published — type-to-field matrix missing.")];
    return [];
  },
  "CL-06": async (ctx) => {
    const docs = await ctx.db.document.findMany({});
    const types = ctx.allSets.get("DOCUMENT_TYPES");
 return docs.filter((d) => !d.docType || !types?.has(d.docType)).map((d) => doc(d, "Document type absent or not in the published set."));
  },
  "CL-08": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { discipline: "" } });
 return docs.map((d) => doc(d, "Discipline absent."));
  },
  "CL-11": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { criticality: null, isPlaceholder: false } });
 return docs.map((d) => doc(d, "Criticality absent where classification is in use."));
  },
  "CL-12": async (ctx) => {
    // §8.2 — authority is the Approve grant in the distribution matrix.
    const [crits, rows] = await Promise.all([ctx.db.configValue.findMany({ where: { setKey: "CRITICALITY" } }), approveRules(ctx)]);
    const failures: Failure[] = [];
    for (const c of crits) {
      const covered = rows.some((r) => r.criticality === c.code) || rows.some((r) => r.criticality == null);
 if (!covered) failures.push(cfg(`Criticality "${c.code}" does not drive any published approval authority.`));
    }
    return failures;
  },
  "CL-13": async (ctx) => {
    const [defaults, missing] = await Promise.all([
      ctx.db.configValue.findFirst({ where: { setKey: "CONFIDENTIALITY", props: { contains: "default" } } }),
      ctx.db.document.count({ where: { confidentiality: null } }),
    ]);
 if (!defaults && missing > 0) return [cfg("Confidentiality absent on records and no default class published.")];
    return [];
  },
  "CL-16": async (ctx) => {
    // §5.8 applies "where the asset is broken down", and to documents that
    // describe a part of it — a drawing or datasheet, not a procedure or a plan.
    // The document types that do are flagged describesAsset in the published set.
    if (!(await ctx.db.assetItem.count())) return "NOT_CHECKED" as const;
    const types = await ctx.db.configValue.findMany({ where: { setKey: "DOCUMENT_TYPES", props: { contains: '"describesAsset":true' } }, select: { code: true } });
    const describing = types.map((t) => t.code);
    if (!describing.length) return "NOT_CHECKED" as const;
    const docs = await ctx.db.document.findMany({ where: { isPlaceholder: false, docType: { in: describing }, state: { notIn: ["CANCELLED", "WITHDRAWN"] } }, select: { id: true, docNumber: true, docType: true } });
    const rels = await ctx.db.relationship.findMany({ where: { kind: "DOC_ASSET" }, select: { fromId: true } });
    const linked = new Set(rels.map((r) => r.fromId));
    return docs.filter((d) => !linked.has(d.id)).map((d) => doc(d, `This ${d.docType} describes equipment but is not linked to its asset tag.`));
  },

  // ── Revision ──────────────────────────────────────────────────────────────
  "RV-02": async (ctx) => {
    const n = await ctx.db.scheme.count();
 return n === 0 ? [cfg("Revision/numbering scheme not published.")]: [];
  },
  "RV-03": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ include: { document: { select: { docNumber: true } } } });
    return revs
      .filter((r) => (r.series === "DESIGN" && !/^[A-Z]+$/.test(r.value)) || (r.series === "EXECUTION" && !/^\d+$/.test(r.value)))
.map((r) => rev(r, `Revision value "${r.value}" is not in the ${r.series.toLowerCase()} series convention.`));
  },
  "RV-04": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ include: { document: { select: { docNumber: true } } } });
    return revs
      .filter((r) => EXCLUDED_REV_LETTERS.some((l) => r.value.toUpperCase().includes(l)))
.map((r) => rev(r, `Excluded character in revision value "${r.value}" — I O Q S X Z are misread as digits.`));
  },
  "RV-06": async (ctx) => {
    const docs = await ctx.db.document.findMany({ include: { revisions: { orderBy: { createdAt: "asc" } } } });
    const failures: Failure[] = [];
    for (const d of docs) {
      const numeric = d.revisions.filter((r) => /^\d+$/.test(r.value));
      for (let i = 1; i < numeric.length; i++) {
        if (Number(numeric[i].value) <= Number(numeric[i - 1].value)) {
 failures.push(rev(numeric[i], "Revision sequence moving backwards."));
        }
      }
    }
    return failures;
  },
  "RV-07": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ include: { document: { select: { docNumber: true } } } });
    const seen = new Map<string, number>();
    const failures: Failure[] = [];
    for (const r of revs) {
      const key = `${r.documentId}:${r.value.toUpperCase()}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
 if (seen.get(key)! > 1) failures.push(rev(r, "Revision value repeated within the document."));
    }
    return failures;
  },
  "RV-08": async (ctx) => {
    const docs = await ctx.db.document.findMany({ include: { revisions: { where: { state: "IN_PREPARATION" } } } });
    return docs
      .filter((d) => d.revisions.length > 1)
.flatMap((d) => d.revisions.slice(1).map((r) => rev(r, "More than one revision in preparation.")));
  },
  "RV-10": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { authorizationReason: null }, include: { document: { select: { docNumber: true } } } });
 return revs.map((r) => rev(r, "Revision established with no recorded authorization."));
  },
  "RV-11": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { OR: [{ authorizedByName: null }, { authorizedAt: null }], authorizationReason: { not: null } }, include: { document: { select: { docNumber: true } } } });
 return revs.map((r) => rev(r, "Authorization missing reason, party or date."));
  },
  "RV-12": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { authorizationReason: null, cycles: { some: {} } }, include: { document: { select: { docNumber: true } } } });
 return revs.map((r) => rev(r, "Revision submitted for review without authorization issued."));
  },
  "RV-13": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { reasonForRevision: null }, include: { document: { select: { docNumber: true } } } });
 return revs.map((r) => rev(r, "Reason for revision absent."));
  },
  "RV-14": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ include: { document: { select: { docNumber: true } } } });
    return revs
      .filter((r) => !r.changeDescription || r.changeDescription.trim().toLowerCase() === (r.reasonForRevision ?? "").trim().toLowerCase())
.map((r) => rev(r, "Description of change absent or restating the reason."));
  },
  "RV-15": async (ctx) => {
    const docs = await ctx.db.document.findMany({ include: { revisions: { where: { state: "RELEASED" } } } });
    return docs
      .filter((d) => d.revisions.length > 1)
.flatMap((d) => d.revisions.slice(1).map((r) => rev(r, "Two current revisions of one document — structural contradiction.")));
  },
  "RV-16": async (ctx) => {
    const docs = await ctx.db.document.findMany({
      where: { state: "ACTIVE", revisions: { none: { state: "RELEASED" } } },
    });
 return docs.map((d) => doc(d, "Document in use with no current revision — shall not be used."));
  },

  // ── State & status ────────────────────────────────────────────────────────
  "ST-02": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { state: { notIn: [...REV_STATES] } }, include: { document: { select: { docNumber: true } } } });
 return revs.map((r) => rev(r, `Revision state "${r.state}" not in the permitted set.`));
  },
  "ST-03": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { state: { notIn: [...DOC_STATES] } } });
 return docs.map((d) => doc(d, `Document state "${d.state}" not in the permitted set.`));
  },
  "ST-05": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { state: "" } }).catch(() => []);
 return (docs as { id: string; docNumber: string }[]).map((d) => doc(d, "State absent."));
  },
  "ST-06": async (ctx) => {
    const order: Record<string, number> = { IN_PREPARATION: 0, IN_REVIEW: 1, RELEASED: 2, SUPERSEDED: 3, VOID: 4 };
    const events = await ctx.db.auditEvent.findMany({ where: { action: "STATE_TRANSITION", entityType: "Revision", oldValue: { not: null }, newValue: { not: null } } });
    return events
      .filter((e) => order[e.oldValue!] !== undefined && order[e.newValue!] !== undefined && order[e.newValue!] < order[e.oldValue!])
.map((e) => ({ entityKey: `AuditEvent:${e.id}`, entityType: "Revision", entityId: e.entityId ?? undefined, documentId: null, entityLabel: e.entityLabel ?? "", description: "Backward state transition." }));
  },
  "ST-07": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { state: { in: ["RELEASED", "SUPERSEDED"] }, approvals: { none: {} } }, include: { document: { select: { docNumber: true } } } });
 return revs.map((r) => rev(r, "Released with no recorded approval — structural contradiction."));
  },
  "ST-08": async (ctx) => {
    const docs = await ctx.db.document.findMany({ include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "asc" } } } });
    return docs
      .filter((d) => d.revisions.length > 1)
.flatMap((d) => d.revisions.slice(0, -1).map((r) => rev(r, "Earlier revision still released after its successor.")));
  },
  "ST-09": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { state: { in: ["RELEASED", "SUPERSEDED"] }, statusCode: null }, include: { document: { select: { docNumber: true } } } });
 return revs.map((r) => rev(r, "Released revision carrying no status."));
  },
  "ST-10": async (ctx) => {
    const set = ctx.allSets.get("STATUSES");
 return set && set.size > 0 ? []: [cfg("Status set not published.")];
  },
  "ST-11": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { statusCode: { not: null } }, include: { document: { select: { docNumber: true } } } });
    const set = ctx.allSets.get("STATUSES");
 return revs.filter((r) => set && !set.has(r.statusCode!)).map((r) => rev(r, "Status not in the published set."));
  },
  "ST-12": async (ctx) => {
    const rows = await ctx.db.configValue.findMany({ where: { setKey: "STATUSES", props: { contains: "true" } } });
 return rows.length ? []: [cfg("Execution statuses not identified — the set shall carry an execution flag per value.")];
  },
  "ST-13": async (ctx) => {
    const items = await ctx.db.transmittalItem.findMany({
      where: { transmittal: { reasonForIssue: "EXECUTION", direction: "OUTGOING" } },
      include: { revision: { include: { document: { select: { docNumber: true } } } }, transmittal: true },
    });
    const execStatuses = (await ctx.db.configValue.findMany({ where: { setKey: "STATUSES" } })).filter((s) => s.props?.includes("true")).map((s) => s.code);
    return items
      .filter((i) => i.revision.statusCode && !execStatuses.includes(i.revision.statusCode))
.map((i) => rev(i.revision, "Issued for execution at a status that does not permit physical execution."));
  },
  "ST-14": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { state: { in: ["RELEASED", "SUPERSEDED"] } }, include: { document: { select: { docNumber: true } } } });
    const failures: Failure[] = [];
    for (const r of revs) {
      const logged = await ctx.db.auditEvent.findFirst({ where: { entityType: "Revision", entityId: r.id, action: { in: ["RELEASE", "STATE_TRANSITION"] } } });
 if (!logged) failures.push(rev(r, "State transition not logged with actor and time."));
    }
    return failures;
  },

  // ── Approval ──────────────────────────────────────────────────────────────
  "AP-01": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { state: { in: ["RELEASED", "SUPERSEDED"] }, approvals: { none: {} } }, include: { document: { select: { docNumber: true } } } });
 return revs.map((r) => rev(r, "Released with no approval — structural contradiction."));
  },
  "AP-02": async (ctx) => {
    const n = (await approveRules(ctx)).length;
 return n === 0 ? [cfg("No function holds Approve in the distribution matrix — approval authority not published.")]: [];
  },
  "AP-03": async (ctx) => {
    const approvals = await ctx.db.approval.findMany({ where: { matrixVersion: { lte: 0 } }, include: { revision: { include: { document: { select: { docNumber: true } } } } } });
 return approvals.map((a) => rev(a.revision, "Approval recorded against an unversioned authority matrix."));
  },
  "AP-05": async (ctx) => {
    // Did the approver's function hold Approve for this class? Delegated approvals are checked under §8.5.
    const { loadActor, can } = await import("../permissions");
    const approvals = await ctx.db.approval.findMany({ include: { revision: { include: { document: true } } } });
    const members = await ctx.db.projectMembership.findMany({ where: { projectId: ctx.projectId } });
    const actors = new Map<string, Awaited<ReturnType<typeof loadActor>>>();
    const failures: Failure[] = [];
    for (const a of approvals) {
      if (a.approverRole.includes("delegation")) continue;
      const m = members.find((x) => x.userId === a.approverId);
      if (!m) continue;
      if (!actors.has(m.functionId)) actors.set(m.functionId, await loadActor(ctx as never, m.functionId));
      if (!can(actors.get(m.functionId) ?? null, "APPROVE", a.revision.document)) {
 failures.push(rev(a.revision, `Approver "${a.approverName}" (${a.approverRole}) does not hold Approve for this class in the distribution matrix.`));
      }
    }
    return failures;
  },
  "AP-09": async (ctx) => {
    const approvals = await ctx.db.approval.findMany({ where: { approverRole: { contains: "delegation" } }, include: { revision: { include: { document: { select: { docNumber: true } } } } } });
    const failures: Failure[] = [];
    for (const a of approvals) {
      const del = await ctx.db.delegation.findFirst({ where: { toUserId: a.approverId, endDate: { gte: a.decidedAt } } });
 if (!del) failures.push(rev(a.revision, "Approval recorded under an expired or absent delegation."));
    }
    return failures;
  },
  "AP-10": async (ctx) => {
    const delegations = await ctx.db.delegation.findMany({ include: { toUser: true, fromUser: true } });
    const failures: Failure[] = [];
    for (const del of delegations) {
      const onward = await ctx.db.delegation.findFirst({ where: { fromUserId: del.toUserId } });
 if (onward) failures.push(org(`Onward delegation recorded: ${del.toUser.name} re-delegated ${onward.scope ?? "authority"}.`));
    }
    return failures;
  },
  "AP-11": async (ctx) => {
    const rank: Record<string, number> = { VIEWER: 0, AUTHOR: 1, REVIEWER: 2, APPROVER: 3, CONTROLLER: 3, ADMIN: 5 };
    const approvals = await ctx.db.approval.findMany({ include: { revision: { include: { document: true } } } });
    return approvals
      .filter((a) => ["SAFETY", "REGULATORY"].includes(a.revision.document.criticality ?? "") && (rank[a.approverRole.split(" ")[0]] ?? -1) < rank.ADMIN)
.map((a) => rev(a.revision, "Criticality not reflected in the authority applied — safety/regulatory-critical requires the defined authority."));
  },

  // ── Review ────────────────────────────────────────────────────────────────
  "RO-02": async (ctx) => {
    const cycles = await ctx.db.reviewCycle.findMany({ where: { status: "CLOSED", binding: true }, include: { revision: { include: { document: { select: { docNumber: true } } } } } });
    return cycles
      .filter((c) => !c.submittedAt || !c.receivedAt || !c.issuedToReviewAt || !c.returnedFromReviewAt || !c.returnedToOriginatorAt)
.map((c) => ({ entityKey: `ReviewCycle:${c.id}`, entityType: "ReviewCycle", entityId: c.id, documentId: c.revision.documentId, entityLabel: `${c.revision.document.docNumber} rev ${c.revision.value} cycle ${c.sequence}`, description: "Custody point timestamp missing." }));
  },
  "RO-03": async (ctx) => {
    const set = ctx.allSets.get("REVIEW_OUTCOMES");
 return set && set.size > 0 ? []: [cfg("Review outcome set not published.")];
  },
  "RO-04": async (ctx) => {
    const cycles = await ctx.db.reviewCycle.findMany({ where: { outcome: { not: null } }, include: { revision: { include: { document: { select: { docNumber: true } } } } } });
    const verdicts = ctx.allSets.get("REVIEW_OUTCOMES");
    const advice = ctx.allSets.get("REVIEW_ADVICE");
    const setFor = (c: { binding: boolean; outcomeSetKey: string | null }) => (c.outcomeSetKey ? ctx.allSets.get(c.outcomeSetKey) : undefined) ?? (c.binding ? verdicts : advice);
 return cycles.filter((c) => { const set = setFor(c); return set && !set.has(c.outcome!); }).map((c) => ({ entityKey: `ReviewCycle:${c.id}`, entityType: "ReviewCycle", entityId: c.id, documentId: c.revision.documentId, entityLabel: `${c.revision.document.docNumber} rev ${c.revision.value}`, description: "Outcome not in the published set." }));
  },
  "RO-05": async (ctx) => {
    const outcomes = await ctx.db.configValue.findMany({ where: { setKey: "REVIEW_OUTCOMES" } });
 return outcomes.filter((o) => !o.props || !o.props.includes("proceed")).map((o) => cfg(`Outcome "${o.code}" carries no proceed consequence.`));
  },
  "RO-06": async (ctx) => {
    const outcomes = await ctx.db.configValue.findMany({ where: { setKey: "REVIEW_OUTCOMES" } });
 return outcomes.filter((o) => !o.props || !o.props.includes("resubmit")).map((o) => cfg(`Outcome "${o.code}" carries no resubmission consequence.`));
  },
  "RO-07": async (ctx) => {
    const cycles = await ctx.db.reviewCycle.findMany({
      where: { outcome: { in: ["REVISE_AND_RESUBMIT", "APPROVED_WITH_COMMENTS", "REJECTED"] }, returnedToOriginatorAt: { not: null } },
      include: { revision: { include: { document: { include: { revisions: true } } } } },
    });
    const failures: Failure[] = [];
    for (const c of cycles) {
      const later = c.revision.document.revisions.some(
        (r) => r.createdAt > (c.returnedToOriginatorAt ?? c.submittedAt) && r.authorizationReason
      );
 if (!later) failures.push({ entityKey: `ReviewCycle:${c.id}`, entityType: "ReviewCycle", entityId: c.id, documentId: c.revision.documentId, entityLabel: `${c.revision.document.docNumber} rev ${c.revision.value}`, description: "Resubmission required but no revision authorized." });
    }
    return failures;
  },
  "RO-09": async (ctx) => {
    const events = await ctx.db.auditEvent.findMany({ where: { action: "REVIEW_OUTCOME", entityId: { not: null } }, select: { entityId: true } });
    const seen = new Map<string, number>();
    for (const e of events) seen.set(e.entityId!, (seen.get(e.entityId!) ?? 0) + 1);
 return [...seen.entries()].filter(([, n]) => n > 1).map(([entityId]) => ({ entityKey: `ReviewCycle:${entityId}`, entityType: "ReviewCycle", entityId, description: "Outcome altered after recording — more than one outcome event." }));
  },
  "RO-11": async (ctx) => {
    const comments = await ctx.db.reviewComment.findMany({ where: { classification: "" } });
 return comments.map((cm) => ({ entityKey: `ReviewComment:${cm.id}`, entityType: "ReviewComment", entityId: cm.id, description: "Comment with no progression consequence recorded." }));
  },
  "RO-13": async (ctx) => {
    const comments = await ctx.db.reviewComment.findMany({ where: { progressionPreventing: true, status: "CLOSED", resolution: null } });
 return comments.map((cm) => ({ entityKey: `ReviewComment:${cm.id}`, entityType: "ReviewComment", entityId: cm.id, description: "Progression-preventing comment closed with no recorded response." }));
  },
  "RO-14": async (ctx) => {
    const revs = await ctx.db.revision.findMany({
      where: { state: { in: ["RELEASED", "SUPERSEDED"] }, cycles: { some: { comments: { some: { progressionPreventing: true, status: "OPEN" } } } } },
      include: { document: { select: { docNumber: true } } },
    });
 return revs.map((r) => rev(r, "Work proceeding on a revision with a progression-preventing comment open."));
  },
  "RO-15": async (ctx) => {
    const cycles = await ctx.db.reviewCycle.findMany({ where: { mode: "SERIAL" }, include: { assignments: true } });
    return cycles
      .filter((c) => c.assignments.some((a) => a.order < 1) || new Set(c.assignments.map((a) => a.order)).size !== c.assignments.length)
.map((c) => ({ entityKey: `ReviewCycle:${c.id}`, entityType: "ReviewCycle", entityId: c.id, description: "Serial review sequence not set before the cycle began." }));
  },
  "RO-18": async (ctx) => {
    const cycles = await ctx.db.reviewCycle.findMany({ where: { status: "CLOSED", returnedToOriginatorAt: null }, include: { revision: { include: { document: { select: { docNumber: true } } } } } });
 return cycles.map((c) => ({ entityKey: `ReviewCycle:${c.id}`, entityType: "ReviewCycle", entityId: c.id, documentId: c.revision.documentId, entityLabel: `${c.revision.document.docNumber} rev ${c.revision.value}`, description: "Cycle closed/returned outside the control function." }));
  },

  // ── Format ────────────────────────────────────────────────────────────────
  "FM-01": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { state: { in: ["RELEASED", "SUPERSEDED"] }, nativeFileId: null }, include: { document: { select: { docNumber: true } } } });
 return revs.map((r) => rev(r, "Native form not retained."));
  },
  "FM-02": async (ctx) => {
    const files = await ctx.db.storedFile.findMany({ where: { kind: "NATIVE", mime: { notIn: ["application/pdf", "image/png", "image/jpeg"] }, revision: { appVersion: null } }, include: { revision: { include: { document: { select: { docNumber: true } } } } } });
 return files.map((f) => rev(f.revision!, "Proprietary native format with no authoring application/version recorded."));
  },
  "FM-03": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { state: { in: ["RELEASED", "SUPERSEDED"] }, renditionFileId: null }, include: { document: { select: { docNumber: true } } } });
 return revs.map((r) => rev(r, "Released revision with no rendition — structural control failure."));
  },
  "FM-04": async (ctx) => {
    const files = await ctx.db.storedFile.findMany({ where: { kind: "RENDITION", mime: { notIn: ["application/pdf"] } }, include: { revision: { include: { document: { select: { docNumber: true } } } } } });
 return files.map((f) => rev(f.revision!, "Rendition is not a fixed, viewable format (PDF)."));
  },
  "FM-08": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { retentionClass: { in: ["ASSET_LIFE", "STATUTORY", "PERMANENT"] } } });
    const failures: Failure[] = [];
    for (const d of docs) {
      const revs = await ctx.db.revision.findMany({ where: { documentId: d.id, state: { in: ["RELEASED", "SUPERSEDED"] } }, include: { files: true } });
      for (const r of revs) {
        const rend = r.files.find((f) => f.kind === "RENDITION");
 if (rend && rend.mime !== "application/pdf") failures.push(rev(r, "Long-term retention in a non-preservation format."));
      }
    }
    return failures;
  },
  "FM-10": async (ctx) => {
    const files = await ctx.db.storedFile.findMany({ include: { revision: true } });
    const failures: Failure[] = [];
    for (const f of files) {
      if (!existsSync(path.join(UPLOAD_ROOT, f.path))) {
 failures.push({ entityKey: `StoredFile:${f.id}`, entityType: "StoredFile", entityId: f.id, documentId: f.revision?.documentId, entityLabel: f.name, description: "File missing from the repository." });
      }
    }
    return failures;
  },
  "FM-11": async (ctx) => {
    const files = await ctx.db.storedFile.findMany({ where: { revision: { state: { in: ["RELEASED", "SUPERSEDED"] } } }, include: { revision: { include: { document: { select: { docNumber: true } } } } } });
    const failures: Failure[] = [];
    for (const f of files) {
      try {
        const buf = await readFile(path.join(UPLOAD_ROOT, f.path));
        if (createHash("sha256").update(buf).digest("hex") !== f.sha256) {
 failures.push({ entityKey: `StoredFile:${f.id}`, entityType: "StoredFile", entityId: f.id, documentId: f.revision?.documentId, entityLabel: f.name, description: "File altered since release — hash mismatch." });
        }
      } catch {
        // missing files are FM-10's finding
      }
    }
    return failures;
  },

  // ── Issue & distribution ──────────────────────────────────────────────────
  "IS-02": async (ctx) => {
    const bad = await ctx.db.transmittal.findMany({ where: { number: "" } }).catch(() => []);
 return (bad as { id: string; number: string }[]).map((t) => ({ entityKey: `Transmittal:${t.id}`, entityType: "Transmittal", entityId: t.id, entityLabel: t.number, description: "Transmittal number absent." }));
  },
  "IS-03": async (ctx) => {
    const list = await ctx.db.transmittal.findMany({ include: { items: true, recipients: true } });
    return list
      .filter((t) => !t.dateOfIssue || !t.issuingParty || t.items.length === 0 || t.recipients.length === 0)
.map((t) => ({ entityKey: `Transmittal:${t.id}`, entityType: "Transmittal", entityId: t.id, entityLabel: t.number, description: "Transmittal missing a required element — date, party, items or recipients." }));
  },
  "IS-04": async (ctx) => {
    const list = await ctx.db.transmittal.findMany({ where: { reasonForIssue: "" } });
 return list.map((t) => ({ entityKey: `Transmittal:${t.id}`, entityType: "Transmittal", entityId: t.id, entityLabel: t.number, description: "Reason for issue absent." }));
  },
  "IS-05": async (ctx) => {
    const list = await ctx.db.transmittal.findMany({});
    const set = ctx.allSets.get("REASONS_FOR_ISSUE");
 return list.filter((t) => set && !set.has(t.reasonForIssue)).map((t) => ({ entityKey: `Transmittal:${t.id}`, entityType: "Transmittal", entityId: t.id, entityLabel: t.number, description: "Reason for issue not in the defined set." }));
  },
  "IS-06": async (ctx) => {
    const items = await ctx.db.transmittalItem.findMany({
      where: { transmittal: { direction: "OUTGOING" }, revision: { state: { notIn: ["RELEASED", "SUPERSEDED"] } } },
      include: { revision: { include: { document: { select: { docNumber: true } } } }, transmittal: true },
    });
 return items.map((i) => rev(i.revision, `Issued on ${i.transmittal.number} while not released — structural contradiction.`));
  },
  "IS-08": async (ctx) => {
    const items = await ctx.db.transmittalItem.findMany({
      where: { markedSuperseded: false, revision: { state: "SUPERSEDED" }, transmittal: { direction: "OUTGOING" } },
      include: { revision: { include: { document: { select: { docNumber: true } } } } },
    });
 return items.map((i) => rev(i.revision, "Superseded revision issued without being marked as such."));
  },
  "IS-09": async (ctx) => {
    const list = await ctx.db.transmittal.findMany({ include: { recipients: true } });
    return list
      .filter((t) => t.recipients.some((r) => !r.userId && (!r.name || r.name === "—")))
.map((t) => ({ entityKey: `Transmittal:${t.id}`, entityType: "Transmittal", entityId: t.id, entityLabel: t.number, description: "Recipients recorded only as a group or unnamed row." }));
  },
  "IS-11": async (ctx) => {
    const list = await ctx.db.transmittal.findMany({ where: { receivedDate: { not: null } } });
    return list
      .filter((t) => t.receivedDate && t.receivedDate < t.dateOfIssue)
.map((t) => ({ entityKey: `Transmittal:${t.id}`, entityType: "Transmittal", entityId: t.id, entityLabel: t.number, description: "Receipt date earlier than issue date." }));
  },
  "IS-13": async (ctx) => {
    const copies = await ctx.db.registeredCopy.findMany({ where: { OR: [{ holder: "" }, { location: "" }] }, include: { revision: { include: { document: { select: { docNumber: true } } } } } });
 return copies.map((cp) => ({ entityKey: `RegisteredCopy:${cp.id}`, entityType: "RegisteredCopy", entityId: cp.id, documentId: cp.revision.documentId, description: "Registered copy with no holder or location." }));
  },
  "IS-20": async (ctx) => {
    const list = await ctx.db.transmittal.findMany({ where: { status: "REJECTED", rejectionReason: null } });
 return list.map((t) => ({ entityKey: `Transmittal:${t.id}`, entityType: "Transmittal", entityId: t.id, entityLabel: t.number, description: "Rejection not recorded with a reason." }));
  },
  "IS-25": async (ctx) => {
    const list = await ctx.db.transmittal.findMany({ include: { items: true, cycles: true } });
    return list
      .filter((t) => t.items.length > 1 && t.cycles.length > 0)
      .filter((t) => new Set(t.cycles.map((c) => c.revisionId)).size < t.items.length)
.map((t) => ({ entityKey: `Transmittal:${t.id}`, entityType: "Transmittal", entityId: t.id, entityLabel: t.number, description: "Transmittal carrying several items held as one review cycle — one cycle per revision." }));
  },
  "IS-26": async (ctx) => {
    const reasons = await ctx.db.configValue.findMany({ where: { setKey: "REASONS_FOR_ISSUE" } });
    return reasons
      .filter((r) => !r.props || !r.props.includes("acceptancePeriodDays"))
.map((r) => cfg(`Acceptance period not published for reason "${r.code}".`));
  },
  "IS-27": async (ctx) => {
    const reasons = await ctx.db.configValue.findMany({ where: { setKey: "REASONS_FOR_ISSUE" } });
    const list = await ctx.db.transmittal.findMany({ where: { direction: "INCOMING", status: "ISSUED", receivedDate: { not: null } } });
    const failures: Failure[] = [];
    for (const t of list) {
      const period = Number(reasons.find((r) => r.code === t.reasonForIssue)?.props ? JSON.parse(reasons.find((r) => r.code === t.reasonForIssue)!.props!).acceptancePeriodDays ?? 5 : 5);
      const deadline = new Date(t.receivedDate!.getTime() + period * 86400000);
 if (deadline < new Date()) failures.push({ entityKey: `Transmittal:${t.id}`, entityType: "Transmittal", entityId: t.id, entityLabel: t.number, description: `Not checked within the ${period}-day acceptance period — treated as accepted only when the published rule says so (A.5.4).` });
    }
    return failures;
  },

  // ── Obsolescence ──────────────────────────────────────────────────────────
  "OB-01": async (ctx) => {
    const records = await ctx.db.obsolescenceRecord.findMany({ where: { OR: [{ authorityName: "" }, { reason: "" }] } });
 return records.map((r) => ({ entityKey: `ObsolescenceRecord:${r.id}`, entityType: "ObsolescenceRecord", entityId: r.id, documentId: r.documentId, description: "End state not recorded with date and authority." }));
  },
  "OB-04": async (ctx) => {
    const entries = await ctx.db.baselineEntry.findMany({ where: { document: { state: { in: ["WITHDRAWN"] } } }, include: { document: true, action: true } });
 return entries.map((e) => doc(e.document, `Withdrawn item still required by action ${e.action.code} — withdrawn/void item still in use.`));
  },
  "OB-05": async (ctx) => {
    const superseded = await ctx.db.revision.findMany({ where: { state: "SUPERSEDED" }, include: { document: { select: { docNumber: true } } } });
    const failures: Failure[] = [];
    for (const r of superseded) {
      const notified = await ctx.db.notification.findFirst({ where: { type: "SUPERSEDED", link: `/documents/${r.documentId}` } });
 if (!notified) failures.push(rev(r, "Supersession with no notification issued to recipients."));
    }
    return failures;
  },
  "OB-07": async (ctx) => {
    const { untoldRecipients } = await import("../supersession");
    return (await untoldRecipients(ctx)).map((u) => ({
      entityKey: `Revision:${u.old.id}`, entityType: "Revision", entityId: u.old.id, documentId: u.document.id,
      entityLabel: `${u.document.docNumber} rev ${u.old.value}`,
      description: `Rev ${u.old.value} was replaced but ${u.recipients.map((r) => r.name).join(", ")} ${u.recipients.length === 1 ? "was" : "were"} never told.`,
    }));
  },
  "OB-08": async (ctx) => {
    const copies = await ctx.db.registeredCopy.findMany({
      where: { status: "ACTIVE", revision: { state: { in: ["SUPERSEDED", "VOID"] } } },
      include: { revision: { include: { document: { select: { docNumber: true } } } } },
    });
 return copies.map((cp) => ({ entityKey: `RegisteredCopy:${cp.id}`, entityType: "RegisteredCopy", entityId: cp.id, documentId: cp.revision.documentId, entityLabel: `${cp.revision.document.docNumber} rev ${cp.revision.value} → ${cp.holder}`, description: "Registered copy carrying an invalid revision with no recorded action." }));
  },
  "OB-09": async (ctx) => {
    const copies = await ctx.db.registeredCopy.findMany({ where: { status: { not: "ACTIVE" }, actionRecord: null } });
 return copies.map((cp) => ({ entityKey: `RegisteredCopy:${cp.id}`, entityType: "RegisteredCopy", entityId: cp.id, description: "Copy action taken but not recorded." }));
  },
  "OB-13": async (ctx) => {
    const revs = await ctx.db.revision.findMany({ where: { state: "VOID", voidReassessment: null }, include: { document: { select: { docNumber: true } } } });
 return revs.map((r) => rev(r, "Void revision with no reassessment of work performed."));
  },
  "OB-14": async (ctx) => {
    const entries = await ctx.db.baselineEntry.findMany({ where: { document: { state: "WITHDRAWN" } }, include: { document: true } });
 return entries.map((e) => doc(e.document, "Item withdrawn while an open action requires it."));
  },

  // ── Retention ─────────────────────────────────────────────────────────────
  "RT-01": async (ctx) => {
    const set = ctx.allSets.get("RETENTION_CLASSES");
 return set && set.size > 0 ? []: [cfg("Retention schedule not published.")];
  },
  "RT-02": async (ctx) => {
    const classes = await ctx.db.configValue.findMany({ where: { setKey: "RETENTION_CLASSES" } });
 return classes.filter((c) => !c.props || !c.props.includes("basis")).map((c) => cfg(`Retention class "${c.code}" states no basis.`));
  },
  "RT-04": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { retentionClass: null, isPlaceholder: false } });
    return docs.map((d) => doc(d, "No retention class, and none could be set from its criticality."));
  },
  "RT-08": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { state: "ARCHIVED" }, include: { revisions: { where: { state: { in: ["RELEASED", "SUPERSEDED"] } }, include: { files: true } } } });
    return docs
      .filter((d) => !d.revisions.some((r) => r.files.some((f) => f.kind === "RENDITION")))
.map((d) => doc(d, "Archived information not retrievable in a fixed form."));
  },
  "RT-09": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { state: "ARCHIVED", OR: [{ retentionClass: null }, { title: "" }] } });
 return docs.map((d) => doc(d, "Archived information without complete metadata or register entry."));
  },

  // ── Baseline ──────────────────────────────────────────────────────────────
  "DB-02": async (ctx) => {
    const actions = await ctx.db.action.findMany({ where: { code: "" } }).catch(() => []);
 return (actions as { id: string; code: string }[]).map((a) => ({ entityKey: `Action:${a.id}`, entityType: "Action", entityId: a.id, entityLabel: a.code, description: "Action code absent." }));
  },
  "DB-03": async (ctx) => {
    const actions = await ctx.db.action.findMany({ where: { scheduleRef: null } });
 return actions.map((a) => ({ entityKey: `Action:${a.id}`, entityType: "Action", entityId: a.id, entityLabel: a.code, description: "Action not linked to the project schedule." }));
  },
  "DB-04": async (ctx) => {
    const entries = await ctx.db.baselineEntry.findMany({ where: { requiredStatus: "" }, include: { document: true, action: true } });
 return entries.map((e) => doc(e.document, `Baseline entry for action ${e.action.code} missing required status.`));
  },
  "DB-06": async (ctx) => {
    const entries = await ctx.db.baselineEntry.findMany({ include: { action: true, document: true } });
    return entries
      .filter((e) => e.action.scheduledDate && new Date(e.requiredBy) > new Date(e.action.scheduledDate))
.map((e) => doc(e.document, `Required-by date is after action ${e.action.code}'s date — not derived from it minus lead time.`));
  },
  "DB-10": async (ctx) => {
    const entries = await ctx.db.baselineEntry.findMany({ include: { action: true, document: true } });
    return entries
      .filter((e) => e.action.scheduledDate && new Date(e.requiredBy) > new Date(e.action.scheduledDate))
.map((e) => doc(e.document, `Baseline date disagrees with the schedule date for ${e.action.code}.`));
  },
  "DB-13": async (ctx) => {
    const actions = await ctx.db.action.findMany({ where: { scheduledDate: { lt: new Date() } }, include: { entries: { include: { document: { include: { revisions: { where: { state: "RELEASED" } } } } } } } });
    const failures: Failure[] = [];
    for (const a of actions) {
      for (const e of a.entries) {
        const current = e.document.revisions[0];
        if (!current) {
 failures.push(doc(e.document, `Action ${a.code} date passed with its required item never released.`));
          continue;
        }
        if (e.requiredStatus && current.statusCode !== e.requiredStatus) {
 failures.push(doc(e.document, `Action ${a.code} proceeded: item is at ${current.statusCode ?? "no status"}, required ${e.requiredStatus}.`));
        }
      }
    }
    return failures;
  },

  // ── Packages ──────────────────────────────────────────────────────────────
  "PK-01": async (ctx) => {
    const pkgs = await ctx.db.package.findMany({ where: { type: "" } }).catch(() => []);
 return (pkgs as { id: string; identifier: string }[]).map((p) => ({ entityKey: `Package:${p.id}`, entityType: "Package", entityId: p.id, entityLabel: p.identifier, description: "Package type not stated." }));
  },
  "PK-02": async (ctx) => {
    const pkgs = await ctx.db.package.findMany({ where: { type: "DEFINED" }, include: { members: true } });
 return pkgs.filter((p) => p.members.length === 0).map((p) => ({ entityKey: `Package:${p.id}`, entityType: "Package", entityId: p.id, entityLabel: p.identifier, description: "Defined package with no agreed composition." }));
  },
  "PK-03": async (ctx) => {
    const pkgs = await ctx.db.package.findMany({ where: { type: "ACCUMULATED", membershipRule: null } });
 return pkgs.map((p) => ({ entityKey: `Package:${p.id}`, entityType: "Package", entityId: p.id, entityLabel: p.identifier, description: "Accumulated package with no membership rule stated." }));
  },
  "PK-06": async (ctx) => {
    const pkgs = await ctx.db.package.findMany({ where: { compositionOwnerId: "" } }).catch(() => []);
 return (pkgs as { id: string; identifier: string }[]).map((p) => ({ entityKey: `Package:${p.id}`, entityType: "Package", entityId: p.id, entityLabel: p.identifier, description: "Composition owner not assigned." }));
  },
  "PK-07": async (ctx) => {
    const pkgs = await ctx.db.package.findMany({});
 return pkgs.filter((p) => p.acceptanceAuthorityId && p.acceptanceAuthorityId === p.compositionOwnerId).map((p) => ({ entityKey: `Package:${p.id}`, entityType: "Package", entityId: p.id, entityLabel: p.identifier, description: "Acceptance authority is the same person as the composition owner." }));
  },
  "PK-08": async (ctx) => {
    const pkgs = await ctx.db.package.findMany({ where: { completionDate: { lt: new Date() }, assessedAt: null } });
 return pkgs.map((p) => ({ entityKey: `Package:${p.id}`, entityType: "Package", entityId: p.id, entityLabel: p.identifier, description: "Package not assessed at its completion date." }));
  },
  "PK-11": async (ctx) => {
    const pkgs = await ctx.db.package.findMany({ where: { closedAt: { not: null } }, include: { members: true } });
    return pkgs
      .filter((p) => p.members.some((m) => m.requiredStatus && !m.completionDate) && !p.shortfallAcceptedBy)
.map((p) => ({ entityKey: `Package:${p.id}`, entityType: "Package", entityId: p.id, entityLabel: p.identifier, description: "Package closed with an unresolved, unaccepted shortfall." }));
  },
  "PK-12": async (ctx) => {
    const pkgs = await ctx.db.package.findMany({ where: { type: "ACCUMULATED", closedAt: { not: null }, ruleCeasedAt: null } });
 return pkgs.map((p) => ({ entityKey: `Package:${p.id}`, entityType: "Package", entityId: p.id, entityLabel: p.identifier, description: "Accumulated package closed without stating the rule has ceased to admit members." }));
  },
  "PK-14": async (ctx) => {
    const pkgs = await ctx.db.package.findMany({ where: { purpose: "" } });
 return pkgs.map((p) => ({ entityKey: `Package:${p.id}`, entityType: "Package", entityId: p.id, entityLabel: p.identifier, description: "Reason for issue not stated for the package." }));
  },

  // ── Register ──────────────────────────────────────────────────────────────
  "RG-09": async (ctx) => {
    const files = await ctx.db.storedFile.findMany({ where: { revisionId: null } });
 return files.map((f) => ({ entityKey: `StoredFile:${f.id}`, entityType: "StoredFile", entityId: f.id, entityLabel: f.name, description: "File held with no register entry — structural contradiction." }));
  },
  "RG-16": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { isPlaceholder: true, revisions: { some: {} } }, include: { revisions: { take: 1 } } });
 return docs.flatMap((d) => d.revisions.map((r) => rev(r, "Placeholder register entry holding a revision.")));
  },

  // ── Scope ─────────────────────────────────────────────────────────────────
  "SC-01": async (ctx) => {
    const scope = await ctx.db.scopeConfig.findFirst();
 return scope && scope.scopeStatement ? []: [cfg("Scope not stated.")];
  },
  "SC-03": async (ctx) => {
    const required = ["DELIVERABLE_TYPES", "DOCUMENT_TYPES", "DISCIPLINES", "STATUSES", "REVIEW_OUTCOMES", "CRITICALITY", "CONFIDENTIALITY", "RETENTION_CLASSES", "REASONS_FOR_ISSUE"];
    const missing = required.filter((k) => (ctx.allSets.get(k)?.size ?? 0) === 0);
    const [schemes, routing, matrix] = await Promise.all([ctx.db.scheme.count(), ctx.db.schemeRouting.count(), approveRules(ctx).then((r) => r.length)]);
    if (schemes === 0) missing.push("NUMBERING_SCHEMES");
    if (routing === 0) missing.push("SCHEME_ROUTING");
    if (matrix === 0) missing.push("APPROVE_IN_DISTRIBUTION_MATRIX");
 return missing.length ? [cfg(`Local configuration incomplete — not published: ${missing.join(", ")}.`)]: [];
  },
  "SC-09": async (ctx) => {
    const scope = await ctx.db.scopeConfig.findFirst();
 return scope?.effectiveDate ? []: [cfg("Effective date not stated.")];
  },

  // ── Conformance ───────────────────────────────────────────────────────────
  "CF-13": async (ctx) => {
    const defects = await ctx.db.defect.findMany({ where: { status: "ACCEPTED", reviewDate: null } });
 return defects.map((d) => ({ entityKey: `Defect:${d.id}`, entityType: "Defect", entityId: d.id, entityLabel: d.checkId, description: "Accepted defect with no review date." }));
  },
  "CF-16": async (ctx) => {
    const [scope, lastRun] = await Promise.all([ctx.db.scopeConfig.findFirst(), ctx.db.checkRun.findFirst({ orderBy: { ranAt: "desc" } })]);
    const interval = scope?.measurementIntervalDays ?? 30;
 if (!lastRun) return [org("Conformance has never been measured.")];
    const due = new Date(lastRun.ranAt.getTime() + interval * 86400000);
 return due < new Date() ? [org(`Last measurement ${lastRun.ranAt.toLocaleDateString("en-GB")} — interval of ${interval} days exceeded.`)]: [];
  },
  // ── Records (§2.2–2.4) ──
  "IO-03": async (ctx) => {
    const bad = await ctx.db.document.findMany({ where: { kind: "RECORD", revisions: { some: {} } } });
 return bad.map((d) => doc(d, "Record treated as a document — records carry no revision values."));
  },
  "IO-04": async (ctx) => {
    const bad = await ctx.db.document.findMany({ where: { kind: "RECORD", revisions: { some: { state: "SUPERSEDED" } } } });
 return bad.map((d) => doc(d, "Document treated as a record — superseded items cannot be records."));
  },
  "IO-05": async (ctx) => {
    const events = await ctx.db.auditEvent.findMany({ where: { action: { in: ["METADATA_CHANGE", "STATE_TRANSITION"] }, entityType: "Document" } });
    const recordIds = new Set((await ctx.db.document.findMany({ where: { kind: "RECORD", confirmedAt: { not: null } }, select: { id: true } })).map((r) => r.id));
 return events.filter((e) => e.entityId && recordIds.has(e.entityId) && new Date(e.ts) > new Date(0)).slice(0, 50).map((e) => ({ entityKey: `AuditEvent:${e.id}`, entityType: "Document", entityId: e.entityId!, documentId: e.entityId, entityLabel: e.entityLabel ?? "", description: "Confirmed record altered after confirmation — corrections are further records, never edits." }));
  },
  "IO-06": async (ctx) => {
    const corrections = await ctx.db.relationship.findMany({ where: { kind: "RECORD_CORRECTION" }, select: { fromId: true } });
    const correctedIds = new Set(corrections.map((c) => c.fromId));
    const docs = await ctx.db.document.findMany({ where: { title: { contains: "correction" } }, select: { id: true, docNumber: true } });
 return docs.filter((d) => !correctedIds.has(d.id)).map((d) => doc(d, "Correction issued with no reference to the record corrected."));
  },

  // ── Approval withdrawal (§8.7) ──
  "AP-12": async (ctx) => {
    const approvals = await ctx.db.approval.findMany({ where: { withdrawnAt: { not: null } }, include: { revision: { include: { document: { select: { docNumber: true } } } } } });
 return approvals.filter((a) => !a.withdrawnReason || !a.withdrawnBy).map((a) => rev(a.revision, "Withdrawal not recorded with reason and authority."));
  },
  "AP-13": async (ctx) => {
    const approvals = await ctx.db.approval.findMany({ where: { withdrawnAt: { not: null } }, include: { revision: { include: { document: true } } } });
    return approvals
      .filter((a) => a.revision.document.state !== "WITHDRAWN")
.map((a) => rev(a.revision, "Approval withdrawn but the document is not withdrawn — structural contradiction."));
  },

  // ── Retention / disposal (§13.5) ──
  "RT-11": async (ctx) => "NOT_CHECKED" as const,
  "RT-12": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { disposedAt: { not: null } } });
 return docs.filter((d) => !d.disposedBy || !d.disposalBasis).map((d) => doc(d, "Disposal not authorized or not recorded with basis."));
  },
  "RT-13": async (ctx) => {
    const docs = await ctx.db.document.findMany({ where: { disposedAt: { not: null }, legalHold: true } });
 return docs.map((d) => doc(d, "Disposal of information under legal hold — structural contradiction."));
  },

  // ── Distribution (§11.8) ──
  "IS-17": async (ctx) => {
    const rules = await ctx.db.distributionRule.findMany();
    const typesInUse = await ctx.db.document.findMany({ where: { isPlaceholder: false }, select: { deliverableType: true }, distinct: ["deliverableType"] });
    const covered = new Set(rules.map((r) => r.deliverableType));
    const missing = typesInUse.filter((t) => !covered.has(t.deliverableType));
 return missing.length ? [cfg(`Distribution rules not published for deliverable types in use: ${missing.map((m) => m.deliverableType).join(", ")}.`)]: [];
  },

  // ── Spine (Annex F) ── automation reports synchronization; it decides nothing (F.6).
  "CF-21": async (ctx) => {
    const { effectiveSpine } = await import("../spine");
    const { rows } = await effectiveSpine(ctx);
    return rows.filter((r) => r.state === "GAP" && r.kind === "CHECK").map((r) => spine(r.ruleId, `${r.ruleId} ${r.ruleTitle} has no linked Check (F.5 rule 1).`));
  },
  "CF-22": async (ctx) => {
    const { effectiveSpine } = await import("../spine");
    const { rows } = await effectiveSpine(ctx);
    return rows
      .filter((r) => r.state === "REVIEW_REQUIRED" && r.why && /changed/.test(r.why))
      .map((r) => spine(r.key, `${r.ruleId} ↔ ${r.kind === "CHECK" ? `DEF-${r.target}` : r.target || "Route"}: ${r.why}; impact review open (F.5 rule 3).`));
  },
  "CF-23": async (ctx) => {
    const { STANDARD_VERSION } = await import("../standard");
    const baselines = await ctx.db.spineBaseline.findMany({ orderBy: { releasedAt: "desc" } });
    if (!baselines.length) return "NOT_CHECKED" as const;
    return baselines
      .filter((b) => b.unresolved > 0 || b.standardVersion !== STANDARD_VERSION)
      .map((b) => spine(`baseline:${b.label}`, b.unresolved > 0
        ? `Baseline ${b.label} released with ${b.unresolved} Gap or Review required link(s) (F.5 rule 5).`
        : `Baseline ${b.label} was released against Standard v${b.standardVersion}; v${STANDARD_VERSION} is current.`));
  },
};

function safeName(relPath: string): string {
  return relPath.split("__").pop() ?? relPath;
}

/** Checks whose evidence is published configuration — runnable when the set exists. */
export const CONFIG_CHECKS: Record<string, (ctx: Ctx) => Promise<RunResult>> = {
  "IO-09": async (ctx) => {
    const set = ctx.allSets.get("ISSUE_CODES");
 return set && set.size > 0 ? []: [cfg("Organization issue codes not mapped to the defined reasons.")];
  },
  "AP-12": async (ctx) => "NOT_CHECKED" as const,
};
