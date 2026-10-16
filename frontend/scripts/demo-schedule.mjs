// Fills the demo project through the API, the way people would, following the
// app's own flow: every release says who receives it and is sent in the same
// act; a schedule document, the project manager's disciplines per action, a
// document requirements list, and deliverables released at different times, so
// every state on Schedule & actions shows up (done, late receipt, ready, still
// ahead, at risk, overdue, nothing listed). It also leaves each demo person
// something to do on their Home: a discipline to confirm, a late confirmation,
// a postponement waiting for the planner, a request to add a document to an
// action, a review to decide, a draft.
//
// Needs the backend running with the demo seeded (docs/SESSION-HANDOFF.md §4):
//   node scripts/demo-schedule.mjs                      (API at http://localhost:8080)
//   node scripts/demo-schedule.mjs http://other:8080
//
// Run it once on a fresh demo. Run again, it stops: the schedule already exists.

import { createHash } from "node:crypto";

const API = (process.argv[2] ?? process.env.DELIOS_API_URL ?? "http://localhost:8080").replace(/\/$/, "");
const PASSWORD = "demo1234";

const day = (offset) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One signed-in person: their cookie, and JSON calls made as them. */
async function signIn(email) {
  const response = await fetch(`${API}/api/auth/sign-in`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`${email} could not sign in (${response.status}). Is the demo seeded?`);
  const cookie = response.headers.getSetCookie().map((one) => one.split(";")[0]).join("; ");
  const call = async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method, headers: { Cookie: cookie, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
    return json;
  };
  return { email, get: (path) => call("GET", path), post: (path, body = {}) => call("POST", path, body), put: (path, body) => call("PUT", path, body) };
}

/** A small, valid one-page PDF: what a printed drawing or list stands for here. */
function pdf(title) {
  const text = `BT /F1 18 Tf 72 720 Td (${title.replace(/[()\\]/g, "")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function main() {
  const controller = await signIn("controller@demo.local");
  const engineer = await signIn("engineer@demo.local");
  const approver = await signIn("approver@demo.local");
  const project = (await engineer.get("/api/me")).projects[0].id;
  const p = `/api/projects/${project}`;

  if ((await engineer.get(`${p}/schedule`)).source) {
    console.log("This project already has a schedule; nothing was added.");
    return;
  }

  const register = (who, body) => who.post(`${p}/documents`, body);
  const uploadFile = async (who, documentId, name, bytes, contentType) => {
    const ticket = await who.post(`${p}/documents/${documentId}/uploads`, {
      fileName: name, size: bytes.length, contentType, sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const put = await fetch(ticket.url, { method: ticket.method || "PUT", headers: ticket.headers, body: bytes });
    if (!put.ok) throw new Error(`Storing ${name} failed (${put.status}).`);
    return ticket.fileId;
  };
  /** A revision with its files, once the worker has scanned them. */
  const revise = async (who, documentId, files, changeDescription) => {
    const fileIds = [];
    for (const [name, bytes, type] of files) fileIds.push(await uploadFile(who, documentId, name, bytes, type));
    const revision = await who.post(`${p}/documents/${documentId}/revisions`, { fileIds, changeDescription });
    for (let i = 0; i < 150; i++) {
      const doc = await who.get(`${p}/documents/${documentId}`);
      const now = doc.revisions.find((one) => one.id === revision.id);
      if (now.filesState !== "PROCESSING") return revision.id;
      await sleep(300);
    }
    throw new Error("The worker did not scan the files. Is it running?");
  };
  /**
   * Through review to release, as the app has it: the engineer checks (no comment), the approver approves at IFC and
   * says who receives it, the control function releases — and the release sends it in the same act.
   */
  const toReview = async (revisionId) => {
    const review = await engineer.post(`${p}/revisions/${revisionId}/reviews`, {});
    await engineer.post(`${p}/reviews/${review.id}/answer`, { verdict: "NO_COMMENT" });
    return review;
  };
  const release = async (revisionId) => {
    const review = await toReview(revisionId);
    await approver.post(`${p}/reviews/${review.id}/answer`, { verdict: "C1", status: "IFC", issue: { reason: "EXECUTION", userIds: receivers } });
    await controller.post(`${p}/reviews/${review.id}/release`, {});
  };
  const until = async (label, read, done) => {
    for (let i = 0; i < 200; i++) {
      const value = await read();
      if (done(value)) return value;
      await sleep(300);
    }
    throw new Error(`Timed out waiting for ${label}. Check the worker's log.`);
  };
  const csv = (rows) => Buffer.from(rows.map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(",")).join("\n") + "\n");

  // ── Who answers for which discipline ───────────────────────────────────────
  // Without it nobody can confirm a discipline's documents, or be told it is short.
  const admin = await signIn("admin@demo.local");
  const people = await admin.get("/api/admin/users");
  const answersFor = { "engineer@demo.local": "CI", "approver@demo.local": "ME", "viewer@demo.local": "EL" };
  for (const [email, department] of Object.entries(answersFor)) {
    const person = people.find((one) => one.email === email);
    if (person) await admin.put(`/api/admin/projects/${project}/members`, { userId: person.id, department });
  }
  // Who a released revision is sent to: the site (the viewer receives documents) and the control function.
  const idOf = (email) => people.find((one) => one.email === email)?.id;
  const receivers = ["viewer@demo.local", "controller@demo.local"].map(idOf).filter(Boolean);

  // ── The schedule ───────────────────────────────────────────────────────────
  console.log("Schedule: registering and releasing the programme…");
  const schedule = await register(engineer, { title: "Construction programme", deliverableType: "ENG", docType: "SCH", discipline: "PM", subproject: "00" });
  await controller.put(`${p}/schedule`, { documentId: schedule.id });
  const activities = [
    ["A100", "Excavate inlet works", -40, -38],
    ["A110", "Pour inlet base slab", -21, -20],
    ["A120", "Install inlet screens", -6, -4],
    ["A200", "Erect clarifier formwork", 3, 6],
    ["A210", "Pour clarifier walls", 9, 12],
    ["A300", "Set duty pumps on plinths", 6, 8],
    ["A310", "Energise pump house MCC", 16, 17],
    ["A320", "Commission pump station", 35, 40],
    ["A400", "Hydrotest process pipework", 24, 26],
    ["A500", "Handover of inlet works", 60, 60],
  ];
  const programme = csv([["Activity ID", "Activity Name", "Start", "Finish"],
    ...activities.map(([code, name, start, finish]) => [code, name, day(start), day(finish)])]);
  await release(await revise(engineer, schedule.id, [["Programme.pdf", pdf("Construction programme"), "application/pdf"], ["Programme.csv", programme, "text/csv"]], "First issue of the programme"));
  const read = await until("the schedule to be read", () => engineer.get(`${p}/activities`), (rows) => rows.length === activities.length);
  console.log(`  ${read.length} activities read.`);

  // ── Disciplines per action (DPA) ───────────────────────────────────────────
  console.log("Disciplines per action: the project manager's list…");
  const tags = { A100: "CI", A110: "CI", A120: "ME", A200: "CI, ST", A210: "CI", A300: "ME", A310: "EL", A320: "ME, EL, IN", A400: "PR" };
  const dpa = await register(engineer, { title: "Disciplines per action", deliverableType: "ENG", docType: "DPA", discipline: "PM", subproject: "00" });
  await release(await revise(engineer, dpa.id, [["Disciplines.pdf", pdf("Disciplines per action"), "application/pdf"], ["Disciplines.csv", csv([["Action Code", "Departments"], ...Object.entries(tags)]), "text/csv"]], "Every action tagged"));
  await until("the disciplines to be read", () => engineer.get(`${p}/activities`), (rows) => rows.filter((one) => one.departments.length).length === Object.keys(tags).length);

  // ── The deliverables the actions need ──────────────────────────────────────
  console.log("Deliverables: registering what the actions need…");
  const ours = (title, discipline, docType = "DWG") => register(engineer, { title, deliverableType: "ENG", docType, discipline, subproject: "20" });
  const acme = (title) => register(controller, { title, deliverableType: "SUP", docType: "DAS", discipline: "ME", subproject: "20", originator: "ACME", contractRef: "PO101", receivedDate: day(-30) });
  const docs = {
    excavation: await ours("Inlet works excavation and shoring", "CI"),
    slab: await ours("Inlet base slab reinforcement", "CI"),
    screens: await ours("Inlet screens installation arrangement", "ME"),
    formwork: await ours("Clarifier formwork design", "ST", "CAL"),
    walls: await ours("Clarifier wall reinforcement", "CI"),
    plinths: await ours("Pump plinth details", "CI"),
    pumps: await acme("Duty pump datasheet"),
    mcc: await ours("Pump house MCC single line diagram", "EL"),
    cables: await ours("Pump house cable schedule", "EL", "LST"),
    loops: await ours("Pump station instrument loop diagrams", "IN"),
    pipework: await ours("Process pipework test procedure", "PR", "PRO"),
  };

  // ── Document requirements (RQL) ────────────────────────────────────────────
  console.log("Document requirements: what each discipline needs…");
  const needs = [
    ["CI", "A100", docs.excavation],
    ["CI", "A110", docs.slab],
    ["ME", "A120", docs.screens],
    ["CI", "A200", docs.walls],
    ["ST", "A200", docs.formwork],
    ["CI", "A210", docs.walls],
    ["ME", "A300", docs.pumps],
    ["ME", "A300", docs.plinths],
    ["EL", "A310", docs.mcc],
    ["EL", "A310", docs.cables],
    ["ME", "A320", docs.pumps],
    ["EL", "A320", docs.mcc],
    ["IN", "A320", docs.loops],
    ["PR", "A400", docs.pipework],
  ];
  const rql = await register(engineer, { title: "Document requirements", deliverableType: "ENG", docType: "RQL", discipline: "PM", subproject: "00" });
  const listed = csv([["Department", "Action Code", "Document", "Required Status"], ...needs.map(([dept, code, doc]) => [dept, code, doc.number, "IFC"])]);
  await release(await revise(engineer, rql.id, [["Requirements.pdf", pdf("Document requirements"), "application/pdf"], ["Requirements.csv", listed, "text/csv"]], "Requirements from every discipline"));
  await until("the requirements to be read", () => engineer.get(`${p}/activities`), (rows) => rows.reduce((sum, one) => sum + one.needs, 0) === needs.length);

  // ── Some delivered, some not: every state on the schedule ──────────────────
  // Released now: A100 and A110 had their day already, so they arrive late; A200's formwork, A300's plinths and the
  // cable schedule are in, the rest are not. A320 and A400 are still ahead; A120 is overdue; A500 lists nothing.
  console.log("Releasing some deliverables…");
  for (const doc of [docs.excavation, docs.slab, docs.formwork, docs.walls, docs.plinths, docs.cables]) {
    await release(await revise(engineer, doc.id, [[`${doc.number}.pdf`, pdf(doc.title), "application/pdf"]], "First issue"));
  }

  // By the planner's IDs the programme used; each action also has our own number (A00001…).
  const byCode = Object.fromEntries((await engineer.get(`${p}/activities`)).map((one) => [one.externalId ?? one.code, one.id]));

  // ── What happened around the days ──────────────────────────────────────────
  console.log("Confirmations, a postponement, a notice…");
  // A120's day passed with Mechanical's drawing missing: Mechanical says, late, why the work went ahead without it.
  await approver.post(`${p}/activities/${byCode.A120}/readiness`, {
    department: "ME", available: true,
    note: "Screens set on temporary supports on the site manager's word; the arrangement drawing came after the day.",
  });
  // A400's hydrotest is postponed: the control function writes it down; whoever plans the project is asked to confirm it.
  await controller.post(`${p}/activities/${byCode.A400}/decisions`, {
    // Who decided is a person on the project, of whichever organization, as the form picks them.
    decision: "STOPPED", responsibleName: people.find((one) => one.email === "approver@demo.local")?.name ?? "The approver",
    reason: "Pipe supports are not finished; the hydrotest cannot be held on the day.",
  });
  // A310 is short of Electrical's single line diagram: the control function tells Electrical by hand.
  const a310 = (await engineer.get(`${p}/activities`)).find((one) => one.id === byCode.A310);
  await controller.post(`${p}/notices`, {
    subject: `activity:${byCode.A310}:manual:EL`,
    title: `${a310.code}: Electrical has documents missing`,
    body: "The pump house MCC single line diagram is still missing. Send it, or confirm and say why the work can go ahead.",
    link: `/actions/${a310.code}`,
    people: [idOf("viewer@demo.local")].filter(Boolean),
  });
  // A300 is within its risk window with the duty pump datasheet missing: Mechanical's confirmation waits (approver's Home).
  // Civil asks for the shoring drawing to be added to A110: the list missed it. The control function answers on the action.
  await engineer.post(`${p}/transmittals`, {
    userIds: [idOf("controller@demo.local")].filter(Boolean), reason: "REQUEST", activityId: byCode.A110, activityAsk: "DOCUMENT",
    subject: `Add a document to ${(await engineer.get(`${p}/activities`)).find((one) => one.id === byCode.A110).code} (Civil)`,
    message: `Please add ${docs.excavation.number}, ${docs.excavation.title}, for Civil: the shoring stays in place while the slab is poured.\n\nIt was not on the requirements list.`,
  });

  // ── Work in progress on the register ───────────────────────────────────────
  console.log("A review waiting on its decision, and a draft…");
  // The MCC single line diagram is reviewed: the engineer checked it; the approver has to decide (approver's Home).
  await toReview(await revise(engineer, docs.mcc.id, [[`${docs.mcc.number}.pdf`, pdf(docs.mcc.title), "application/pdf"]], "First issue"));
  // The loop diagrams are being written: a revision in preparation (engineer's Home, Drafts).
  await revise(engineer, docs.loops.id, [[`${docs.loops.number}.pdf`, pdf(docs.loops.title), "application/pdf"]], "First issue, being drafted");

  console.log("\nDone. Every release was sent in the same act. Sign in as each demo person to see their Home:");
  console.log("  approver  — decide the MCC diagram; confirm Mechanical's documents for A300");
  console.log("  viewer    — Electrical's documents for A310, notified by hand");
  console.log("  controller — confirm the A400 postponement (holds Plan); add the shoring drawing to A110, as Civil asked; the schedule's upkeep");
  console.log("  engineer  — the loop diagrams draft");
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
