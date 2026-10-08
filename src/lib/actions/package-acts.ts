"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, refusal } from "@/lib/api/client";
import { requireSession, projectPath } from "@/lib/session";
import type { ActResult } from "./document-acts";

/**
 * Packages, through the backend: creating one, adding and taking out
 * documents, its rule, checking readiness, what is missing, delivering and
 * accepting it.
 */

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim() || null;
const all = (form: FormData, name: string) => form.getAll(name).map(String).filter(Boolean);

const rule = (form: FormData) => ({
  deliverableTypes: all(form, "ruleDeliverableTypes"), disciplines: all(form, "ruleDisciplines"),
  docTypes: all(form, "ruleDocTypes"), originators: all(form, "ruleOriginators"),
});

export type CreateState = { error?: string };

/** Creates a package and opens it. */
export async function createPackageAction(_prev: CreateState | undefined, form: FormData): Promise<CreateState> {
  const session = await requireSession();
  let id: string;
  try {
    const made = await api<{ id: string }>(projectPath(session, "/packages"), {
      body: {
        title: text(form, "title"), reason: text(form, "reason"), requiredStatuses: all(form, "requiredStatus"),
        ownerIds: all(form, "ownerId"), acceptorIds: all(form, "acceptorId"), recipientPartyIds: all(form, "partyId"),
        description: text(form, "description"), completionDate: text(form, "completionDate"), rule: rule(form),
      },
      idempotencyKey: text(form, "formKey") ?? undefined,
    });
    id = made.id;
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/packages");
  redirect(`/packages/${id}`);
}

/** Adds the documents chosen in the register to a package, then opens it. */
export async function addToPackageAction(_prev: CreateState | undefined, form: FormData): Promise<CreateState> {
  const session = await requireSession();
  const id = String(form.get("packageId") ?? "");
  if (!id) return { error: "Choose a package." };
  try {
    await api(projectPath(session, `/packages/${id}/members`), {
      body: { documentIds: all(form, "documentId"), requiredStatuses: all(form, "requiredStatus") },
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/packages/${id}`);
  redirect(`/packages/${id}`);
}

const SAID: Record<string, string> = {
  add: "Added.", remove: "Taken out.", rule: "Rule saved.", assess: "Readiness checked.",
  "shortfall-issue": "Sent to the acceptance authority.", "shortfall-accept": "Accepted; it may be delivered.",
  deliver: "Delivered.", accept: "Accepted.",
};

/** Every step on a package's page; the form says which in `what`. */
export async function packageAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  const session = await requireSession();
  const id = String(form.get("packageId"));
  const what = String(form.get("what"));
  const at = (rest: string) => projectPath(session, `/packages/${id}${rest}`);
  const note = { note: text(form, "note") };
  try {
    switch (what) {
      case "add": await api(at("/members"), { body: { documentIds: all(form, "documentId"), requiredStatuses: all(form, "requiredStatus") } }); break;
      case "remove": await api(at("/members/remove"), { body: { documentIds: all(form, "documentId") } }); break;
      case "rule": await api(at("/rule"), { method: "PUT", body: rule(form) }); break;
      case "assess": await api(at("/assess"), { body: {} }); break;
      case "shortfall-issue": await api(at("/shortfall/issue"), { body: {} }); break;
      case "shortfall-accept": await api(at("/shortfall/accept"), { body: note }); break;
      case "deliver": await api(at("/deliver"), { body: { ruleCeased: form.get("ruleCeased") === "on", note: text(form, "note") } }); break;
      case "accept": await api(at("/accept"), { body: note }); break;
      default: return { ok: false, message: "Unknown step." };
    }
  } catch (e) {
    return { ok: false, message: refusal(e).message };
  }
  revalidatePath(`/packages/${id}`);
  revalidatePath("/packages");
  return { ok: true, message: SAID[what] };
}
