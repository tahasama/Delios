// Phase 3 exit criterion: one upload → diff → approve route governs every
// controlled configuration, and nothing reaches the live tables without it.
//
// Runs against a throwaway organization so the seeded fixtures are untouched.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { publishReferenceConfiguration } from "../src/lib/bootstrap";
import { handlerFor, summariseDiff, allHandlers, canDecide, canSubmit } from "../src/lib/controlled/registry";
import "../src/lib/controlled/handlers";
import { loadActor, can } from "../src/lib/permissions";
import { toCsv, parseCsv } from "../src/lib/csv";
import { departmentRows, departmentSheet, senderRows, senderSheet, clearance } from "../src/lib/requirements-process";

const db = new PrismaClient();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const slug = `verify-${Date.now()}`;
  const org = await db.organization.create({ data: { slug, name: "Verification Org" } });
  const project = await db.project.create({ data: { orgId: org.id, code: "VP1", name: "Verification project" } });
  const t = tenantFor(org.id, project.id);
  await publishReferenceConfiguration(db, org.id);

  try {
    console.log("\nEvery kind implements the same contract\n");
    for (const h of allHandlers()) {
      check(`${h.kind} declares columns, sample and clause`,
        h.columns.length > 0 && h.sample.length === h.columns.length && !!h.clause,
        `${h.columns.length} columns`);
    }

    // ── Distribution / permission matrix ────────────────────────────────────
    console.log("\nPermission matrix (§11.8)\n");
    const matrix = handlerFor("DISTRIBUTION_MATRIX")!;

    const before = (await matrix.current(t, "default")) as unknown[];
    check("reads the matrix already in force", before.length > 0, `${before.length} rule(s)`);

    const good = toCsv([
      matrix.columns,
      ["ADMIN", "", "", "", "", "", "READ|CREATE|REVISE|REVIEW|APPROVE|TRANSMIT|RECEIVE|ACCEPT|CONTROL|CONFIGURE", "Unchanged"],
      ["CONTROLLER", "", "", "", "", "", "READ|CONTROL|TRANSMIT|RECEIVE|ACCEPT", "Narrowed: no longer creates"],
      ["VIEWER", "", "", "EL", "", "", "READ", "Electrical only now"],
    ]);
    const parsed = await matrix.parse(t, parseCsv(good), "default");
    check("a well-formed matrix parses", parsed.ok, parsed.ok ? `${parsed.rowCount} rows` : "");
    if (!parsed.ok) throw new Error("matrix parse failed");

    const diff = matrix.diff(before, parsed.payload);
    check("the diff describes the change before anything is applied", diff.length > 0, summariseDiff(diff));
    check("it reports removals", diff.some((l) => l.change === "REMOVED"));

    // Nothing has changed yet — the diff is a description, not an action.
    const midway = (await matrix.current(t, "default")) as unknown[];
    check("computing a diff changes nothing", midway.length === before.length);

    await matrix.apply(t, parsed.payload, "default", "Rev 01");
    const after = (await matrix.current(t, "default")) as unknown[];
    check("applying replaces the matrix wholesale", after.length === 3, `${after.length} rule(s)`);

    const viewerFn = await db.function.findFirstOrThrow({ where: { orgId: org.id, code: "VIEWER" } });
    const viewer = await loadActor(t, viewerFn.id);
    check("the Viewer now reads electrical", can(viewer, "READ", { discipline: "EL", confidentiality: "INTERNAL" }));
    check("the Viewer no longer reads civil", !can(viewer, "READ", { discipline: "CI", confidentiality: "INTERNAL" }));

    const controllerFn = await db.function.findFirstOrThrow({ where: { orgId: org.id, code: "CONTROLLER" } });
    const controller = await loadActor(t, controllerFn.id);
    check("Document Control lost Create, as the file said", !can(controller, "CREATE", { discipline: "EL" }));
    check("Document Control kept Control", can(controller, "CONTROL", { discipline: "EL" }));

    // The template we hand people has to be a file they can actually upload.
    console.log("\nEvery blank template is itself valid\n");
    // The requirements template names a scheduled action and a document; give
    // it the two it names, and take them away again afterwards.
    const fxAction = await t.db.action.create({ data: { projectId: project.id, code: "A00001", name: "Fixture", departments: "EL" } });
    const fxDoc = await t.db.document.create({ data: { projectId: project.id, docNumber: "P1001-50-EL-DSW-09102", title: "Fixture", deliverableType: "ENG", docType: "DSW", discipline: "EL", createdById: "verify", createdByName: "verify" } });
    for (const h of allHandlers()) {
      const tpl = parseCsv(toCsv([h.columns, h.sample, ...(h.extraSamples ?? [])]));
      const r = await h.parse(t, tpl, h.kind === "VALUE_SET" ? "DISCIPLINES" : "default");
      check(`${h.kind} blank template parses`, r.ok, r.ok ? "" : r.issues[0]?.message.slice(0, 70));
    }
    await t.db.document.delete({ where: { id: fxDoc.id } });
    await t.db.action.delete({ where: { id: fxAction.id } });

    console.log("\nThe matrix refuses changes that would break it\n");
    const lockout = toCsv([matrix.columns, ["VIEWER", "", "", "", "", "", "READ", "nobody configures"]]);
    const lockoutResult = await matrix.parse(t, parseCsv(lockout), "default");
    check("refuses a matrix with nobody holding Configure", !lockoutResult.ok,
      lockoutResult.ok ? "" : lockoutResult.issues[0]?.message.slice(0, 60));

    const unknown = toCsv([matrix.columns, ["NOT_A_FUNCTION", "", "", "", "", "", "READ", ""], ["ADMIN", "", "", "", "", "", "CONFIGURE", ""]]);
    const unknownResult = await matrix.parse(t, parseCsv(unknown), "default");
    check("refuses an unknown function code", !unknownResult.ok);

    const badVerb = toCsv([matrix.columns, ["ADMIN", "", "", "", "", "", "READ|TELEPORT", ""]]);
    const badVerbResult = await matrix.parse(t, parseCsv(badVerb), "default");
    check("refuses an unknown verb", !badVerbResult.ok);
    check("a refusal names the line", !badVerbResult.ok && badVerbResult.issues[0].line === 2);

    // ── Schedule ────────────────────────────────────────────────────────────
    console.log("\nSchedule (§14.2, §14.6)\n");
    const schedule = handlerFor("SCHEDULE")!;

    const s1 = toCsv([
      schedule.columns,
      ["P6-1000", "", "Foundation pour", "Raft under the clarifier", "2026-10-01", "Civil"],
      ["P6-1010", "", "Switchroom energisation", "", "2026-11-01", "Electrical"],
    ]);
    const p1 = await schedule.parse(t, parseCsv(s1), "default");
    check("a schedule without codes parses", p1.ok, p1.ok ? `${p1.rowCount} activities` : "");
    if (!p1.ok) throw new Error("schedule parse failed");
    await schedule.apply(t, p1.payload, "default", "Rev 01");

    const actions = await t.db.action.findMany({ orderBy: { code: "asc" } });
    check("the system assigned A-codes (§14.2)", actions.length === 2 && actions.every((a) => /^A\d{5}$/.test(a.code)), actions.map((a) => a.code).join(", "));
    check("the action takes the date the schedule gives", actions[0].scheduledDate?.toISOString().slice(0, 10) === "2026-10-01");
    check("the activity keeps its description", actions[0].description === "Raft under the clarifier");
    check("the schedule carries no departments", actions.every((a) => !a.departments));

    // ── Departments per activity (the project manager's list) ─────────────
    console.log("\nDepartments per activity\n");
    const deptList = handlerFor("ACTION_DEPARTMENTS")!;
    const exported = await deptList.exportRows!(t, "default");
    check("the list downloads pre-filled with every activity", exported.length === 2 && exported[0][0] === actions[0].code, `${exported.length} rows`);
    const tagFile = toCsv([deptList.columns, [actions[0].code, "", "", "", "", "CI"], [actions[1].code, "", "", "", "", "EL, ME"]]);
    const tp = await deptList.parse(t, parseCsv(tagFile), "default");
    check("a filled list parses", tp.ok, tp.ok ? "" : tp.issues[0]?.message);
    if (!tp.ok) throw new Error("departments parse failed");
    await deptList.apply(t, tp.payload, "default", "Rev 01");
    const tagged = await t.db.action.findMany({ orderBy: { code: "asc" } });
    check("activities are tagged", tagged[0].departments === "CI" && tagged[1].departments === "EL,ME", tagged.map((a) => a.departments).join(" / "));
    check("an activity with no department is refused (obligatory)", !(await deptList.parse(t, parseCsv(toCsv([deptList.columns, [actions[0].code, "", "", "", "", ""]])), "default")).ok);
    check("an unknown department is refused", !(await deptList.parse(t, parseCsv(toCsv([deptList.columns, [actions[0].code, "", "", "", "", "QQ"]])), "default")).ok);
    check("the project manager approves his own list",
      canDecide({ state: "SUBMITTED", submittedById: "pm", userId: "pm", mayConfigure: false, mayControl: true, ownerApproves: deptList.ownerApproves }).ok);
    check("…while other lists keep four eyes",
      !canDecide({ state: "SUBMITTED", submittedById: "u", userId: "u", mayConfigure: true, ownerApproves: handlerFor("SCHEDULE")!.ownerApproves }).ok);

    // A requirement on the default rule, so the re-dating can be observed.
    const doc = await t.db.document.create({
      data: {
        projectId: project.id, docNumber: "VP1-CI-DWG-0001", title: "Foundation layout",
        deliverableType: "ENG", docType: "DWG", discipline: "CI",
        createdById: "verify", createdByName: "verify",
      },
    });
    await t.db.baselineEntry.create({
      data: {
        projectId: project.id, actionId: actions[0].id, documentId: doc.id,
        requiredStatus: "IFC", requiredBy: new Date("2026-09-24T00:00:00.000Z"),
      },
    });

    // The same activities again, still without codes, one a month later.
    const s2 = toCsv([
      schedule.columns,
      ["P6-1000", "", "Foundation pour", "Raft under the clarifier", "2026-11-02", "Civil"],
      ["P6-1010", "", "Switchroom energisation", "", "2026-11-01", "Electrical"],
    ]);
    const p2 = await schedule.parse(t, parseCsv(s2), "default");
    if (!p2.ok) throw new Error("second schedule parse failed");

    const scheduleDiff = schedule.diff(await schedule.current(t, "default"), p2.payload);
    check("the diff lines activities up by Activity Code", scheduleDiff.filter((l) => l.change === "ADDED").length === 0, summariseDiff(scheduleDiff));
    check("…and shows only the date that moved", scheduleDiff.filter((l) => l.change === "CHANGED").length === 1);

    await schedule.apply(t, p2.payload, "default", "Rev 02");
    check("no new codes for the same activities", (await t.db.action.count()) === 2);
    const moved = await t.db.action.findFirstOrThrow({ where: { scheduleRef: "P6-1000" } });
    check("the action moved and kept its code", moved.scheduledDate?.toISOString().slice(0, 10) === "2026-11-02" && moved.code === actions[0].code);

    const entry = await t.db.baselineEntry.findFirstOrThrow({ where: { documentId: doc.id } });
    check("its needed-by date moved with it: seven days before",
      entry.requiredBy.toISOString().slice(0, 10) === "2026-10-26",
      `activity 2026-11-02 less seven days = ${entry.requiredBy.toISOString().slice(0, 10)}`);

    check("the applied schedule is recorded as a live version",
      (await t.db.scheduleVersion.count({ where: { status: "PUBLISHED" } })) === 1);
    check("the previous one was superseded, not deleted",
      (await t.db.scheduleVersion.count({ where: { status: "SUPERSEDED" } })) === 1);

    console.log("\nThe schedule refuses what it cannot reconcile\n");
    const foreign = toCsv([schedule.columns, ["P6-2000", "VA-001", "One", "", "2026-10-01", ""]]);
    check("refuses a code the system did not issue", !(await schedule.parse(t, parseCsv(foreign), "default")).ok);
    const dupCode = toCsv([schedule.columns, ["P6-1", actions[0].code, "One", "", "2026-10-01", ""], ["P6-2", actions[0].code, "Two", "", "2026-10-02", ""]]);
    check("refuses a code used twice (§14.2)", !(await schedule.parse(t, parseCsv(dupCode), "default")).ok);
    const badDate = toCsv([schedule.columns, ["P6-4", "", "One", "", "01/10/2026", ""]]);
    check("refuses a date that is not YYYY-MM-DD", !(await schedule.parse(t, parseCsv(badDate), "default")).ok);
    const noDate = toCsv([schedule.columns, ["P6-5", "", "One", "", "", ""]]);
    check("refuses an activity with no date at all", !(await schedule.parse(t, parseCsv(noDate), "default")).ok);

    // The scheduler's round trip: download what is in force, upload it back.
    const inForce = (await schedule.current(t, "default")) as { externalId: string; actionCode: string; name: string; description: string | null; date: string | null; responsibleParty: string | null }[];
    const roundTrip = toCsv([schedule.columns, ...inForce.map((a) => [a.externalId, a.actionCode, a.name, a.description ?? "", a.date ?? "", a.responsibleParty ?? ""])]);
    const rt = await schedule.parse(t, parseCsv(roundTrip), "default");
    check("what is in force uploads back as it is", rt.ok && schedule.diff(inForce, rt.payload).every((l) => l.change === "UNCHANGED"), rt.ok ? "" : rt.issues[0]?.message);

    // ── Document requirements ────────────────────────────────────────────────
    console.log("\nDocument requirements (§14.1, §14.3)\n");
    const reqs = handlerFor("DOCUMENT_REQUIREMENTS")!;
    const civil = await t.db.action.findFirstOrThrow({ where: { scheduleRef: "P6-1000" } });   // CI, 2026-11-02
    const electrical = await t.db.action.findFirstOrThrow({ where: { scheduleRef: "P6-1010" } }); // EL
    const untagged = await t.db.action.create({ data: { projectId: project.id, code: "A09999", name: "Not tagged yet", scheduledDate: new Date("2026-12-01") } });
    // Project codes and sub-projects are the project's own lists; a fresh
    // organization has none, so give this one a value of each.
    for (const [key, code] of [["PROJECT_CODES", "VP1"], ["SUBPROJECTS", "01"]] as const) {
      if (!(await t.db.configSet.findFirst({ where: { key } }))) await t.db.configSet.create({ data: { orgId: org.id, key, title: key } as never });
      if (!(await t.db.configValue.findFirst({ where: { setKey: key, status: "ACTIVE" } }))) await t.db.configValue.create({ data: { orgId: org.id, setKey: key, code, label: code, status: "ACTIVE", sort: 0 } });
    }
    const firstOf = async (key: string) => (await t.db.configValue.findFirstOrThrow({ where: { setKey: key, status: "ACTIVE" } })).code;
    const [pc, sp, dt] = await Promise.all([firstOf("PROJECT_CODES"), firstOf("SUBPROJECTS"), firstOf("DOCUMENT_TYPES")]);

    const r1 = toCsv([
      reqs.columns,
      ["CI", civil.code, "", "", "", "VP1-CI-DWG-0001", "CI", "", "", "", "AFC", "APPROVER", "TK-201", "", "", ""],
      ["CI", civil.code, "", "", "", "Pour sequence method statement", "CI", dt, "", "2026-10-15", "IFC", "REVIEWER", "TK-201", pc, sp, ""],
    ]);
    const q1 = await reqs.parse(t, parseCsv(r1), "default");
    check("a requirements list parses", q1.ok, q1.ok ? `${q1.rowCount} rows` : q1.issues[0]?.message);
    if (!q1.ok) throw new Error("requirements parse failed");
    await reqs.apply(t, q1.payload, "default", "Rev 01");
    const listed = await t.db.baselineEntry.findMany({ where: { actionId: civil.id }, include: { document: true } });
    check("a new document became a numbered placeholder", listed.some((e) => e.document.isPlaceholder && e.document.title === "Pour sequence method statement"));
    const byRule = listed.find((e) => e.document.docNumber === "VP1-CI-DWG-0001")!;
    check("needed-by defaults to seven days before the activity", byRule.requiredBy.toISOString().slice(0, 10) === "2026-10-26" && !byRule.manualDate, byRule.requiredBy.toISOString().slice(0, 10));
    const fixed = listed.find((e) => e.manualDate);
    check("a given date is kept as given", fixed?.requiredBy.toISOString().slice(0, 10) === "2026-10-15");
    check("who submits and who approves are recorded", byRule.approvedBy === "APPROVER" && byRule.department === "CI");

    const noTag = toCsv([reqs.columns, ["CI", untagged.code, "", "", "", "VP1-CI-DWG-0001", "CI", "", "", "", "AFC", "APPROVER", "TK-201", "", "", ""]]);
    const noTagResult = await reqs.parse(t, parseCsv(noTag), "default");
    check("refuses an action the project manager has not tagged", !noTagResult.ok && /no departments/.test(noTagResult.issues[0].message));
    const wrongDept = toCsv([reqs.columns, ["CI", electrical.code, "", "", "", "VP1-CI-DWG-0001", "CI", "", "", "", "AFC", "APPROVER", "TK-201", "", "", ""]]);
    check("refuses a department the action is not tagged with", !(await reqs.parse(t, parseCsv(wrongDept), "default")).ok);

    const noAsset = toCsv([reqs.columns, ["CI", civil.code, "", "", "", "VP1-CI-DWG-0001", "CI", "", "", "", "AFC", "APPROVER", "", "", "", ""]]);
    const noAssetResult = await reqs.parse(t, parseCsv(noAsset), "default");
    check("a drawing must say which equipment or material it is about", !noAssetResult.ok && /Equipment or material/.test(noAssetResult.issues[0].message), noAssetResult.ok ? "accepted" : noAssetResult.issues[0].message);
    check("the tag became a piece of equipment in the register", !!(await t.db.assetItem.findFirst({ where: { code: "TK-201" } })));

    // The department lists only one of its two documents now.
    const r2 = toCsv([reqs.columns, ["CI", civil.code, "", "", "", "VP1-CI-DWG-0001", "CI", "", "", "", "AFC", "APPROVER", "TK-201", "", "", ""]]);
    const q2 = await reqs.parse(t, parseCsv(r2), "default");
    if (!q2.ok) throw new Error("second requirements parse failed");
    await reqs.apply(t, q2.payload, "default", "Rev 02");
    check("what a department no longer lists is no longer required", (await t.db.baselineEntry.count({ where: { actionId: civil.id } })) === 1);

    // The schedule moves again; the rule-based date follows, one week later.
    const s3 = toCsv([schedule.columns, ["P6-1000", "", "Foundation pour", "Raft under the clarifier", "2026-11-09", "Civil"], ["P6-1010", "", "Switchroom energisation", "", "2026-11-01", "Electrical"]]);
    const p3 = await schedule.parse(t, parseCsv(s3), "default");
    if (!p3.ok) throw new Error("third schedule parse failed");
    await schedule.apply(t, p3.payload, "default", "Rev 03");
    const followed = await t.db.baselineEntry.findFirstOrThrow({ where: { actionId: civil.id } });
    check("a schedule update moves the needed-by date", followed.requiredBy.toISOString().slice(0, 10) === "2026-11-02", followed.requiredBy.toISOString().slice(0, 10));

    // ── The process around the list ─────────────────────────────────────────
    console.log("\nFrom schedule to safe activity\n");
    const asked = await departmentRows(t);
    check("every tagged department is there to be asked", ["CI", "EL", "ME"].every((d) => asked.some((r) => r.department === d)), asked.map((r) => r.department).join(", "));
    check("nobody has been asked yet", asked.every((r) => r.state === "NOT_ISSUED" && r.notIssued.length > 0));
    for (const r of asked) {
      await t.db.requirementCall.create({ data: { projectId: project.id, department: r.department, actionCodes: r.notIssued.join(","), dueAt: new Date(Date.now() - 86_400_000), issuedById: "dc", issuedByName: "Document Control" } });
    }
    const late = await departmentRows(t);
    check("a call past its date is overdue", late.every((r) => r.state === "OVERDUE"));
    check("…and covers what it asked about", late.every((r) => r.notIssued.length === 0));

    const sheet = await departmentSheet(t, "CI");
    const back = await reqs.parse(t, sheet, "default");
    check("a department sheet uploads back unchanged", back.ok && reqs.diff(await reqs.current(t, "default"), back.payload).every((l) => l.change === "UNCHANGED"), back.ok ? "" : back.issues[0]?.message);
    const elSheet = await departmentSheet(t, "EL");
    check("a department with nothing listed still gets room to write",
      elSheet.length === 6 && elSheet[1][0] === "EL" && elSheet[1][1] === electrical.code && !elSheet[1][5],
      `${elSheet.length - 1} lines under one activity`);
    check("…and a sheet left empty uploads as nothing", !(await reqs.parse(t, elSheet, "default")).ok);

    if (!back.ok) throw new Error("sheet round trip failed");
    await reqs.apply(t, back.payload, "default", "Rev 03");
    const answered = await departmentRows(t);
    check("the approved list answers the call of the department it carries", answered.find((r) => r.department === "CI")?.state === "ANSWERED");
    check("…and only that one", answered.find((r) => r.department === "EL")?.state === "OVERDUE");

    const senders = await senderRows(t);
    check("each sender is listed with what it delivers", senders.length === 1 && senders[0].sender === "DEPT:CI" && senders[0].documents === 1, senders.map((x) => `${x.sender}:${x.documents}`).join(", "));
    check("…not yet issued", senders[0].lastIssue === null && senders[0].changedSinceIssue === 1);
    await t.db.senderIssue.create({ data: { projectId: project.id, sender: "DEPT:CI", entryCount: 1, issuedById: "dc", issuedByName: "Document Control" } });
    check("once issued, nothing is outstanding", (await senderRows(t))[0].changedSinceIssue === 0);
    const deliver = await senderSheet(t, "DEPT:CI");
    check("the sender's list gives submit-by and the end of the review window", deliver[1][4] === "2026-11-02" && deliver[1][5] === "2026-11-09", deliver[1]?.slice(4, 6).join(" → "));

    const both = await t.db.action.findFirstOrThrow({ where: { id: electrical.id }, include: { confirmations: true } });
    check("an activity is not cleared before its departments confirm", !clearance(both).cleared);
    await t.db.readinessConfirmation.create({ data: { projectId: project.id, actionId: both.id, department: "EL", available: true, confirmedById: "el", confirmedByName: "EL rep" } });
    await t.db.readinessConfirmation.create({ data: { projectId: project.id, actionId: both.id, department: "ME", available: false, note: "Datasheet late", confirmedById: "me", confirmedByName: "ME rep" } });
    const half = clearance(await t.db.action.findFirstOrThrow({ where: { id: electrical.id }, include: { confirmations: true } }));
    check("a department short holds the activity", !half.cleared && half.short.includes("ME"));
    await t.db.readinessConfirmation.update({ where: { actionId_department: { actionId: both.id, department: "ME" } }, data: { available: true, note: null } });
    check("cleared when every department has confirmed", clearance(await t.db.action.findFirstOrThrow({ where: { id: electrical.id }, include: { confirmations: true } })).cleared);

    // ── Value set ───────────────────────────────────────────────────────────
    console.log("\nValue set (§4.7 — retire, never delete)\n");
    const valueSet = handlerFor("VALUE_SET")!;
    const disciplinesBefore = (await valueSet.current(t, "DISCIPLINES")) as { code: string; status: string }[];
    check("reads the published set", disciplinesBefore.length > 0, `${disciplinesBefore.length} values`);

    // Upload a short list: one existing, one new, and everything else absent.
    const vs = toCsv([valueSet.columns, ["EL", "Electrical (renamed)", "ACTIVE", "1", ""], ["ZZ", "Brand new discipline", "ACTIVE", "2", ""]]);
    const vp = await valueSet.parse(t, parseCsv(vs), "DISCIPLINES");
    check("the value set parses", vp.ok);
    if (!vp.ok) throw new Error("value set parse failed");

    const vsDiff = valueSet.diff(disciplinesBefore, vp.payload);
    check("absent values are shown as retired, not removed",
      vsDiff.every((l) => l.change !== "REMOVED") && vsDiff.some((l) => (l.detail ?? "").includes("retired")));

    await valueSet.apply(t, vp.payload, "DISCIPLINES", "Rev 01");
    const disciplinesAfter = (await valueSet.current(t, "DISCIPLINES")) as { code: string; label: string; status: string }[];
    check("nothing was deleted", disciplinesAfter.length >= disciplinesBefore.length,
      `${disciplinesBefore.length} → ${disciplinesAfter.length}`);
    check("the renamed value took its new label",
      disciplinesAfter.find((v) => v.code === "EL")?.label === "Electrical (renamed)");
    check("the new value is active", disciplinesAfter.find((v) => v.code === "ZZ")?.status === "ACTIVE");
    check("an omitted value was retired",
      disciplinesAfter.find((v) => v.code === "CI")?.status === "RETIRED");

    const badJson = toCsv([valueSet.columns, ["AA", "Label", "ACTIVE", "1", "{not json"]]);
    check("refuses malformed properties", !(await valueSet.parse(t, parseCsv(badJson), "DISCIPLINES")).ok);

    // ── The state machine ───────────────────────────────────────────────────
    console.log("\nNothing reaches the live tables without a decision\n");
    const me = "user-a";
    const someoneElse = "user-b";

    check("a draft cannot be decided",
      !canDecide({ state: "DRAFT", submittedById: me, userId: someoneElse, mayConfigure: true }).ok);
    check("an approved version cannot be decided again",
      !canDecide({ state: "APPROVED", submittedById: me, userId: someoneElse, mayConfigure: true }).ok);
    check("a rejected version cannot be revived",
      !canDecide({ state: "REJECTED", submittedById: me, userId: someoneElse, mayConfigure: true }).ok);
    check("without Configure, no decision",
      !canDecide({ state: "SUBMITTED", submittedById: me, userId: someoneElse, mayConfigure: false }).ok);

    const selfApproval = canDecide({ state: "SUBMITTED", submittedById: me, userId: me, mayConfigure: true });
    check("the submitter cannot approve their own change (§8.3)", !selfApproval.ok,
      selfApproval.ok ? "" : selfApproval.error);
    check("someone else can",
      canDecide({ state: "SUBMITTED", submittedById: me, userId: someoneElse, mayConfigure: true }).ok);

    check("only a draft can be submitted", !canSubmit({ state: "SUBMITTED", mayChange: true }).ok);
    check("submitting needs Configure or Control", !canSubmit({ state: "DRAFT", mayChange: false }).ok);
    check("a draft with authority submits", canSubmit({ state: "DRAFT", mayChange: true }).ok);

    console.log(failures === 0 ? "\nAll controlled-configuration checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  } finally {
    // Explicit order: not every relation cascades (an Action will not delete
    // out from under a BaselineEntry, which is correct — a project is archived
    // in real use, never deleted).
    const p = { projectId: project.id };
    await db.requirementCall.deleteMany({ where: p });
    await db.senderIssue.deleteMany({ where: p });
    await db.readinessConfirmation.deleteMany({ where: p });
    await db.baselineEntry.deleteMany({ where: p });
    await db.scheduleActivity.deleteMany({ where: p });
    await db.scheduleVersion.deleteMany({ where: p });
    await db.action.deleteMany({ where: p });
    await db.revision.deleteMany({ where: p });
    await db.document.deleteMany({ where: p });
    await db.auditEvent.deleteMany({ where: p });
    await db.projectMembership.deleteMany({ where: p });
    await db.permissionRule.deleteMany({ where: { orgId: org.id } });
    await db.function.deleteMany({ where: { orgId: org.id } });
    await db.project.deleteMany({ where: { orgId: org.id } });
    const schemes = await db.scheme.findMany({ where: { orgId: org.id }, select: { id: true } });
    await db.schemeField.deleteMany({ where: { schemeId: { in: schemes.map((x) => x.id) } } });
    await db.scheme.deleteMany({ where: { orgId: org.id } });
    await db.schemeRouting.deleteMany({ where: { orgId: org.id } });
    await db.configValue.deleteMany({ where: { orgId: org.id } });
    await db.configSet.deleteMany({ where: { orgId: org.id } });
    await db.user.deleteMany({ where: { orgId: org.id } });
    await db.party.deleteMany({ where: { orgId: org.id } });
    await db.organization.delete({ where: { id: org.id } });
  }

  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
