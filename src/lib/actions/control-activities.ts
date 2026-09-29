"use server";

import { revalidatePath } from "next/cache";
import { requireAdminScope } from "@/lib/scope";
import { audit } from "@/lib/audit";
import {
  CONTROL_ACTIVITIES,
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

type State = { error?: string; message?: string };

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
  revalidatePath("/admin/control");
  if (!changed) return { message: "Nothing changed." };
  return {
    message: asked === "CUSTOM"
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
  revalidatePath("/admin/control");
  if (!changed.length) return { message: "Nothing changed." };
  return { message: `Saved: ${changed.join("; ")}.` };
}

/** One act, changed on its own while the project is on "it depends". */
export async function setOneControlActivityAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const key = String(formData.get("key") ?? "");
  const value = String(formData.get("mode") ?? "") as ControlMode;
  const activity = CONTROL_ACTIVITIES.find((one) => one.key === key);
  if (!activity) return { error: "That is not one of the acts." };
  if (!ACT_MODES.includes(value)) return { error: "Choose who carries it out." };
  await put(PROJECT_KEY, "CUSTOM", "Who carries out the acts of document control");
  const changed = await put(key, value, activity.title);
  revalidatePath("/admin/control");
  return { message: changed ? `${activity.title}: ${MODE_LABEL[value].toLowerCase()}.` : "Nothing changed." };
}
