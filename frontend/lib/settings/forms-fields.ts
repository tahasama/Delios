"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";
import { KINDS, keyFromLabel, storedOwnFields, type Control, type FieldKind, type FieldRule } from "@/lib/settings/field-policy";

/**
 * Forms & fields: what each form asks, saved into the project's own copy of its forms (the backend makes it, from the
 * organization's, on the first change: `FormRules`). The backend checks who may (the control function; the
 * organization's forms, an administrator) and keeps a field answered at least once: retired, never taken away, what it
 * asks unchanged.
 */
type Result = { error?: string; ok?: string };
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const RULES: FieldRule[] = ["REQUIRED", "OPTIONAL", "OFF"];
const CONTROLS: Control[] = ["TEXT", "LONG_TEXT", "NUMBER", "DATE", "YES_NO", "CHOICE"];

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

/** How one of the app's fields, or one of one's own, stands: must be filled, asked, or not asked. Acts at once. */
export async function setFieldRuleAction(formData: FormData): Promise<void> {
  const kind = kindOf(formData);
  const key = text(formData, "key");
  const rule = text(formData, "rule") as FieldRule;
  if (!kind || !key || !RULES.includes(rule)) return;
  if (text(formData, "of") === "own") {
    const ctx = await requireScope();
    const { own } = await storedOwnFields(ctx, kind);
    await save(kind, { own: own.map((row) => (row.key === key ? { ...row, rule } : row)) });
  } else await save(kind, { rules: { [key]: rule } });
}

/** What one of the app's fields is called on this project's form. */
export async function renameFieldAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const kind = kindOf(formData);
  const key = text(formData, "key");
  if (!kind || !key) return { error: "No such field." };
  return (await save(kind, { labels: { [key]: text(formData, "label").slice(0, 60) || null } })) ?? { ok: "Saved." };
}

/**
 * A field of one's own, added or changed with the same form: what it is called, the kind of answer (a list chosen
 * makes it a choice from that list), whether it must be filled, the note under the box, and a column of the register.
 */
export async function saveOwnFieldAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const kind = kindOf(formData);
  if (!kind) return { error: "No such form." };
  const label = text(formData, "label");
  const setKey = text(formData, "setKey") || null;
  // A list chosen is the answer: the field is a choice from it, whatever kind was left in the other box.
  const control = (setKey ? "CHOICE" : text(formData, "control")) as Control;
  const rule = (text(formData, "rule") || "OPTIONAL") as FieldRule;
  if (!label) return { error: "Give the field a name: it is what people filling the form read." };
  if (!CONTROLS.includes(control)) return { error: "Say what kind of answer it takes." };
  if (control === "CHOICE" && !setKey) return { error: "A field chosen from a list names the list it draws from." };
  if (!RULES.includes(rule)) return { error: "Say whether it must be filled." };
  const ctx = await requireScope();
  const { own } = await storedOwnFields(ctx, kind);
  const key = text(formData, "key");
  const fields = {
    label: label.slice(0, 60), control, setKey: control === "CHOICE" ? setKey : null, rule,
    help: text(formData, "help") || null, inRegister: formData.get("inRegister") === "on",
  };
  if (key) {
    if (!own.some((row) => row.key === key)) return { error: "No such field." };
    return (await save(kind, { own: own.map((row) => (row.key === key ? { ...row, ...fields } : row)) })) ?? { ok: `${label} saved.` };
  }
  const row = { id: randomUUID(), key: keyFromLabel(label, own.map((o) => o.key)), retired: false, ...fields };
  return (await save(kind, { own: [...own, row] })) ?? { ok: `${label} added.` };
}

/** Retires a field of one's own that was answered (no longer asked; its answers stay), or brings it back. */
export async function retireOwnFieldAction(formData: FormData): Promise<void> {
  const kind = kindOf(formData);
  const key = text(formData, "key");
  if (!kind || !key) return;
  const ctx = await requireScope();
  const { own } = await storedOwnFields(ctx, kind);
  await save(kind, { own: own.map((row) => (row.key === key ? { ...row, retired: !row.retired } : row)) });
}

/** Takes a field of one's own never answered off the form (one answered is retired instead: the backend refuses). */
export async function removeOwnFieldAction(formData: FormData): Promise<void> {
  const kind = kindOf(formData);
  const key = text(formData, "key");
  if (!kind || !key) return;
  const ctx = await requireScope();
  const { own } = await storedOwnFields(ctx, kind);
  await save(kind, { own: own.filter((row) => row.key !== key) });
}
