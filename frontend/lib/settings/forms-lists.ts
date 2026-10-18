"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireScope } from "@/lib/core/scope";
import { buildProps } from "@/lib/settings/config-props";
import { getSet, organizationSet } from "@/lib/settings/config";
import { api, forgetShortLived, projectPath, refusal } from "@/lib/client";

/**
 * The lists, on two levels: a project's (`/api/projects/{id}/lists`; its first change of a list the organization leaves
 * free gives it its own copy of that list) or the organization's (`/api/admin/lists`, its Settings), as the form's
 * hidden `level` says. A value never used may change entirely or be deleted, a used one only renamed or retired. These
 * send what the form says and show the backend's refusal word for word.
 */

type Result = { error?: string; ok?: string };
const failed = (e: unknown): Result => ({ error: refusal(e).message });
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

/** A value as the page names it: its list and its code. */
function valueRef(valueId: string): { setKey: string; code: string } {
  const at = valueId.indexOf("::");
  return { setKey: valueId.slice(0, at), code: valueId.slice(at + 2) };
}

/** Where the form's lists are: the project's, or the organization's (its Settings); the page each is shown on. */
type Place = { at: (path: string) => string; values: typeof getSet; here: string };
async function placeOf(formData: FormData): Promise<Place> {
  if (formData.get("level") === "organization") return { at: (path) => `/api/admin${path}`, values: organizationSet, here: "/organization/settings/types" };
  const ctx = await requireScope();
  return { at: (path) => projectPath(ctx, path), values: getSet, here: "/settings/config" };
}

async function putValue(place: Place, setKey: string, body: { code: string; newCode?: string; label?: string; status?: string; sort?: number; props?: unknown; setId?: string }) {
  await api(place.at(`/lists/${encodeURIComponent(setKey)}/values`), { method: "PUT", body });
  // The lists are read through a few-second cache: the person who changed one sees it at once.
  await forgetShortLived();
}

const done = (place: Place) => revalidatePath(place.here);

export async function addValueAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const place = await placeOf(formData);
  const setKey = text(formData, "setKey");
  const code = text(formData, "code");
  const label = text(formData, "label");
  if (!setKey || !code || !label) return { error: "A value has a code and a name." };
  if ((await place.values(setKey)).some((one) => one.code === code)) return { error: `${code} is already in this list.` };
  const props = buildProps(setKey, formData);
  try {
    await putValue(place, setKey, { code, label, props: props ? JSON.parse(props) : undefined, setId: text(formData, "setId") || undefined });
  } catch (e) {
    return failed(e);
  }
  done(place);
  return { ok: `${code} added.` };
}

/** A value's name; while never used, its code and what it does too. */
export async function updateValueAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const place = await placeOf(formData);
  const { setKey, code } = valueRef(text(formData, "valueId"));
  const value = (await place.values(setKey)).find((one) => one.code === code);
  if (!value) return { error: "That value no longer exists." };
  const newCode = text(formData, "code");
  const used = formData.get("used") === "1";
  const props = used ? undefined : buildProps(setKey, formData, JSON.stringify(value.props));
  try {
    await putValue(place, setKey, {
      code, label: text(formData, "label") || value.label,
      ...(newCode && newCode !== code ? { newCode } : {}),
      ...(props === undefined ? {} : { props: props ? JSON.parse(props) : null }),
    });
  } catch (e) {
    return failed(e);
  }
  done(place);
  return {};
}

export async function retireValueAction(formData: FormData) {
  const place = await placeOf(formData);
  const { setKey, code } = valueRef(text(formData, "valueId"));
  const value = (await place.values(setKey)).find((one) => one.code === code);
  if (!value) return;
  await putValue(place, setKey, { code, status: value.status === "RETIRED" ? "ACTIVE" : "RETIRED" }).catch(() => undefined);
  done(place);
}

/** A value never used on the project is deleted; the log keeps it. */
export async function deleteValueAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const place = await placeOf(formData);
  const { setKey, code } = valueRef(text(formData, "valueId"));
  try {
    await api(place.at(`/lists/${encodeURIComponent(setKey)}/values/${encodeURIComponent(code)}`), { method: "DELETE" });
    await forgetShortLived();
  } catch (e) {
    return failed(e);
  }
  done(place);
  return { ok: `${code} deleted.` };
}

export async function moveValueAction(formData: FormData) {
  const place = await placeOf(formData);
  const { setKey, code } = valueRef(text(formData, "valueId"));
  const values = await place.values(setKey);
  const index = values.findIndex((item) => item.code === code);
  const target = text(formData, "direction") === "down" ? index + 1 : index - 1;
  if (index < 0 || target < 0 || target >= values.length) return;
  [values[index], values[target]] = [values[target], values[index]];
  try {
    for (const [sort, item] of values.entries()) await putValue(place, setKey, { code: item.code, sort: sort * 10 });
  } catch {
    // The order is left as it was; the page stays usable.
  }
  done(place);
}

/**
 * What the dock does with the values ticked: retire them, bring them back, delete those never used, or move those never
 * used to another set of the list. Each value is sent as one change; the backend refuses any it may not take.
 */
export async function bulkValuesAction(formData: FormData) {
  const place = await placeOf(formData);
  const op = text(formData, "op");
  if (!["RETIRE", "REACTIVATE", "DELETE", "MOVE"].includes(op)) return;
  const toSet = text(formData, "toSet");
  for (const valueId of formData.getAll("valueIds").map(String).filter(Boolean)) {
    const { setKey, code } = valueRef(valueId);
    if (op === "DELETE") {
      await api(place.at(`/lists/${encodeURIComponent(setKey)}/values/${encodeURIComponent(code)}`), { method: "DELETE" }).catch(() => undefined);
    } else if (op === "MOVE") {
      if (toSet) await putValue(place, setKey, { code, setId: toSet }).catch(() => undefined);
    } else {
      await putValue(place, setKey, { code, status: op === "REACTIVATE" ? "ACTIVE" : "RETIRED" }).catch(() => undefined);
    }
  }
  await forgetShortLived();
  done(place);
}

/** A list of one's own switched off (its values are no longer offered) or on again. */
export async function switchListAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const place = await placeOf(formData);
  const key = text(formData, "key");
  try {
    await api(place.at(`/lists/${encodeURIComponent(key)}`), { method: "PUT", body: { title: text(formData, "title"), active: formData.get("active") === "1" } });
    await forgetShortLived();
  } catch (e) {
    return failed(e);
  }
  done(place);
  return {};
}

export async function createListAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const place = await placeOf(formData);
  const key = text(formData, "key").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const title = text(formData, "title");
  if (!key || !title) return { error: "A list has a name and a short name." };
  try {
    await api(place.at("/lists"), { body: { key, title, description: text(formData, "description") || null, group: text(formData, "group") || null } });
    await forgetShortLived();
  } catch (e) {
    return failed(e);
  }
  revalidatePath(place.here);
  redirect(`${place.here}?set=${encodeURIComponent(key)}`);
}

/** Its name, description and group any time; its short name only while none of its values was used. */
export async function updateListAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const place = await placeOf(formData);
  const key = text(formData, "key");
  const newKey = text(formData, "newKey").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const title = text(formData, "title");
  if (!key || !title) return { error: "A list has a name." };
  let saved = key;
  try {
    saved = (await api<{ key: string }>(place.at(`/lists/${encodeURIComponent(key)}`), {
      method: "PUT",
      body: { title, description: text(formData, "description") || null, group: text(formData, "group") || null, newKey: newKey && newKey !== key ? newKey : null },
    })).key;
    await forgetShortLived();
  } catch (e) {
    return failed(e);
  }
  revalidatePath(place.here);
  redirect(`${place.here}?set=${encodeURIComponent(saved)}`);
}

/** A list none of whose values was ever used on the project is deleted with them; the log keeps it. */
export async function deleteListAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const place = await placeOf(formData);
  const key = text(formData, "key");
  try {
    await api(place.at(`/lists/${encodeURIComponent(key)}`), { method: "DELETE" });
    await forgetShortLived();
  } catch (e) {
    return failed(e);
  }
  revalidatePath(place.here);
  redirect(place.here);
}

// ── Sets ──────────────────────────────────────────────────────────────────

const setsPath = (key: string) => `/lists/${encodeURIComponent(key)}/sets`;
const typesOf = (formData: FormData) => formData.getAll("deliverableTypes").map(String).filter(Boolean);

/** A set of a list: its name and the deliverable types it serves. It opens once made. */
export async function createSetAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const place = await placeOf(formData);
  const key = text(formData, "key");
  const name = text(formData, "name");
  if (!key || !name) return { error: "A set has a name." };
  let id = "";
  try {
    id = (await api<{ id: string }>(place.at(setsPath(key)), { body: { name, deliverableTypes: typesOf(formData) } })).id;
    await forgetShortLived();
  } catch (e) {
    return failed(e);
  }
  revalidatePath(place.here);
  redirect(`${place.here}?set=${encodeURIComponent(key)}&vs=${id}`);
}

/** Its name and the deliverable types it serves. */
export async function updateSetAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const place = await placeOf(formData);
  const key = text(formData, "key");
  const setId = text(formData, "setId");
  const name = text(formData, "name");
  if (!key || !setId || !name) return { error: "A set has a name." };
  try {
    await api(place.at(`${setsPath(key)}/${setId}`), {
      method: "PUT",
      body: { name, ...(formData.get("typesAsked") === "1" ? { deliverableTypes: typesOf(formData) } : {}) },
    });
    await forgetShortLived();
  } catch (e) {
    return failed(e);
  }
  revalidatePath(place.here);
  redirect(`${place.here}?set=${encodeURIComponent(key)}&vs=${setId}`);
}

/** Switched off (its values are no longer offered) or on again. */
export async function switchSetAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const place = await placeOf(formData);
  const key = text(formData, "key");
  const setId = text(formData, "setId");
  try {
    await api(place.at(`${setsPath(key)}/${setId}`), { method: "PUT", body: { name: null, active: formData.get("active") === "1" } });
    await forgetShortLived();
  } catch (e) {
    return failed(e);
  }
  done(place);
  return {};
}

/** A set none of whose values was ever used is deleted with them; the log keeps it. */
export async function deleteSetAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const place = await placeOf(formData);
  const key = text(formData, "key");
  const setId = text(formData, "setId");
  try {
    await api(place.at(`${setsPath(key)}/${setId}`), { method: "DELETE" });
    await forgetShortLived();
  } catch (e) {
    return failed(e);
  }
  revalidatePath(place.here);
  redirect(`${place.here}?set=${encodeURIComponent(key)}`);
}
