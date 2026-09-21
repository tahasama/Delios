/**
 * Optional import of an organization's private numbering workbook.
 *   npm run import-workbook
 * Reads prisma/seed-data/numbering.json (extracted from
 * Standard-Numbering-Config.xlsx) and merges it into the published sets,
 * schemes and routing. Nothing is deleted — codes are added or reactivated.
 */
import type { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";

const numbering = JSON.parse(
  fs.readFileSync(path.join(__dirname, "seed-data", "numbering.json"), "utf-8")
) as {
  disciplines: string[][];
  documentTypes: string[][];
  projectCodes: string[][];
  subprojects: string[][];
  supplierCodes: string[][];
  purchaseOrders: string[][];
  schemeRouting: string[][];
};

// Workbook lists carry trailing note rows — a real code is short and space-free.
const cleanRows = (rows: string[][]) =>
  rows.filter((r) => r[0] && r[0].length <= 20 && !r[0].includes(" ") && r[0] !== "Code" && r[1]);

export async function importWorkbook(db: PrismaClient, orgId: string, projectId: string) {
  async function set(key: string, title: string, description: string, values: { code: string; label: string; sort?: number; props?: Record<string, unknown> }[]) {
    await db.configSet.upsert({ where: { orgId_key: { orgId, key } }, update: { title, description }, create: { orgId, key, title, description, version: 1 } });
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const existing = await db.configValue.findFirst({ where: { orgId, setKey: key, code: v.code } });
      if (existing) {
        await db.configValue.update({ where: { id: existing.id }, data: { label: v.label, status: "ACTIVE", props: v.props ? JSON.stringify(v.props) : existing.props } });
      } else {
        await db.configValue.create({ data: { orgId, setKey: key, code: v.code, label: v.label, sort: v.sort ?? i, props: v.props ? JSON.stringify(v.props) : null } });
      }
    }
  }

  const docTypes = cleanRows(numbering.documentTypes)
    .filter((r) => (r[3] ?? "Active") !== "Retired")
    .map((r, i) => ({ code: r[0], label: r[1], sort: i, props: { appliesTo: r[2] ?? "" } }));
  await set("DOCUMENT_TYPES", "Document types", "Published by the organization (workbook: DocumentTypes).", docTypes);

  const disciplines = cleanRows(numbering.disciplines)
    .filter((r) => (r[2] ?? "Active") !== "Retired")
    .map((r, i) => ({ code: r[0], label: r[1], sort: i }));
  await set("DISCIPLINES", "Disciplines", "Organization workbook list.", disciplines);

  const mk = (rows: string[][], key: string, title: string, desc: string) =>
    set(key, title, desc, cleanRows(rows).filter((r) => (r[2] ?? "Active") !== "Retired").map((r, i) => ({ code: r[0], label: r[1] || r[0], sort: i })));
  await mk(numbering.projectCodes, "PROJECT_CODES", "Project codes", "The scope within which numbers are unique (§3.3).");
  await mk(numbering.subprojects, "SUBPROJECTS", "Sub-projects", "Sub-project breakdown (§4.4).");
  await mk(numbering.supplierCodes, "SUPPLIER_CODES", "Supplier / party codes", "Originator codes for external information (§3.3).");

  const pos = new Map<string, string>();
  for (const r of cleanRows(numbering.purchaseOrders)) {
    if ((r[2] ?? "Active") === "Retired" || !r[0]) continue;
    if (!pos.has(r[0])) pos.set(r[0], r[1] || r[0]);
  }
  await set("PURCHASE_ORDERS", "Purchase orders", "Contract / PO codes (§4.4).", [...pos.entries()].map(([code, label], i) => ({ code, label, sort: i })));

  // Workbook schemes (7-field supplier, 5-field non-supplier) replace the neutral field layout
  const schemeDefs = [
    { name: "Supplier", notes: "7 fields — Project·Subproject·Supplier·PO·Discipline·DocType·Sequence (workbook).", fields: [["Project code", "PROJECT_CODES"], ["Subproject", "SUBPROJECTS"], ["Supplier code", "SUPPLIER_CODES"], ["Purchase order", "PURCHASE_ORDERS"], ["Discipline", "DISCIPLINES"], ["Document type", "DOCUMENT_TYPES"], ["Sequence", null, "COUNTER:DIGITS(5)"]] },
    { name: "Non-supplier", notes: "5 fields — Project·Subproject·Discipline·DocType·Sequence (workbook).", fields: [["Project code", "PROJECT_CODES"], ["Subproject", "SUBPROJECTS"], ["Discipline", "DISCIPLINES"], ["Document type", "DOCUMENT_TYPES"], ["Sequence", null, "COUNTER:DIGITS(5)"]] },
    { name: "Internal", notes: "Project · Document type · Discipline · Sequence(4).", fields: [["Project code", "PROJECT_CODES"], ["Document type", "DOCUMENT_TYPES"], ["Discipline", "DISCIPLINES"], ["Sequence", null, "COUNTER:DIGITS(4)"]] },
  ];
  for (const def of schemeDefs) {
    const scheme = await db.scheme.upsert({ where: { orgId_name: { orgId, name: def.name } }, update: { notes: def.notes }, create: { orgId, name: def.name, notes: def.notes, delimiter: "-" } });
    await db.schemeField.deleteMany({ where: { schemeId: scheme.id } });
    for (let i = 0; i < def.fields.length; i++) {
      const [label, setKey, rule] = def.fields[i] as [string, string | null, string | null];
      await db.schemeField.create({ data: { schemeId: scheme.id, position: i + 1, label, valueSetKey: setKey, rule } });
    }
  }
  await db.schemeRouting.deleteMany();
  await db.schemeRouting.createMany({
    data: [
      { orgId, deliverableType: "CTR", schemeName: "Supplier" },
      { orgId, deliverableType: "VND", schemeName: "Supplier" },
      { orgId, deliverableType: "ENG", schemeName: "Non-supplier" },
      { orgId, deliverableType: "TPY", schemeName: "Non-supplier" },
      { orgId, deliverableType: "CLT", schemeName: "Non-supplier" },
    ],
  });
  console.log("· Workbook imported: private types, disciplines, codes, schemes and routing.");
}
