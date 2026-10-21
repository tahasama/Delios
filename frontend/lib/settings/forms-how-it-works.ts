"use server";

import { revalidatePath } from "next/cache";
import { requireAdminScope, requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { randomUUID } from "crypto";
import { STATE_NAMES, STATE_NAME_MAX } from "@/lib/core/state-names";
import { orgSettings, projectSettings, setOrgSetting, setProjectSetting } from "@/lib/settings/api";
import { api, projectPath, refusal } from "@/lib/client";
import { ESCALATE_AFTER_KEY } from "@/lib/actions/escalation";
import {
  CONTROL_ACTIVITIES,
  controlSettings,
  SKIPPABLE,
  SKIP_KEY,
  CONFIRMABLE,
  CONFIRM_KEY,
  actIsOff,
  effectiveAnswer,
  MODE_LABEL,
  POLICIES,
  PROJECT_KEY,
  PROJECT_MODE_LABEL,
  roomItemOf,
  type ControlMode,
  type ProjectMode,
} from "@/lib/settings/control-activities";

/**
 * Who carries out each act: the control function, or the people doing the work.
 *
 * The project answers it once — one side, the other side, or "it depends on the
 * act", and then each act carries its own answer. One screen writes both, and
 * every change goes on the record.
 */

type State = { error?: string; ok?: string };

const ACT_MODES: ControlMode[] = ["CONTROL", "SELF"];
const PROJECT_MODES: ProjectMode[] = ["CONTROL", "SELF", "CUSTOM"];

/** One stored answer, in the project's settings; the backend writes its audit line. */
async function put(key: string, mode: string, _label: string): Promise<boolean> {
  const ctx = await requireAdminScope();
  if ((await projectSettings(ctx.projectId)).get(key) === mode) return false;
  await setProjectSetting(ctx.projectId, key, mode);
  return true;
}

/**
 * The same form answers for a project, or for the organization's defaults for new projects (`target=defaults`,
 * administrators of the organization). The answers are saved where the form came from; null forgets one.
 */
async function save(formData: FormData, wanted: [key: string, value: string | null][]): Promise<number> {
  if (String(formData.get("target") ?? "") !== "defaults") {
    const ctx = await requireAdminScope();
    // An answer the organization keeps fixed is not the project's to change: it is left as it stands.
    const { liberty } = await import("@/lib/organization/liberty");
    const fixed = new Set((await liberty()).filter((one) => !one.free).map((one) => one.key));
    let changed = 0;
    for (const [key, value] of wanted) {
      const item = roomItemOf(key);
      if (item && fixed.has(item)) continue;
      if (((await projectSettings(ctx.projectId)).get(key) ?? null) === value) continue;
      await setProjectSetting(ctx.projectId, key, value);
      changed++;
    }
    return changed;
  }
  const { requireOrgAdmin } = await import("@/lib/core/org-scope");
  const { projectDefaults, DEFAULTS_KEY } = await import("@/lib/organization/defaults");
  const scope = await requireOrgAdmin();
  const before = await projectDefaults();
  const values = { ...(before?.values ?? {}) };
  let changed = 0;
  for (const [key, asked] of wanted) {
    // The app's own answer is not kept: the defaults hold only what differs from it.
    const value = asked !== null && asked === effectiveAnswer(key, null) ? null : asked;
    if ((values[key] ?? null) === value) continue;
    if (value === null) delete values[key]; else values[key] = value;
    changed++;
  }
  if (changed) {
    await setOrgSetting(DEFAULTS_KEY, JSON.stringify({ fromProject: before?.fromProject ?? null, edited: true, at: new Date().toISOString(), by: scope.user.name, values }));
  }
  return changed;
}

function revalidateHowItWorks() {
  revalidatePath("/settings/flow");
  revalidatePath("/settings/flow");
  revalidatePath("/organization");
  revalidatePath("/organization/defaults");
}

/**
 * The screen, saved in one go: the project's answer, and — when that answer is
 * "it depends" — each act's own. For the defaults, "as each project is set up"
 * (FOLLOW) forgets the answer.
 */
export async function setControlActivitiesAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const asked = String(formData.get("projectMode") ?? "") as ProjectMode | "FOLLOW";
  const defaults = String(formData.get("target") ?? "") === "defaults";
  if (!PROJECT_MODES.includes(asked as ProjectMode) && !(defaults && asked === "FOLLOW")) return { error: "Choose who carries these acts out." };

  const wanted: [string, string | null][] = [[PROJECT_KEY, asked === "FOLLOW" ? null : asked]];
  if (asked === "CUSTOM") {
    for (const activity of CONTROL_ACTIVITIES) {
      const value = String(formData.get(`mode:${activity.key}`) ?? "") as ControlMode;
      if (ACT_MODES.includes(value)) wanted.push([activity.key, value]);
    }
  }

  // An act that may be left out says so with its own answer, kept whichever way the acts are carried out: who would
  // carry it out stays as it was, for the day it is used again.
  for (const key of Object.keys(SKIPPABLE)) if (formData.has(`skipping:${key}`)) wanted.push([SKIP_KEY(key), formData.get(`use:${key}`) === "on" ? "ON" : "OFF"]);
  // The confirmation by whoever holds Manage is its own answer, kept whichever way the acts are carried out.
  for (const key of Object.keys(CONFIRMABLE)) wanted.push([CONFIRM_KEY(key), formData.get(`confirm:${key}`) === "on" ? "ON" : "OFF"]);
  let changed: number;
  try {
    changed = await save(formData, wanted);
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidateHowItWorks();
  if (!changed) return { ok: "Nothing changed." };
  if (asked === "FOLLOW") return { ok: "Saved — each new project follows whether it has a control function." };
  return {
    ok: asked === "CUSTOM"
      ? `Saved — act by act. ${CONTROL_ACTIVITIES.length} acts, each with its own answer.`
      : `Saved — ${PROJECT_MODE_LABEL[asked].toLowerCase()}.`,
  };
}

/**
 * How this organization works, as against who does what: what releasing a
 * revision means, and what makes an action's document count as delivered.
 * Both are genuine choices, and the app holds an opinion rather than a rule.
 */
export async function setPolicyAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const wanted: [string, string | null][] = [];
  const said: string[] = [];
  for (const one of POLICIES) {
    const asked = String(formData.get(one.key) ?? "");
    if (!one.options.some((option) => option.value === asked)) continue;
    wanted.push([one.key, asked]);
    said.push(one.options.find((option) => option.value === asked)!.label.toLowerCase());
  }
  const escalate = String(formData.get(ESCALATE_AFTER_KEY) ?? "").trim();
  if (escalate) {
    const days = Number(escalate);
    if (!Number.isInteger(days) || days < 1 || days > 60) return { error: "Notify again after 1 to 60 working days." };
    wanted.push([ESCALATE_AFTER_KEY, String(days)]);
    said.push(`notified again after ${days} working days`);
  }
  let changed: number;
  try {
    changed = await save(formData, wanted);
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidateHowItWorks();
  if (!changed) return { ok: "Nothing changed." };
  return { ok: `Saved: ${said.join("; ")}.` };
}

/**
 * Puts the project back on the organization's defaults for new projects (or, where it has none, on the app's own):
 * every answer about how the project works is set to the default's, and an answer the defaults do not give is
 * forgotten. What the project is, and checks ticked off on it, stay.
 */
export async function resetProjectToDefaultsAction(_prev: State | undefined, _formData: FormData): Promise<State> {
  const ctx = await requireAdminScope();
  const { projectDefaults, isProjectOwn } = await import("@/lib/organization/defaults");
  const defaults = await projectDefaults();
  const values = defaults?.values ?? {};
  let changed = 0;
  try {
    for (const [key, value] of await projectSettings(ctx.projectId)) {
      if (isProjectOwn(key) || key in values || !value) continue;
      await setProjectSetting(ctx.projectId, key, null);
      changed++;
    }
    const now = await projectSettings(ctx.projectId);
    for (const [key, value] of Object.entries(values)) {
      if (now.get(key) === value) continue;
      await setProjectSetting(ctx.projectId, key, value);
      changed++;
    }
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidateHowItWorks();
  if (!changed) return { ok: "Nothing changed: the project already works as the defaults say." };
  return { ok: defaults ? "Back on the organization's defaults." : "Back on the app's own defaults: the organization has set none." };
}

/**
 * What the organization calls each revision state. Only the name changes: the
 * states, their order and what they do stay as they are. A name left empty, or
 * set back to the default, goes back to the default.
 */
export async function setStateNamesAction(_prev: State | undefined, formData: FormData): Promise<State> {
  await requireAdminScope();
  const before = await orgSettings();
  const taken = new Map<string, string>();
  const changed: string[] = [];
  const wanted = STATE_NAMES.map((one) => {
    const asked = String(formData.get(`name:${one.code}`) ?? "").trim().replace(/\s+/g, " ");
    return { one, label: asked || one.default };
  });
  for (const { one, label } of wanted) {
    if (label.length > STATE_NAME_MAX) return { error: `Keep “${label}” under ${STATE_NAME_MAX} characters.` };
    // Two states read the same would make the register lie about one of them.
    const clash = taken.get(label.toLowerCase());
    if (clash) return { error: `“${label}” is used twice — ${clash} and ${one.default} must read differently.` };
    taken.set(label.toLowerCase(), one.default);
  }
  try {
    for (const { one, label } of wanted) {
      const was = before.get(`STATE_NAME:${one.code}`) ?? one.default;
      if (was === label) continue;
      // Set back to the default, the name is forgotten and the default applies again.
      await setOrgSetting(`STATE_NAME:${one.code}`, label === one.default ? null : label);
      changed.push(`${was} → ${label}`);
    }
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/", "layout");
  if (!changed.length) return { ok: "Nothing changed." };
  return { ok: `Renamed: ${changed.join("; ")}.` };
}

/**
 * The days around an action (Control room): how long before an action's day its documents are needed, unless the
 * requirements list says otherwise, and from how long before it the action is at risk. The backend checks the risk
 * window is the project's to change, and reads every action again.
 */
export async function setScheduleDaysAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const lead = Number(formData.get("leadDays"));
  const risk = Number(formData.get("riskDays"));
  if (!Number.isInteger(lead) || !Number.isInteger(risk) || lead < 0 || risk < 0 || lead > 365 || risk > 365)
    return { error: "Write whole days, from 0 to 365." };
  try {
    await api(projectPath(ctx, "/schedule/days"), { method: "PUT", body: { defaultLeadDays: lead, riskWindowDays: risk } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/flow");
  revalidatePath("/schedule");
  return { ok: `Saved: needed ${lead} days before an action, at risk from ${risk} days before.` };
}


/**
 * One answer of the Control room, changed where it is shown (a step's panel): who carries out an act (CONTROL /
 * SELF, or OFF for an act that may be left out), a question of how the project works, a confirmation by whoever
 * holds Manage (ON / OFF), a stamp on the PDF (ON / OFF), or the working days before a silent discipline is escalated. Only this answer changes;
 * an answer the organization keeps fixed is refused by the backend (ROOM_FIXED) and left as it stands.
 */
export async function setRoomAnswerAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const key = String(formData.get("key") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  const activity = CONTROL_ACTIVITIES.find((one) => one.key === key);
  let said: string;
  try {
    if (activity) {
      if (value === "OFF") {
        if (!SKIPPABLE[key]) return { error: `${activity.title} cannot be left out.` };
        await put(SKIP_KEY(key), "OFF", `${activity.title} — left out`);
        said = `${activity.title}: left out.`;
      } else {
        if (!ACT_MODES.includes(value as ControlMode)) return { error: "Choose who carries it out." };
        // Choosing a side for an act that was left out brings it back in use.
        if (await actIsOff(await requireAdminScope(), key)) await put(SKIP_KEY(key), "ON", `${activity.title} — back in use`);
        // Moving the project to "it depends" must not move any other act: each one is written down as it stands
        // now before this one changes.
        const now = await controlSettings(await requireAdminScope());
        if (!now.set || now.projectMode !== "CUSTOM") {
          for (const row of now.rows) if (row.activity.key !== key) await put(row.activity.key, row.controlDoes ? "CONTROL" : "SELF", row.activity.title);
        }
        await put(PROJECT_KEY, "CUSTOM", "Who carries out the acts of document control");
        await put(key, value, activity.title);
        said = `${activity.title}: ${MODE_LABEL[value as ControlMode].toLowerCase()}.`;
      }
    } else if (key.startsWith("CONFIRM:") && CONFIRMABLE[key.slice(8)]) {
      if (value !== "ON" && value !== "OFF") return { error: "Choose yes or no." };
      await save(formData, [[key, value]]);
      said = value === "ON" ? "Whoever holds Manage confirms it from now on." : "No confirmation from now on.";
    } else if (key === ESCALATE_AFTER_KEY) {
      const days = Number(value);
      if (!Number.isInteger(days) || days < 1 || days > 60) return { error: "Notify again after 1 to 60 working days." };
      await save(formData, [[key, String(days)]]);
      said = `A silent discipline is notified again after ${days} working days.`;
    } else {
      const policy = POLICIES.find((one) => one.key === key);
      const option = policy?.options.find((one) => one.value === value);
      if (!policy || !option) return { error: "That is not one of the answers." };
      await save(formData, [[key, value]]);
      said = `${policy.title}: ${option.label.replace(/ — recommended$/, "").replace(/ \(recommended\)$/, "").toLowerCase()}.`;
    }
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidateHowItWorks();
  return { ok: said };
}

/**
 * How other organizations' documents come into the project (the Control room): by placeholder, or as they come, filed
 * under a deliverable type, a document type and a discipline, the warning read. One way or the other: once one is in
 * use the backend refuses the other (MODE_IN_USE).
 */
export async function setIntakeAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const mode = String(formData.get("mode") ?? "");
  const text = (key: string) => String(formData.get(key) ?? "").trim() || null;
  try {
    await api(projectPath(ctx, "/intake"), {
      method: "PUT",
      body: { mode, deliverableType: text("deliverableType"), docType: text("docType"), discipline: text("discipline"), understood: formData.get("understood") === "on" },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/flow");
  revalidatePath("/packages");
  return { ok: mode === "AS_RECEIVED" ? "Saved: other organizations' documents are taken as they come." : "Saved: other organizations' documents come by placeholder." };
}

/**
 * The stamp, saved as one (owner: a card of its own). `level` = organization (an administrator, the default every
 * project reads) or project (where the organization leaves it free): a project keeps only what differs from the
 * organization's, so the rest goes on following it.
 */
export async function setStampAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const { STAMP_KEYS, STAMP_PLACE_KEY: placeKey, STAMP_PLACES: places, stampAnswers } = await import("@/lib/settings/stamp");
  const place = String(formData.get(placeKey) ?? "");
  if (!places.some((one) => one.value === place)) return { error: "Choose where the stamp sits." };
  const { STAMP_NOTE_KEY: noteKey, STAMP_NOTE_MAX: noteMax } = await import("@/lib/settings/stamp");
  const note = String(formData.get(noteKey) ?? "").trim().replace(/\s+/g, " ");
  if (note.length > noteMax) return { error: `The words at its foot: ${noteMax} characters at most.` };
  const asked = Object.fromEntries(STAMP_KEYS.map((key) => [key, key === placeKey ? place : key === noteKey ? note : formData.get(key) === "on" ? "ON" : "OFF"]));
  try {
    const organization = await orgSettings();
    if (String(formData.get("level")) === "organization") {
      const { requireOrgAdmin } = await import("@/lib/core/org-scope");
      await requireOrgAdmin();
      const now = stampAnswers(organization);
      for (const key of STAMP_KEYS) if (now[key] !== asked[key]) await setOrgSetting(key, asked[key] || null);
      revalidatePath("/organization/settings/stamp");
      return { ok: "Saved. Every project reading the organization's stamp uses it from now on." };
    }
    const ctx = await requireScope();
    const theirs = stampAnswers(organization);
    const own = await projectSettings(ctx.projectId);
    let changed = 0;
    for (const key of STAMP_KEYS) {
      const value = asked[key] === theirs[key] ? null : asked[key];
      if ((own.get(key) ?? null) === value) continue;
      await setProjectSetting(ctx.projectId, key, value);
      changed++;
    }
    revalidatePath("/settings/stamp");
    revalidatePath("/settings/flow");
    revalidatePath("/conformance/plan");
    return { ok: changed ? "Saved. Revisions stamped from now on carry it." : "Nothing changed." };
  } catch (e) {
    return { error: refusal(e).message };
  }
}
