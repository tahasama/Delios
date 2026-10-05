"use server";

import { revalidatePath } from "next/cache";
import { requireAdminScope, requireScope } from "@/lib/scope";
import { isAdmin } from "@/lib/auth";
import { KINDS, KIND_LABEL, fieldsOf, keyFromLabel, type FieldKind, type Control } from "@/lib/field-policy";
import { audit } from "@/lib/audit";
import { STATE_NAMES, STATE_NAME_MAX } from "@/lib/state-names";
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

/** One stored answer, with its own audit line. */
async function put(key: string, mode: string, label: string): Promise<boolean> {
  const ctx = await requireAdminScope();
  const { user, db, projectId } = ctx;
  const before = await db.controlSetting.findFirst({ where: { key }, select: { id: true, mode: true } });
  if (before?.mode === mode) return false;
  if (before) {
    await db.controlSetting.update({ where: { id: before.id }, data: { mode, setById: user.id, setByName: user.name } });
  } else {
    await db.controlSetting.create({ data: { projectId, key, mode, setById: user.id, setByName: user.name } });
  }
  await audit({
    tenant: ctx, actor: user, action: "CONTROL_SETTING_CHANGED", entityType: "ControlSetting",
    entityId: before?.id ?? key, entityLabel: label,
    oldValue: before?.mode ?? null, newValue: mode,
  });
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
  const ctx = await requireAdminScope();
  const { user, db, orgId } = ctx;
  const before = new Map((await db.stateName.findMany({ select: { id: true, code: true, label: true } })).map((row) => [row.code, row]));
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
  for (const { one, label } of wanted) {
    const row = before.get(one.code);
    const was = row?.label ?? one.default;
    if (was === label) continue;
    if (label === one.default) {
      if (row) await db.stateName.delete({ where: { id: row.id } });
    } else if (row) {
      await db.stateName.update({ where: { id: row.id }, data: { label, setById: user.id, setByName: user.name } });
    } else {
      await db.stateName.create({ data: { orgId, code: one.code, label, setById: user.id, setByName: user.name } });
    }
    await audit({
      tenant: ctx, actor: user, action: "STATE_RENAMED", entityType: "StateName",
      entityId: one.code, entityLabel: one.default, oldValue: was, newValue: label,
    });
    changed.push(`${was} → ${label}`);
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
  const { user, db, orgId } = ctx;
  if (!isAdmin(user)) return { error: "Only an administrator decides what the forms ask for." };
  const kind = String(formData.get("kind") ?? "") as FieldKind;
  if (!KINDS.includes(kind)) return { error: "No such form." };

  let changed = 0;
  for (const field of fieldsOf(kind)) {
    const before = await db.fieldPolicy.findFirst({ where: { kind, field: field.key } });
    // A fixed field keeps its rule; its name is still the organization's to give.
    const said = field.fixed ? before?.rule ?? field.fallback : String(formData.get(`rule:${field.key}`) ?? "");
    if (!["REQUIRED", "OPTIONAL", "OFF"].includes(said)) continue;
    const typed = String(formData.get(`label:${field.key}`) ?? "").trim();
    const label = !typed || typed === field.label ? null : typed.slice(0, 60);
    if ((before?.rule ?? field.fallback) === said && (before?.label ?? null) === label) continue;
    await db.fieldPolicy.upsert({
      where: { orgId_kind_field: { orgId, kind, field: field.key } },
      update: { rule: said, label, setByName: user.name, setAt: new Date() },
      create: { orgId, kind, field: field.key, rule: said, label, setByName: user.name },
    });
    changed++;
  }
  // The organization's own fields are saved from the same form.
  for (const own of await db.customField.findMany({ where: { kind } })) {
    const rule = String(formData.get(`own-rule:${own.id}`) ?? "");
    const label = String(formData.get(`own-label:${own.id}`) ?? "").trim();
    const inRegister = formData.get(`own-register:${own.id}`) === "on";
    if (!["REQUIRED", "OPTIONAL", "OFF"].includes(rule) || !label) continue;
    if (rule === own.rule && label === own.label && inRegister === own.inRegister) continue;
    await db.customField.update({ where: { id: own.id }, data: { rule, label: label.slice(0, 60), inRegister } });
    changed++;
  }
  if (changed) {
    await audit({
      actor: user,
      action: "FIELDS_SET",
      entityType: "FieldPolicy",
      entityId: kind,
      entityLabel: KIND_LABEL[kind],
      detail: `${changed} field${changed === 1 ? "" : "s"} changed on ${KIND_LABEL[kind].toLowerCase()}.`,
    });
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
  const { user, db, orgId } = ctx;
  if (!isAdmin(user)) return { error: "Only an administrator adds a field." };
  const kind = String(formData.get("kind") ?? "") as FieldKind;
  if (!KINDS.includes(kind)) return { error: "No such form." };
  const label = String(formData.get("label") ?? "").trim();
  const control = String(formData.get("control") ?? "") as Control;
  const setKey = String(formData.get("setKey") ?? "").trim() || null;
  const rule = String(formData.get("rule") ?? "OPTIONAL");
  const help = String(formData.get("help") ?? "").trim() || null;
  const inRegister = formData.get("inRegister") === "on";

  if (!label) return { error: "Give the field a name — it is what people filling the form will read." };
  if (!["TEXT", "LONG_TEXT", "NUMBER", "DATE", "YES_NO", "CHOICE"].includes(control)) return { error: "Say what kind of answer it takes." };
  if (control === "CHOICE" && !setKey) return { error: "A field chosen from a list needs the list it draws from." };
  if (!["REQUIRED", "OPTIONAL", "OFF"].includes(rule)) return { error: "Say whether it must be filled." };

  const existing = await db.customField.findMany({ where: { kind }, select: { key: true } });
  const key = keyFromLabel(label, existing.map((e) => e.key));
  const position = await db.customField.count({ where: { kind } });
  await db.customField.create({
    data: { orgId, kind, key, label: label.slice(0, 60), control, setKey: control === "CHOICE" ? setKey : null, rule, help, position, inRegister, addedByName: user.name },
  });
  await audit({
    actor: user, action: "FIELD_ADDED", entityType: "CustomField", entityId: key, entityLabel: label,
    detail: `Added to ${KIND_LABEL[kind].toLowerCase()} — ${control.toLowerCase().replace("_", " ")}${setKey ? ` from ${setKey}` : ""}.`,
  });
  revalidatePath("/settings/fields");
  revalidatePath("/documents/new");
  return { ok: `${label} added.` };
}

/** Remove a field the organization added. Answers already given are left where they are. */
export async function removeOwnFieldAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (!isAdmin(user)) return { error: "Only an administrator removes a field." };
  const id = String(formData.get("id") ?? "");
  const row = await db.customField.findFirst({ where: { id } });
  if (!row) return { error: "No such field." };
  await db.customField.delete({ where: { id } });
  await audit({
    actor: user, action: "FIELD_REMOVED", entityType: "CustomField", entityId: row.key, entityLabel: row.label,
    detail: "Removed from the form. Answers already given stay with the records that carry them.",
  });
  revalidatePath("/settings/fields");
  revalidatePath("/documents/new");
  return { ok: `${row.label} removed. It is no longer asked; what was already answered stays on the record.` };
}
