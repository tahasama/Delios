"use server";

import { audit } from "@/lib/audit";
import { requireScope } from "@/lib/scope";
import { parseCsv, toObjects } from "@/lib/csv";
import { allocateNumber, validateNumber } from "@/lib/numbering";
import { getActiveSet } from "@/lib/config";
import { isReadOnly } from "@/lib/auth";
import { retentionFor } from "@/lib/retention";

// Bulk in/out — document controllers live in spreadsheets. Templates, preview,
// then execute. No one fills a form per line.

export type BulkRowReport = { line: number; ok: boolean; message: string; wrote?: boolean };
export type BulkResult = { error?: string; ok?: string; rows?: BulkRowReport[]; imported?: number; failed?: number; dryRun?: boolean };

async function readUpload(formData: FormData): Promise<Record<string, string>[] | { error: string }> {
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a CSV file to import." };
  const text = await file.text();
  const { objects } = toObjects(parseCsv(text));
  if (!objects.length) return { error: "The file has no data rows (only the header)." };
  return objects;
}

const GET = (o: Record<string, string>, k: string) => (o[k] ?? "").trim();

/**
 * Import a CSV: validates every row, then (unless dry run) writes the valid
 * ones. Returns a per-line report — nothing is half-explained.
 */
export async function importBulkAction(_prev: BulkResult | undefined, formData: FormData): Promise<BulkResult> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot import." };
  const kind = String(formData.get("kind") ?? "");
  const dryRun = formData.get("dryRun") === "on";
  const objects = await readUpload(formData);
  if ("error" in objects) return { error: objects.error };

  const rows: BulkRowReport[] = [];
  let valid = 0;

  if (kind === "deliverables") {
    const [types, disciplines, projects, subs, suppliers, pos, crits, confs, retentions] = await Promise.all([
      getActiveSet("DOCUMENT_TYPES"), getActiveSet("DISCIPLINES"), getActiveSet("PROJECT_CODES"), getActiveSet("SUBPROJECTS"),
      getActiveSet("SUPPLIER_CODES"), getActiveSet("PURCHASE_ORDERS"), getActiveSet("CRITICALITY"), getActiveSet("CONFIDENTIALITY"), getActiveSet("RETENTION_CLASSES"),
    ]);
    const active = (set: { code: string }[], code: string) => set.some((v) => v.code === code);
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const line = i + 2;
      const errs: string[] = [];
      if (!GET(o, "Title")) errs.push("Title missing");
      if (!active(types, GET(o, "Type"))) errs.push(`Type "${GET(o, "Type")}" not published/active`);
      if (!active(disciplines, GET(o, "Discipline"))) errs.push(`Discipline "${GET(o, "Discipline")}" not active`);
      if (!active(projects, GET(o, "Project"))) errs.push(`Project "${GET(o, "Project")}" not active`);
      if (GET(o, "SubProject") && !active(subs, GET(o, "SubProject"))) errs.push(`SubProject "${GET(o, "SubProject")}" not active`);
      if (GET(o, "Supplier") && !active(suppliers, GET(o, "Supplier"))) errs.push(`Supplier "${GET(o, "Supplier")}" not active`);
      if (GET(o, "PO") && !active(pos, GET(o, "PO"))) errs.push(`PO "${GET(o, "PO")}" not active`);
      if (GET(o, "Criticality") && !active(crits, GET(o, "Criticality"))) errs.push(`Criticality "${GET(o, "Criticality")}" not active`);
      if (GET(o, "Confidentiality") && !active(confs, GET(o, "Confidentiality"))) errs.push(`Confidentiality invalid`);
      if (GET(o, "RetentionClass") && !active(retentions, GET(o, "RetentionClass"))) errs.push(`RetentionClass invalid`);
      const producer = (GET(o, "Producer") || "ENG").toUpperCase();
      if (external(producer) && !GET(o, "Supplier")) errs.push("External producer needs a Supplier code");
      if (errs.length) rows.push({ line, ok: false, message: errs.join("; ") });
      else { valid++; rows.push({ line, ok: true, message: `Will create placeholder: ${GET(o, "Producer") || "ENG"}/${GET(o, "Type")}/${GET(o, "Discipline")}` }); }
    }
  } else if (kind === "baseline") {
    const statuses = await getActiveSet("STATUSES");
    const docNumbers = new Set((await db.document.findMany({ select: { docNumber: true } })).map((d) => d.docNumber));
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const line = i + 2;
      const errs: string[] = [];
      if (!GET(o, "Action Code")) errs.push("Action Code missing");
      if (!GET(o, "Document Number")) errs.push("Document Number missing");
      else if (!docNumbers.has(GET(o, "Document Number"))) errs.push(`Document ${GET(o, "Document Number")} is not in the register`);
      if (!GET(o, "Required Status")) errs.push("Required Status missing");
      else if (!statuses.some((s) => s.code === GET(o, "Required Status"))) errs.push(`Status "${GET(o, "Required Status")}" not published`);
      if (!GET(o, "Required By")) errs.push("Required By missing");
      else if (isNaN(new Date(GET(o, "Required By")).getTime())) errs.push("Required By is not a date (use YYYY-MM-DD)");
      if (errs.length) rows.push({ line, ok: false, message: errs.join("; ") });
      else { valid++; rows.push({ line, ok: true, message: `${GET(o, "Document Number")} → ${GET(o, "Required Status")} by ${GET(o, "Required By")}` }); }
    }
  } else if (kind === "metadata") {
    const docs = await db.document.findMany({ select: { docNumber: true, id: true } });
    const byNumber = new Map(docs.map((d) => [d.docNumber, d.id]));
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const line = i + 2;
      const number = GET(o, "Document Number");
      if (!number || !byNumber.has(number)) {
        rows.push({ line, ok: false, message: `Document "${number || "(missing)"}" not in the register` });
        continue;
      }
      const fields = ["Title", "DocType", "Discipline", "Criticality", "Confidentiality", "RetentionClass", "SubProject", "ContractRef"].filter((f) => GET(o, f));
      if (!fields.length) rows.push({ line, ok: false, message: "No fields to update (fill at least one column)" });
      else { valid++; rows.push({ line, ok: true, message: `Update ${number}: ${fields.join(", ")}` }); }
    }
  } else {
    return { error: "Unknown import kind." };
  }

  if (dryRun) {
    return { ok: `Dry run: ${valid} of ${objects.length} rows would import. Uncheck dry run to import.`, rows, imported: 0, failed: rows.filter((r) => !r.ok).length, dryRun: true };
  }

  let done = 0;
  const failures: string[] = [];
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    const line = i + 2;
    const report = rows.find((r) => r.line === line);
    if (report && !report.ok) continue;
    try {
      if (kind === "deliverables") {
        const producer = (GET(o, "Producer") || "ENG").toUpperCase();
        const fieldValues: Record<string, string> = {
          "Project code": GET(o, "Project"), Subproject: GET(o, "SubProject"), "Supplier code": GET(o, "Supplier"),
          "Purchase order": GET(o, "PO"), Discipline: GET(o, "Discipline"), "Document type": GET(o, "Type"),
        };
        const { docNumber } = await allocateNumber(ctx, producer, fieldValues);
        const doc = await db.document.create({
          data: {
            projectId,
            docNumber, title: GET(o, "Title"), deliverableType: producer, docType: GET(o, "Type"), discipline: GET(o, "Discipline"),
            originator: GET(o, "Supplier") || null, subProject: GET(o, "SubProject") || null, contractRef: GET(o, "PO") || null,
            criticality: GET(o, "Criticality") || null, confidentiality: GET(o, "Confidentiality") || "INTERNAL",
            retentionClass: GET(o, "RetentionClass") || (await retentionFor(ctx, GET(o, "Criticality") || null)), state: "PLANNED", isPlaceholder: true,
            createdById: user.id, createdByName: user.name,
            receivedDate: GET(o, "ReceivedDate") ? new Date(GET(o, "ReceivedDate")) : null,
          },
        });
        if (GET(o, "AssetCode")) {
          const asset = await db.assetItem.findFirst({ where: { code: GET(o, "AssetCode") } });
          if (asset) await db.relationship.create({ data: { projectId, kind: "DOC_ASSET", fromType: "Document", fromId: doc.id, toType: "AssetItem", toId: asset.id, createdById: user.id } });
        }
        await audit({ actor: user, action: "REGISTER_ENTRY", entityType: "Document", entityId: doc.id, entityLabel: docNumber, detail: "Bulk import: placeholder created from a deliverable list (16.8)." });
        done++;
      } else if (kind === "baseline") {
        let action = await db.action.findFirst({ where: { code: GET(o, "Action Code") } });
        if (!action) {
          action = await db.action.create({ data: { projectId, code: GET(o, "Action Code"), name: GET(o, "Action Name") || GET(o, "Action Code"), scheduledDate: GET(o, "Action Date") ? new Date(GET(o, "Action Date")) : null } });
          await audit({ actor: user, action: "ACTION_CREATED", entityType: "Action", entityId: action.code, entityLabel: action.code, detail: "Bulk import." });
        }
        const doc = await db.document.findFirstOrThrow({ where: { docNumber: GET(o, "Document Number") } });
        const dup = await db.baselineEntry.findFirst({ where: { actionId: action.id, documentId: doc.id } });
        if (!dup) {
          await db.baselineEntry.create({ data: { projectId, actionId: action.id, documentId: doc.id, requiredStatus: GET(o, "Required Status"), requiredBy: new Date(GET(o, "Required By")), createdByName: user.name } });
          await audit({ actor: user, action: "BASELINE_ENTRY", entityType: "Action", entityId: action.id, entityLabel: action.code, newValue: doc.docNumber + " -> " + GET(o, "Required Status"), detail: "Bulk import (14.3)." });
        }
        done++;
      } else if (kind === "metadata") {
        const doc = await db.document.findFirstOrThrow({ where: { docNumber: GET(o, "Document Number") } });
        const map: Record<string, string> = { Title: "title", DocType: "docType", Discipline: "discipline", Criticality: "criticality", Confidentiality: "confidentiality", RetentionClass: "retentionClass", SubProject: "subProject", ContractRef: "contractRef" };
        const data: Record<string, unknown> = {};
        for (const [col, field] of Object.entries(map)) {
          const v = GET(o, col);
          if (!v) continue;
          const current = (doc as unknown as Record<string, unknown>)[field];
          if (String(current ?? "") !== v) {
            data[field] = v;
            await audit({ actor: user, action: "METADATA_CHANGE", entityType: "Document", entityId: doc.id, entityLabel: doc.docNumber, field, oldValue: current == null ? null : String(current), newValue: v, detail: "Bulk metadata import (4.9)." });
          }
        }
        if (Object.keys(data).length) await db.document.update({ where: { id: doc.id }, data });
        done++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "failed";
      failures.push("line " + line + ": " + msg);
      if (report) { report.ok = false; report.message = "FAILED: " + msg; }
    }
  }
  return {
    ok: "Imported " + done + " of " + objects.length + " rows." + (failures.length ? " " + failures.length + " failed - see the report." : ""),
    rows, imported: done, failed: failures.length, dryRun: false,
  };
}

function external(producer: string) {
  return ["CTR", "VND", "TPY", "CLT"].includes(producer);
}
