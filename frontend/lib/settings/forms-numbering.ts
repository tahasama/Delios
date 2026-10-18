"use server";

import { revalidatePath } from "next/cache";
import { getScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";
import { backendField, numberingForEditor, RECORD_KIND } from "@/lib/settings/api-admin";

/**
 * Numbering on two levels: the organization's (its page, an administrator) or a project's (Settings, only where the
 * organization left numbering free; its first change makes the project's own copy). The backend checks who may and what
 * may change (a scheme that gave numbers keeps its parts: SCHEME_IN_USE); these send what the form says.
 */
type Result = { error?: string; ok?: string };
type Level = "organization" | "project";
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const failed = (e: unknown): Result => ({ error: refusal(e).message });

function levelOf(formData: FormData): Level {
  return text(formData, "level") === "organization" ? "organization" : "project";
}

async function base(level: Level): Promise<string> {
  if (level === "organization") return "/api/admin/numbering";
  const scope = await getScope();
  if (!scope) throw new Error("No project is open.");
  return projectPath(scope, "/numbering");
}

function revalidate() {
  for (const path of ["/organization/settings/numbering", "/settings/numbering", "/documents/new", "/settings"]) revalidatePath(path);
}

/** A scheme, new or changed: its name, delimiter, when it is used, and its parts in order. */
export async function saveNumberingSchemeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const level = levelOf(formData);
  const id = text(formData, "id");
  const name = text(formData, "name");
  const delimiter = text(formData, "delimiter") || "-";
  const notes = text(formData, "notes");
  const labels = formData.getAll("fieldLabel").map((value) => String(value).trim());
  const setKeys = formData.getAll("fieldSetKey").map((value) => String(value).trim());
  const rules = formData.getAll("fieldRule").map((value) => String(value).trim());
  if (!name) return { error: "Give the scheme a name." };
  if (delimiter.length !== 1 || /[A-Za-z0-9]/.test(delimiter)) return { error: "The delimiter is one character that is not a letter or a digit." };
  // A scheme that gave numbers sends no parts: its parts stay as they are.
  const reshape = formData.get("fixedParts") !== "1";
  if (reshape) {
    if (!labels.length || labels.some((label) => !label)) return { error: "Every part needs a name." };
    if (rules.filter((rule) => rule.startsWith("COUNTER:")).length !== 1) return { error: "A scheme has exactly one running number, so no two numbers are the same." };
  }
  const fields = reshape ? labels.map((label, index) => backendField(label, setKeys[index] ?? "", rules[index] ?? "")) : undefined;
  try {
    const path = await base(level);
    const body = { name, notes, ...(reshape ? { delimiter, fields } : {}) };
    if (id) await api(`${path}/schemes/${id}`, { method: "PUT", body });
    else await api(`${path}/schemes`, { body });
  } catch (e) {
    return failed(e);
  }
  revalidate();
  return { ok: `${name} saved.` };
}

/** Which scheme numbers one deliverable type or record kind, and whether it is numbered at all. */
export async function saveSchemeRoutingAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const level = levelOf(formData);
  const deliverableType = text(formData, "deliverableType");
  const schemeName = text(formData, "schemeName");
  const active = formData.has("status") ? formData.get("active") === "on" : true;
  if (!deliverableType || !schemeName) return { error: "Choose a scheme." };
  try {
    const scheme = (await numberingForEditor(level)).schemes.find((one) => one.name === schemeName);
    if (!scheme) return { error: "No such scheme." };
    await api(`${await base(level)}/routing`, {
      method: "PUT", body: { deliverableType: RECORD_KIND[deliverableType] ?? deliverableType, schemeId: active ? scheme.id : null },
    });
  } catch (e) {
    return failed(e);
  }
  revalidate();
  return { ok: active ? `${deliverableType} is numbered by ${schemeName}.` : `${deliverableType} is no longer numbered: nothing new of it can be numbered.` };
}

/** Retires a scheme (it numbers nothing more; its numbers keep it), or brings it back. */
export async function retireNumberingSchemeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const level = levelOf(formData);
  const id = text(formData, "id");
  try {
    await api(`${await base(level)}/schemes/${id}`, { method: "PUT", body: { active: text(formData, "active") === "1" } });
  } catch (e) {
    return failed(e);
  }
  revalidate();
  return { ok: "Saved." };
}

/** Deletes a scheme that never gave a number and numbers nothing (the backend refuses any other, and says why). */
export async function deleteNumberingSchemeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const level = levelOf(formData);
  const id = text(formData, "id");
  try {
    await api(`${await base(level)}/schemes/${id}`, { method: "DELETE" });
  } catch (e) {
    return failed(e);
  }
  revalidate();
  return { ok: "Deleted." };
}

/**
 * Puts a project back on the organization's numbering (owner: from the organization's Settings, for special messes
 * only). Always with why; the project's control function is told; numbers already given stay as they are.
 */
export async function resetProjectNumberingAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const projectId = text(formData, "projectId");
  const reason = text(formData, "reason");
  if (!reason) return { error: "Say why it goes back to the organization's numbering." };
  try {
    await api(`/api/admin/numbering/projects/${projectId}/reset`, { body: { reason } });
  } catch (e) {
    return failed(e);
  }
  revalidate();
  return { ok: "It numbers by the organization's again." };
}
