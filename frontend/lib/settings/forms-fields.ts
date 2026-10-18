"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";
import { KINDS, keyFromLabel, storedOwnFields, type Control, type FieldKind, type FieldRule } from "@/lib/settings/field-policy";

/**
 * Forms & fields: what each form asks, saved into the project's own copy of its forms (the backend makes it, from the
 * organization's, on the first change: `FormRules`). Each act changes one thing and acts at once; the backend checks
 * who may (the control function; the organization's forms, an administrator).
 */
type Result = { error?: string; ok?: string };
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const RULES: FieldRule[] = ["REQUIRED", "OPTIONAL", "OFF"];

function revalidate() {
  for (const path of ["/settings/fields", "/documents/new", "/transmittals/new", "/packages", "/assets", "/documents"]) revalidatePath(path);
}

async function save(kind: FieldKind, body: Record<string, unknown>): Promise<Result | null> {
  const ctx = await requireScope();
  try {
    await api(projectPath(ctx, `/forms/${kind}`), { method: "PUT", body });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidate();
  return null;
}

function kindOf(formData: FormData): FieldKind | null {
  const kind = text(formData, "kind") as FieldKind;
  return KINDS.includes(kind) ? kind : null;
}

/** How one field stands: must be filled, asked, or not asked. `of` says whose field: the app's, a list's, or one added. */
export async function setFieldRuleAction(formData: FormData): Promise<void> {
  const kind = kindOf(formData);
  const key = text(formData, "key");
  const rule = text(formData, "rule") as FieldRule;
  if (!kind || !key || !RULES.includes(rule)) return;
  const of = text(formData, "of");
  if (of === "own") {
    const ctx = await requireScope();
    const { own } = await storedOwnFields(ctx, kind);
    await save(kind, { own: own.map((row) => (row.key === key ? { ...row, rule } : row)) });
  } else if (of === "list") await save(kind, { lists: { [key]: rule } });
  else await save(kind, { rules: { [key]: rule } });
}

/** What a field is called on this project's form. */
export async function renameFieldAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const kind = kindOf(formData);
  const key = text(formData, "key");
  const label = text(formData, "label").slice(0, 60);
  if (!kind || !key) return { error: "No such field." };
  if (text(formData, "of") === "own") {
    if (!label) return { error: "Give the field a name." };
    const ctx = await requireScope();
    const { own } = await storedOwnFields(ctx, kind);
    const help = text(formData, "help") || null;
    return (await save(kind, { own: own.map((row) => (row.key === key ? { ...row, label, help } : row)) })) ?? { ok: `${label} saved.` };
  }
  return (await save(kind, { labels: { [key]: label || null } })) ?? { ok: "Saved." };
}

/** Whether a field added to the document form is a column of the register. */
export async function ownInRegisterAction(formData: FormData): Promise<void> {
  const kind = kindOf(formData);
  const key = text(formData, "key");
  if (!kind || !key) return;
  const ctx = await requireScope();
  const { own } = await storedOwnFields(ctx, kind);
  await save(kind, { own: own.map((row) => (row.key === key ? { ...row, inRegister: !row.inRegister } : row)) });
}

/** A field of the project's own on a form: asked, kept with the record, read back under its name. */
export async function addOwnFieldAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const kind = kindOf(formData);
  if (!kind) return { error: "No such form." };
  const label = text(formData, "label");
  const control = text(formData, "control") as Control;
  const setKey = text(formData, "setKey") || null;
  const rule = (text(formData, "rule") || "OPTIONAL") as FieldRule;
  if (!label) return { error: "Give the field a name: it is what people filling the form read." };
  if (!["TEXT", "LONG_TEXT", "NUMBER", "DATE", "YES_NO", "CHOICE"].includes(control)) return { error: "Say what kind of answer it takes." };
  if (control === "CHOICE" && !setKey) return { error: "A field chosen from a list names the list it draws from." };
  if (!RULES.includes(rule)) return { error: "Say whether it must be filled." };
  const ctx = await requireScope();
  const { own } = await storedOwnFields(ctx, kind);
  const row = {
    id: randomUUID(), key: keyFromLabel(label, own.map((o) => o.key)), label: label.slice(0, 60), control,
    setKey: control === "CHOICE" ? setKey : null, rule, help: text(formData, "help") || null, inRegister: formData.get("inRegister") === "on",
  };
  return (await save(kind, { own: [...own, row] })) ?? { ok: `${label} added.` };
}

/** Takes a field of one's own off a form: no longer asked; answers already given stay on the records. */
export async function removeOwnFieldAction(formData: FormData): Promise<void> {
  const kind = kindOf(formData);
  const key = text(formData, "key");
  if (!kind || !key) return;
  const ctx = await requireScope();
  const { own } = await storedOwnFields(ctx, kind);
  await save(kind, { own: own.filter((row) => row.key !== key) });
}
