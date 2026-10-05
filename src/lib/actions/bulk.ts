"use server";

import { audit } from "@/lib/audit";
import { requireScope } from "@/lib/scope";
import { parseCsv, toObjects } from "@/lib/csv";
import { allocateNumber, validateNumber } from "@/lib/numbering";
import { getActiveSet } from "@/lib/config";
import { isReadOnly } from "@/lib/auth";
import { retentionFor } from "@/lib/retention";
import { hashPassword, isAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { readSheet, applyChanges } from "@/lib/matrix-read";
import { propFieldsFor } from "@/lib/set-props";
import { registerDocument } from "@/lib/register";

// Bulk in/out — document controllers live in spreadsheets. Templates, preview,
// then execute. No one fills a form per line.

export type BulkRowReport = { line: number; ok: boolean; message: string; wrote?: boolean };
export type BulkResult = { error?: string; ok?: string; rows?: BulkRowReport[]; imported?: number; failed?: number; dryRun?: boolean };

/**
 * Read the upload, whichever of the two shapes it came in.
 *
 * A workbook carries one sheet per deliverable type, and the sheet name is what
 * says who produced the documents on it — so the Producer column that a flat
 * file needs does not exist there, and is filled in from the tab. A single-sheet
 * CSV still works, because fixing forty rows should not need a workbook.
 */
async function readUpload(formData: FormData): Promise<Record<string, string>[] | { error: string }> {
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a file to import." };

  if (/\.xlsx$/i.test(file.name)) {
    const ExcelJS = (await import("exceljs")).default;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await file.arrayBuffer());
    const objects: Record<string, string>[] = [];
    for (const sheet of book.worksheets) {
      if (sheet.state === "veryHidden" || sheet.state === "hidden") continue;
      // The tab is named "<code> — <label>"; the code before the dash is the
      // deliverable type every row on it was produced under.
      const producer = sheet.name.split("—")[0].trim().split(/\s/)[0].toUpperCase();
      // Row 1 is the caption the template writes; row 2 holds the headings.
      const headerRow = sheet.getRow(2);
      const headers: string[] = [];
      headerRow.eachCell({ includeEmpty: true }, (cell, column) => { headers[column] = String(cell.value ?? "").trim(); });
      if (!headers.some((h) => h === "Title")) continue;
      sheet.eachRow({ includeEmpty: false }, (row, index) => {
        if (index <= 2) return;
        const one: Record<string, string> = { Producer: producer };
        let any = false;
        row.eachCell({ includeEmpty: false }, (cell, column) => {
          const key = headers[column];
          if (!key) return;
          const raw = cell.value;
          const text =
            raw instanceof Date ? raw.toISOString().slice(0, 10)
            : raw && typeof raw === "object" && "text" in raw ? String((raw as { text: unknown }).text)
            : raw && typeof raw === "object" && "result" in raw ? String((raw as { result: unknown }).result ?? "")
            : raw == null ? ""
            : String(raw);
          one[key] = text.trim();
          if (one[key]) any = true;
        });
        if (any) objects.push(one);
      });
    }
    if (!objects.length) return { error: "No filled-in rows found in that workbook." };
    return objects;
  }

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

  // The matrix is a grid, not a list of records: its own reader, and only an
  // administrator may apply it, because it says who approves what.
  if (kind === "matrix") return importMatrix(ctx, formData, dryRun);
  if (kind === "sets") return importSets(ctx, formData, dryRun);

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
    const known = new Map((await db.document.findMany({ select: { docNumber: true, id: true } })).map((d) => [d.docNumber, d.id]));
    // What the number is built from cannot be corrected here: the number would
    // then say one thing and the record another, and a number is never rewritten.
    const INSIDE_THE_NUMBER = ["Type", "Discipline", "Project", "SubProject", "Supplier"];
    const CORRECTABLE = ["Title", "Criticality", "Confidentiality", "RetentionClass", "ContractRef", "AssetCode", "PlannedDate", "ReceivedDate"];
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const line = i + 2;
      const errs: string[] = [];
      const number = GET(o, "Document Number");
      if (number) {
        // A row that names a document is a correction to that document.
        if (!known.has(number)) { rows.push({ line, ok: false, message: `${number} is not in the register — leave the number empty to register it instead` }); continue; }
        const locked = INSIDE_THE_NUMBER.filter((f) => GET(o, f));
        if (locked.length) { rows.push({ line, ok: false, message: `${number}: ${locked.join(", ")} ${locked.length === 1 ? "is" : "are"} built into the number and cannot be corrected here. Withdraw it and register it again under the right number.` }); continue; }
        const fields = CORRECTABLE.filter((f) => GET(o, f));
        if (!fields.length) rows.push({ line, ok: false, message: `${number}: nothing to correct — fill one of ${CORRECTABLE.join(", ")}` });
        else { valid++; rows.push({ line, ok: true, message: `Correct ${number}: ${fields.join(", ")}` }); }
        continue;
      }
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
      // A dry run that passes and a real import that fails is worse than no dry
      // run at all: everything the write can refuse is refused here too.
      for (const column of ["ReceivedDate", "PlannedDate"]) {
        const given = GET(o, column);
        if (given && isNaN(new Date(given).getTime())) errs.push(`${column} "${given}" is not a date — use YYYY-MM-DD`);
      }
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
  } else if (kind === "people") {
    // A whole team arrives at once, in a spreadsheet, like everything else here.
    if (!ctx.can("CONFIGURE") && !ctx.can("CONTROL")) return { error: "Adding people needs Configure or Control." };
    const [functions, parties, existing] = await Promise.all([
      db.function.findMany({ where: { active: true }, select: { id: true, name: true, legacyRole: true } }),
      db.party.findMany({ select: { id: true, code: true, name: true } }),
      db.user.findMany({ select: { email: true } }),
    ]);
    const emails = new Set(existing.map((u) => u.email.toLowerCase()));
    const seen = new Set<string>();
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const line = i + 2;
      const name = GET(o, "Name");
      const email = GET(o, "Email").toLowerCase();
      const company = GET(o, "Company");
      const fnName = GET(o, "Function");
      const problems: string[] = [];
      if (!name) problems.push("no name");
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push("the email is not an address");
      if (emails.has(email)) problems.push("someone already uses that email");
      if (seen.has(email)) problems.push("the same email appears twice in this file");
      if (!functions.some((f) => f.name.toLowerCase() === fnName.toLowerCase())) problems.push(`no published function called "${fnName || "(empty)"}"`);
      if (company && !parties.some((x) => x.code.toLowerCase() === company.toLowerCase() || x.name.toLowerCase() === company.toLowerCase())) {
        problems.push(`no party called "${company}"`);
      }
      seen.add(email);
      if (problems.length) rows.push({ line, ok: false, message: problems.join("; ") });
      else { valid++; rows.push({ line, ok: true, message: `${name} <${email}> as ${fnName}${company ? ` at ${company}` : ""}` }); }
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
      if (kind === "deliverables" && GET(o, "Document Number")) {
        // A row naming a document corrects it; only what is not inside the
        // number may change, which validation has already enforced.
        const doc = await db.document.findFirstOrThrow({ where: { docNumber: GET(o, "Document Number") } });
        const map: Record<string, string> = { Title: "title", Criticality: "criticality", Confidentiality: "confidentiality", RetentionClass: "retentionClass", ContractRef: "contractRef", AssetCode: "assetCode", PlannedDate: "plannedDate", ReceivedDate: "receivedDate" };
        const dates = new Set(["plannedDate", "receivedDate"]);
        const data: Record<string, unknown> = {};
        for (const [col, field] of Object.entries(map)) {
          const v = GET(o, col);
          if (!v) continue;
          if (dates.has(field)) {
            const current = (doc as unknown as Record<string, unknown>)[field] as Date | null;
            const next = new Date(v);
            if (current?.toISOString().slice(0, 10) === next.toISOString().slice(0, 10)) continue;
            data[field] = next;
            if (field === "plannedDate" && !doc.latestRevisionId) data.latestPlannedAt = next;
            await audit({ actor: user, action: "METADATA_CHANGE", entityType: "Document", entityId: doc.id, entityLabel: doc.docNumber, field, oldValue: current ? current.toISOString().slice(0, 10) : null, newValue: v, detail: "Bulk deliverable list (4.9)." });
            continue;
          }
          const current = (doc as unknown as Record<string, unknown>)[field];
          if (String(current ?? "") !== v) {
            data[field] = v;
            await audit({ actor: user, action: "METADATA_CHANGE", entityType: "Document", entityId: doc.id, entityLabel: doc.docNumber, field, oldValue: current == null ? null : String(current), newValue: v, detail: "Bulk deliverable list (4.9)." });
          }
        }
        if (Object.keys(data).length) await db.document.update({ where: { id: doc.id }, data });
        done++;
      } else if (kind === "deliverables") {
        // The same act as the form: one implementation, in lib/register.
        const producer = (GET(o, "Producer") || "ENG").toUpperCase();
        await registerDocument(ctx, user, {
          title: GET(o, "Title"),
          deliverableType: producer,
          docType: GET(o, "Type"),
          discipline: GET(o, "Discipline"),
          projectCode: GET(o, "Project"),
          originator: GET(o, "Supplier") || null,
          subProject: GET(o, "SubProject") || null,
          contractRef: GET(o, "PO") || null,
          criticality: GET(o, "Criticality") || null,
          confidentiality: GET(o, "Confidentiality") || null,
          retentionClass: GET(o, "RetentionClass") || null,
          receivedDate: GET(o, "ReceivedDate") ? new Date(GET(o, "ReceivedDate")) : null,
          plannedDate: GET(o, "PlannedDate") ? new Date(GET(o, "PlannedDate")) : null,
          assetCode: GET(o, "AssetCode") || null,
          how: "Registered from a deliverable list.",
        });
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
      } else if (kind === "people") {
        const fn = await db.function.findFirstOrThrow({ where: { name: GET(o, "Function"), active: true } });
        const company = GET(o, "Company");
        const party = company
          ? await db.party.findFirst({ where: { OR: [{ code: company }, { name: company }] } })
          : null;
        // A one-time password, written into the report so whoever imported can
        // hand it over; the person changes it when they first sign in.
        const password = `delios-${Math.random().toString(36).slice(2, 8)}`;
        const created = await db.user.create({
          data: {
            orgId, email: GET(o, "Email").toLowerCase(), name: GET(o, "Name"), role: fn.legacyRole,
            organization: party?.name ?? null, partyId: party?.id ?? null,
            passwordHash: await hashPassword(password), active: true,
          },
        });
        await db.projectMembership.create({
          data: { projectId, userId: created.id, functionId: fn.id, department: GET(o, "Department") || null },
        });
        await audit({ actor: user, action: "USER_CREATED", entityType: "User", entityId: created.email, entityLabel: created.name, newValue: fn.name, detail: `Bulk import of people: added to this project as ${fn.name}.` });
        const report2 = rows.find((r) => r.line === line);
        if (report2) report2.message = `${created.name} added as ${fn.name} \u2014 first password: ${password}`;
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

/**
 * Every published list, from one workbook.
 *
 * A tab is a set, named by its key. A row whose code exists is updated; a code
 * that does not exist is published. A row that is simply absent is left alone —
 * a workbook where somebody edited one tab must not retire everything missing
 * from the other twenty, and retiring stays a deliberate act on the list's page.
 */
async function importSets(ctx: Awaited<ReturnType<typeof requireScope>>, formData: FormData, dryRun: boolean): Promise<BulkResult> {
  const { user, db, orgId } = ctx;
  if (!isAdmin(user)) return { error: "Only an administrator may publish a list." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose the filled-in workbook." };
  if (!/\.xlsx$/i.test(file.name)) return { error: "Published lists come back as the workbook they were downloaded as (.xlsx)." };

  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await file.arrayBuffer());

  const sets = new Map((await db.configSet.findMany({ select: { key: true, title: true } })).map((one) => [one.key, one.title] as const));
  const rows: BulkRowReport[] = [];
  const work: { setKey: string; code: string; label: string; status: string; props: string | null; existingId?: string; line: number }[] = [];
  let line = 0;

  for (const sheet of book.worksheets) {
    const setKey = sheet.name.trim();
    if (!sets.has(setKey)) continue;
    const fields = propFieldsFor(setKey) ?? [];
    const headers: string[] = [];
    sheet.getRow(2).eachCell({ includeEmpty: true }, (cell, column) => { headers[column] = String(cell.value ?? "").trim(); });
    if (headers[1] !== "Code") { rows.push({ line: ++line, ok: false, message: `${setKey}: the heading row is missing — download the workbook again.` }); continue; }

    const existing = new Map(
      (await db.configValue.findMany({ where: { orgId, setKey }, select: { id: true, code: true, label: true, status: true, props: true } }))
        .map((one) => [one.code, one] as const),
    );

    sheet.eachRow({ includeEmpty: false }, (row, index) => {
      if (index <= 2) return;
      const text = (column: number) => {
        const raw = row.getCell(column).value;
        return raw == null ? "" : String(typeof raw === "object" && "text" in raw ? (raw as { text: unknown }).text : raw).trim();
      };
      const code = text(1);
      const label = text(2);
      if (!code && !label) return;
      line++;
      if (!code) { rows.push({ line, ok: false, message: `${setKey}: a row has a label and no code` }); return; }
      if (!label) { rows.push({ line, ok: false, message: `${setKey} ${code}: a value needs a label` }); return; }

      const status = text(3).toUpperCase() === "RETIRED" ? "RETIRED" : "ACTIVE";
      const was = existing.get(code);
      // Start from what the value already holds. A workbook that does not
      // mention a property must not erase it — that is how an upload once wiped
      // what every review verdict does.
      const props: Record<string, unknown> = was?.props ? (() => {
        try { return JSON.parse(was.props) as Record<string, unknown>; } catch { return {}; }
      })() : {};
      fields.forEach((field, offset) => {
        const given = text(offset + 4);
        if (!given) return;
        if (field.type === "choice") {
          // One answer, several stored values — the effect of a verdict sets
          // both whether it proceeds and whether it is resubmitted.
          const picked = field.options.find((one) => one.value === given);
          if (picked) Object.assign(props, picked.sets);
          return;
        }
        props[field.key] =
          field.type === "bool" ? /^(yes|true|1)$/i.test(given)
          : field.type === "int" ? Number(given)
          : given;
      });
      const asJson = Object.keys(props).length ? JSON.stringify(props) : null;

      if (!was) {
        work.push({ setKey, code, label, status, props: asJson, line });
        // Saying the status matters: a value published as retired is in the
        // list but hidden behind the Active filter, which reads as nothing
        // having happened at all.
        rows.push({ line, ok: true, message: `${setKey}: publish ${code} — ${label}${status === "RETIRED" ? " · as RETIRED, so it stays hidden behind the Active filter" : ""}` });
        return;
      }
      const changed = [
        was.label !== label ? "label" : "",
        was.status !== status ? "status" : "",
        (was.props ?? null) !== asJson ? "properties" : "",
      ].filter(Boolean);
      if (!changed.length) return; // unchanged rows are not news
      work.push({ setKey, code, label, status, props: asJson, existingId: was.id, line });
      rows.push({ line, ok: true, message: `${setKey}: ${code} — ${changed.join(", ")} changed${was.status !== status ? ` (now ${status.toLowerCase()})` : ""}` });
    });
  }

  if (!rows.length) return { ok: "Nothing in that workbook differs from what is published.", rows: [], imported: 0, failed: 0, dryRun };
  if (dryRun) {
    return {
      ok: `Dry run: ${work.length} value(s) would change across ${new Set(work.map((w) => w.setKey)).size} list(s). Nothing else in those lists is touched.`,
      rows, imported: 0, failed: rows.filter((r) => !r.ok).length, dryRun: true,
    };
  }

  for (const one of work) {
    if (one.existingId) {
      await db.configValue.update({ where: { id: one.existingId }, data: { label: one.label, status: one.status, props: one.props } });
    } else {
      const count = await db.configValue.count({ where: { orgId, setKey: one.setKey } });
      await db.configValue.create({ data: { orgId, setKey: one.setKey, code: one.code, label: one.label, status: one.status, props: one.props, sort: count } });
    }
  }
  for (const setKey of new Set(work.map((w) => w.setKey))) {
    await db.configSet.update({ where: { orgId_key: { orgId, key: setKey } }, data: { version: { increment: 1 } } });
  }
  await audit({
    actor: user, action: "CONFIG_VALUE_PUBLISHED", entityType: "ConfigSet",
    entityId: [...new Set(work.map((w) => w.setKey))].join(", "),
    detail: `${work.filter((w) => !w.existingId).length} published, ${work.filter((w) => w.existingId).length} updated, from a workbook.`,
  });
  revalidatePath("/", "layout");
  return { ok: `${work.length} value(s) published or updated.`, rows, imported: work.length, failed: rows.filter((r) => !r.ok).length, dryRun: false };
}

/**
 * A filled-in distribution matrix. Dry by default: the report is the change
 * list, one line per cell that differs from what the matrix says today.
 */
async function importMatrix(ctx: Awaited<ReturnType<typeof requireScope>>, formData: FormData, dryRun: boolean): Promise<BulkResult> {
  const { user, db } = ctx;
  if (!isAdmin(user)) return { error: "Only an administrator may change the distribution matrix." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose the filled-in matrix file." };
  const { changes, problems, unchanged } = await readSheet(ctx, await file.text());

  const rows: BulkRowReport[] = [
    ...problems.map((p) => ({ line: p.line, ok: false, message: p.message })),
  ];

  if (dryRun) {
    for (const change of changes) {
      rows.push({
        line: change.line, ok: true,
        message: `${change.functionCode} (${change.functionName}): ${change.from} becomes ${change.to} on ${change.label || "this class"}.`,
      });
    }
    rows.sort((a, b) => a.line - b.line);
    return {
      ok: changes.length
        ? `Dry run: ${changes.length} cell(s) would change, ${unchanged} already agree. Uncheck dry run to apply.`
        : `Dry run: nothing would change — all ${unchanged} cell(s) already agree with the matrix.`,
      rows, imported: 0, failed: problems.length, dryRun: true,
    };
  }

  const applied = await applyChanges(ctx, changes);
  rows.push(...applied.map((one) => ({ line: one.line, ok: one.ok, message: one.message, wrote: one.wrote })));
  rows.sort((a, b) => a.line - b.line);
  const wrote = applied.filter((one) => one.wrote).length;
  const refused = applied.filter((one) => !one.ok).length;

  if (wrote) {
    await audit({
      actor: user,
      action: "MATRIX_IMPORTED",
      entityType: "Project",
      entityId: ctx.projectId,
      entityLabel: ctx.project.code,
      detail: `${wrote} cell(s) changed from a filled-in distribution matrix${refused ? `; ${refused} refused` : ""}.`,
    });
  }
  // The matrix decides what every screen offers, so nothing cached survives it.
  revalidatePath("/", "layout");
  return {
    ok: `${wrote} cell(s) changed.${refused ? ` ${refused} could not be changed here — see the report.` : ""}`,
    rows, imported: wrote, failed: refused + problems.length, dryRun: false,
  };
}

function external(producer: string) {
  return ["CTR", "VND", "TPY", "CLT"].includes(producer);
}
