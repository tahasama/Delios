"use server";

import { revalidatePath } from "next/cache";
import { requireAdminScope, requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { randomUUID } from "crypto";
import { STATE_NAMES, STATE_NAME_MAX } from "@/lib/core/state-names";
import { orgSettings, projectSettings, setOrgSetting, setProjectSetting } from "@/lib/settings/api";
import { refusal } from "@/lib/client";
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
  STAMP_KINDS,
  STAMP_COMMENTS_KEY,
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
  revalidatePath("/settings/control");
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
  // Which stamps, and the comments: ticked is on, unticked off (the section says it was on the form).
  if (formData.has("stamps")) {
    for (const kind of STAMP_KINDS) wanted.push([kind.key, formData.get(kind.key) === "on" ? "ON" : "OFF"]);
    wanted.push([STAMP_COMMENTS_KEY, formData.get(STAMP_COMMENTS_KEY) === "on" ? "ON" : "OFF"]);
  }
  const escalate = String(formData.get(ESCALATE_AFTER_KEY) ?? "").trim();
  if (escalate) {
    const days = Number(escalate);
    if (!Number.isInteger(days) || days < 1 || days > 60) return { error: "Escalate after 1 to 60 working days." };
    wanted.push([ESCALATE_AFTER_KEY, String(days)]);
    said.push(`escalate after ${days} working days`);
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

/** One act, changed on its own while the project is on "it depends". */
export async function setOneControlActivityAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const key = String(formData.get("key") ?? "");
  const value = String(formData.get("mode") ?? "") as ControlMode | "OFF";
  const activity = CONTROL_ACTIVITIES.find((one) => one.key === key);
  if (!activity) return { error: "That is not one of the acts." };
  // Left out altogether: who would carry it out stays as it was, for the day
  // it is turned back on.
  if (value === "OFF") {
    if (!SKIPPABLE[key]) return { error: `${activity.title} cannot be left out.` };
    const changed = await put(SKIP_KEY(key), "OFF", `${activity.title} — left out`);
    revalidatePath("/settings/control");
    revalidatePath("/settings/flow");
    return { ok: changed ? `${activity.title}: left out.` : "Nothing changed." };
  }
  if (!ACT_MODES.includes(value)) return { error: "Choose who carries it out." };
  // Choosing a side for an act that was left out brings it back in use.
  const wasOff = (await actIsOff(await requireAdminScope(), key)) && (await put(SKIP_KEY(key), "ON", `${activity.title} — back in use`));
  // Moving the project to "it depends" must not move any other act: each one
  // is written down as it stands now before this one changes.
  const now = await controlSettings(await requireAdminScope());
  if (now.projectMode !== "CUSTOM") {
    for (const row of now.rows) {
      if (row.activity.key === key) continue;
      await put(row.activity.key, row.controlDoes ? "CONTROL" : "SELF", row.activity.title);
    }
  }
  await put(PROJECT_KEY, "CUSTOM", "Who carries out the acts of document control");
  const changed = (await put(key, value, activity.title)) || wasOff;
  revalidatePath("/settings/control");
  revalidatePath("/settings/flow");
  return { ok: changed ? `${activity.title}: ${MODE_LABEL[value].toLowerCase()}.` : "Nothing changed." };
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

