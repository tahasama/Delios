"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, refusal } from "@/lib/client";

type State = { error?: string; ok?: string };

/** This browser, turned on for pop-ups: where to push to and the keys it gave. */
export async function subscribePushAction(subscription: { endpoint: string; p256dh: string; auth: string; device: string }): Promise<State> {
  await requireScope();
  try {
    await api("/api/push/subscriptions", { body: subscription });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/notifications");
  return { ok: "Pop-ups are on in this browser." };
}

/** This browser, turned off. */
export async function unsubscribePushAction(endpoint: string): Promise<State> {
  await requireScope();
  try {
    await api("/api/push/subscriptions/remove", { body: { endpoint } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/notifications");
  return { ok: "Pop-ups are off in this browser." };
}

/** Which groups pop up, for this person in every browser: the unticked ones are kept off. */
export async function setPushGroupsAction(_prev: State | undefined, formData: FormData): Promise<State> {
  await requireScope();
  const on = new Set(formData.getAll("on").map(String));
  const off = ["REVIEWS", "DOCUMENTS", "OTHER"].filter((group) => !on.has(group));
  try {
    await api("/api/push/groups", { method: "PUT", body: { off } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/notifications");
  return { ok: "Saved." };
}
