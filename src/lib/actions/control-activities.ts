"use server";

import { revalidatePath } from "next/cache";
import { requireAdminScope, requireScope } from "@/lib/scope";
import { isAdmin } from "@/lib/auth";
import { randomUUID } from "crypto";
import {
  KINDS, fieldsOf, keyFromLabel, fieldRules, fieldLabels, storedOwnFields, FIELD_RULE_KEY, FIELD_LABEL_KEY, OWN_FIELDS_KEY,
  type FieldKind, type Control, type FieldRule,
} from "@/lib/field-policy";
import { STATE_NAMES, STATE_NAME_MAX } from "@/lib/state-names";
import { orgSettings, projectSettings, setOrgSetting, setProjectSetting } from "@/lib/api/settings";
import { refusal } from "@/lib/api/client";
import {
  CONTROL_ACTIVITIES,
  controlSettings,
  SKIPPABLE,
  SKIP_KEY,
  actIsOff,
  MODE_LABEL,
  POLICIES,
  PROJECT_KEY,
  PROJECT_MODE_LABEL,
  type ControlMode,
  type ProjectMode,
} from "@/lib/control-activities";

/**
 * Who carries out each act: Document Control, or the people doing the work.
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
 * The screen, saved in one go: the project's answer, and — when that answer is
 * "it depends" — each act's own.
 */
export async function setControlActivitiesAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const asked = String(formData.get("projectMode") ?? "") as ProjectMode;
  if (!PROJECT_MODES.includes(asked)) return { error: "Choose who carries these acts out." };

  let changed = await put(PROJECT_KEY, asked, "Who carries out the acts of document control");
  if (asked === "CUSTOM") {
    for (const activity of CONTROL_ACTIVITIES) {
      const value = String(formData.get(`mode:${activity.key}`) ?? "") as ControlMode;
      if (!ACT_MODES.includes(value)) continue;
      if (await put(activity.key, value, activity.title)) changed = true;
    }
  }
  revalidatePath("/settings/control");
  revalidatePath("/settings/flow");
  if (!changed) return { ok: "Nothing changed." };
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
  const changed: string[] = [];
  for (const one of POLICIES) {
    const asked = String(formData.get(one.key) ?? "");
    if (!one.options.some((option) => option.value === asked)) continue;
    if (await put(one.key, asked, one.title)) {
      changed.push(one.options.find((option) => option.value === asked)!.label.toLowerCase());
    }
  }
  revalidatePath("/settings/control");
  revalidatePath("/settings/flow");
  if (!changed.length) return { ok: "Nothing changed." };
  return { ok: `Saved: ${changed.join("; ")}.` };
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

/**
 * What the forms ask for.
 *
 * One kind at a time, so an administrator saves the document form without
 * touching the transmittal one. A field the application does not let an
 * organization weaken is ignored even if it arrives in the post.
 */
export async function setFieldPolicyAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  if (!isAdmin(ctx.user)) return { error: "Only an administrator decides what the forms ask for." };
  const kind = String(formData.get("kind") ?? "") as FieldKind;
  if (!KINDS.includes(kind)) return { error: "No such form." };
  const [rules, labels] = await Promise.all([fieldRules(ctx, kind), fieldLabels(ctx, kind)]);
  let changed = 0;
  try {
    for (const field of fieldsOf(kind)) {
      // A fixed field keeps its rule; its name is still the organization's to give.
      const said = field.fixed ? rules[field.key] : String(formData.get(`rule:${field.key}`) ?? "");
      if (!["REQUIRED", "OPTIONAL", "OFF"].includes(said)) continue;
      const typed = String(formData.get(`label:${field.key}`) ?? "").trim();
      const label = !typed || typed === field.label ? null : typed.slice(0, 60);
      let moved = false;
      if (!field.fixed && said !== rules[field.key]) {
        await setOrgSetting(`${FIELD_RULE_KEY}${kind}:${field.key}`, said === field.fallback ? null : said);
        moved = true;
      }
      if ((label ?? field.label) !== labels[field.key]) {
        await setOrgSetting(`${FIELD_LABEL_KEY}${kind}:${field.key}`, label);
        moved = true;
      }
      if (moved) changed++;
    }
    // The organization's own fields are saved from the same form.
    const own = await storedOwnFields(kind);
    let ownChanged = false;
    const next = own.map((row) => {
      const rule = String(formData.get(`own-rule:${row.id}`) ?? "");
      const label = String(formData.get(`own-label:${row.id}`) ?? "").trim();
      const inRegister = formData.get(`own-register:${row.id}`) === "on";
      if (!["REQUIRED", "OPTIONAL", "OFF"].includes(rule) || !label) return row;
      if (rule === row.rule && label === row.label && inRegister === row.inRegister) return row;
      ownChanged = true;
      changed++;
      return { ...row, rule: rule as FieldRule, label: label.slice(0, 60), inRegister };
    });
    if (ownChanged) await setOrgSetting(`${OWN_FIELDS_KEY}${kind}`, JSON.stringify(next));
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/fields");
  revalidatePath("/documents/new");
  revalidatePath("/transmittals/new");
  return { ok: changed ? `Saved — ${changed} field${changed === 1 ? "" : "s"} changed.` : "Nothing changed." };
}

/**
 * A field of the organization's own.
 *
 * Nothing in the application computes with it: it is asked on the form, kept
 * with the record, and read back on the detail page, the register and the
 * export. That is the whole of its life, which is why adding one is safe.
 */
export async function addOwnFieldAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  if (!isAdmin(ctx.user)) return { error: "Only an administrator adds a field." };
  const kind = String(formData.get("kind") ?? "") as FieldKind;
  if (!KINDS.includes(kind)) return { error: "No such form." };
  const label = String(formData.get("label") ?? "").trim();
  const control = String(formData.get("control") ?? "") as Control;
  const setKey = String(formData.get("setKey") ?? "").trim() || null;
  const rule = String(formData.get("rule") ?? "OPTIONAL") as FieldRule;
  const help = String(formData.get("help") ?? "").trim() || null;
  const inRegister = formData.get("inRegister") === "on";
  if (!label) return { error: "Give the field a name — it is what people filling the form will read." };
  if (!["TEXT", "LONG_TEXT", "NUMBER", "DATE", "YES_NO", "CHOICE"].includes(control)) return { error: "Say what kind of answer it takes." };
  if (control === "CHOICE" && !setKey) return { error: "A field chosen from a list needs the list it draws from." };
  if (!["REQUIRED", "OPTIONAL", "OFF"].includes(rule)) return { error: "Say whether it must be filled." };
  const existing = await storedOwnFields(kind);
  const key = keyFromLabel(label, existing.map((e) => e.key));
  try {
    await setOrgSetting(`${OWN_FIELDS_KEY}${kind}`, JSON.stringify([
      ...existing,
      { id: randomUUID(), key, label: label.slice(0, 60), control, setKey: control === "CHOICE" ? setKey : null, rule, help, inRegister },
    ]));
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/settings/fields");
  revalidatePath("/documents/new");
  return { ok: `${label} added.` };
}

/** Remove a field the organization added. Answers already given are left where they are. */
export async function removeOwnFieldAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  if (!isAdmin(ctx.user)) return { error: "Only an administrator removes a field." };
  const id = String(formData.get("id") ?? "");
  for (const kind of KINDS) {
    const rows = await storedOwnFields(kind);
    const row = rows.find((one) => one.id === id);
    if (!row) continue;
    try {
      await setOrgSetting(`${OWN_FIELDS_KEY}${kind}`, JSON.stringify(rows.filter((one) => one.id !== id)));
    } catch (e) {
      return { error: refusal(e).message };
    }
    revalidatePath("/settings/fields");
    revalidatePath("/documents/new");
    return { ok: `${row.label} removed. It is no longer asked; what was already answered stays on the record.` };
  }
  return { error: "No such field." };
}

/**
 * Remove a field from the row it sits on.
 *
 * The same act as the one above, in the shape a button inside another form can
 * call: the button carries the field's id as its own value, so one form can
 * save every row or drop one without nesting a second form inside itself.
 */
export async function removeOwnFieldOnRow(formData: FormData): Promise<void> {
  await removeOwnFieldAction(undefined, formData);
}
