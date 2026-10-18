"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, apiFetch, problemOf, projectPath, refusal } from "@/lib/client";
import { createSession } from "@/lib/core/auth";
import { requireScope, rememberProject } from "@/lib/core/scope";

type Result = { error?: string; ok?: string };
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();
const failed = (e: unknown): Result => ({ error: refusal(e).message });

/** We invite the organization one of our parties stands for, through someone we know there. */
export async function inviteOrganizationAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const partyId = text(formData, "partyId");
  const email = text(formData, "email");
  if (!email) return { error: "Give the email of someone you know there." };
  try {
    await api(`/api/admin/parties/${partyId}/link`, { body: { email } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/settings/parties");
  revalidatePath("/organization");
  return { ok: "Invited. Their administrator accepts or refuses it on their organization's page." };
}

/** Their administrator (us) accepts an invitation to work on another organization's projects. */
export async function acceptLinkAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    await api(`/api/organization/links/${text(formData, "linkId")}/accept`, { body: { note: text(formData, "note") || null } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  revalidatePath("/");
  return { ok: "Accepted. Their projects we take part in now appear under Projects." };
}

/** We refuse an invitation, saying why. */
export async function refuseLinkAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const note = text(formData, "note");
  if (!note) return { error: "Say why: they read it." };
  try {
    await api(`/api/organization/links/${text(formData, "linkId")}/refuse`, { body: { note } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  revalidatePath("/");
  return {};
}

/** Either side ends a link (or takes back an invitation not answered yet), saying why. */
export async function endLinkAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const note = text(formData, "note");
  if (!note) return { error: "Say why it ends: the other organization reads it." };
  try {
    await api(`/api/organization/links/${text(formData, "linkId")}/end`, { body: { note } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  revalidatePath("/settings/parties");
  return { ok: "Ended. Their accounts on our projects (or ours on theirs) have stopped." };
}

/** Our administrator puts one of our people on a project of another organization's, or takes them off. */
export async function joinPersonAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const linkId = text(formData, "linkId");
  const projectId = text(formData, "projectId");
  const userId = text(formData, "userId");
  if (!userId) return { error: "Choose someone of ours." };
  try {
    await api(`/api/organization/joined/${linkId}/projects/${projectId}/people`, {
      method: "PUT", body: { userId, active: text(formData, "active") !== "off" },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  return {};
}

/** the control function says an organization takes part in this project (or no longer does), its role, and its people's starting function. */
export async function setProjectOrganizationAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const partyId = text(formData, "partyId");
  if (!partyId) return { error: "Choose the organization." };
  const contactId = text(formData, "contactId") || null;
  const backupId = text(formData, "backupId") || null;
  if (contactId && backupId && contactId === backupId) return { error: "The backup has to be someone other than the person who answers." };
  try {
    await api(projectPath(ctx, `/organizations/${partyId}`), {
      method: "PUT",
      body: {
        role: text(formData, "role") || null, startFunctionId: text(formData, "startFunctionId") || null, active: text(formData, "active") !== "off",
        // The contract between us and them: unique across DELIOS, changed once at most (a fixed one is shown, not sent).
        contractNumber: text(formData, "contractNumber") || null,
      },
    });
  } catch (e) {
    return failed(e);
  }
  // Who of theirs answers for it on this project: optional, never a reason a save fails.
  if (formData.get("answers") === "1") {
    const { setProjectSetting } = await import("@/lib/settings/api");
    const { PARTY_KEY } = await import("@/lib/settings/api-admin");
    await setProjectSetting(ctx.projectId, PARTY_KEY + partyId, contactId || backupId ? JSON.stringify({ contactId, backupId }) : null).catch(() => undefined);
  }
  revalidatePath("/settings/parties");
  return { ok: "Saved." };
}

/**
 * Opens a project of another organization's (or goes back home): the backend moves the session onto the account
 * standing for this person there, with the same sign-in. Then that project opens.
 */
export async function switchOrganizationAction(formData: FormData): Promise<void> {
  const tenantId = text(formData, "tenantId");
  const projectId = text(formData, "projectId");
  const response = await apiFetch("/api/auth/switch", { method: "POST", body: { tenantId } });
  if (!response.ok) {
    const problem = await problemOf(response);
    redirect(`/?switchRefused=${encodeURIComponent(problem.message)}`);
  }
  const token = response.headers.getSetCookie().find((c) => c.startsWith("delios_session="))?.slice("delios_session=".length).split(";")[0];
  if (!token) redirect("/login");
  await createSession(token);
  if (projectId) await rememberProject(projectId);
  revalidatePath("/", "layout");
  redirect("/");
}

/** The administrator makes one of our projects' choices (who does what, how it works) the defaults for projects opened afterwards. */
export async function makeDefaultsAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const { requireOrgAdmin } = await import("@/lib/core/org-scope");
  const { defaultsFrom, DEFAULTS_KEY } = await import("@/lib/organization/defaults");
  const { setOrgSetting } = await import("@/lib/settings/api");
  const { adminProjects } = await import("@/lib/settings/api-admin");
  const scope = await requireOrgAdmin();
  const projectId = text(formData, "projectId");
  const project = (await adminProjects().catch(() => [])).find((one) => one.id === projectId);
  if (!project) return { error: "Choose one of our projects." };
  try {
    const values = await defaultsFrom(projectId);
    await setOrgSetting(DEFAULTS_KEY, JSON.stringify({ fromProject: project.code, at: new Date().toISOString(), by: scope.user.name, values }));
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  revalidatePath("/organization/defaults");
  return { ok: `New projects now start with ${project.code}'s choices. Projects already open keep theirs.` };
}

/** A guest account another organization made for one of our people becomes theirs here: same email, same password. */
export async function bringOverAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    await api(`/api/organization/joined/${text(formData, "linkId")}/guests/${text(formData, "guestId")}/bring`, { body: {} });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  return { ok: "Brought over. They sign in here from now on, with the same password, and keep their projects there." };
}

/** The defaults for new projects are forgotten: a project opened afterwards starts with the app's own. */
export async function resetDefaultsAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  const { requireOrgAdmin } = await import("@/lib/core/org-scope");
  const { DEFAULTS_KEY } = await import("@/lib/organization/defaults");
  const { setOrgSetting } = await import("@/lib/settings/api");
  await requireOrgAdmin();
  try {
    await setOrgSetting(DEFAULTS_KEY, null);
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  revalidatePath("/organization/defaults");
  return { ok: "Back on the app's own defaults. Projects already open keep theirs." };
}

/**
 * What is kept about people's activity, for the whole organization (`TRACK_READING`, `TRACK_SIGN_INS`): reading
 * (a document opened, a file downloaded) kept or not; sign-ins shown on a person's activity or not. Acts on
 * documents are always kept. An administrator only (the backend refuses anyone else).
 */
export async function setTrackingAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const reading = text(formData, "reading");
  const signIns = text(formData, "signIns");
  if (!["ON", "OFF"].includes(reading) || !["ON", "OFF"].includes(signIns)) return { error: "Answer both questions." };
  try {
    await api(`/api/settings/TRACK_READING`, { method: "PUT", body: { value: reading } });
    await api(`/api/settings/TRACK_SIGN_INS`, { method: "PUT", body: { value: signIns } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  revalidatePath("/settings/flow");
  return { ok: "Saved: it applies from now on, on every project." };
}

/** Our identifier, with its country (changed once at most), or why we have none. */
export async function saveOwnIdentityAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const none = formData.get("none") === "on";
  try {
    await api("/api/organization/identity", {
      method: "PUT",
      body: none
        ? { noIdentifierReason: text(formData, "noIdentifierReason") || null }
        : { country: text(formData, "country") || null, identifierKind: text(formData, "identifierKind") || null, identifierNumber: text(formData, "identifierNumber") || null },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  return { ok: "Saved." };
}

/** A link to an address of ours at our domain: opening it proves the domain is ours. */
export async function sendDomainLinkAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const email = text(formData, "email");
  try {
    await api("/api/organization/domain", { body: { email } });
  } catch (e) {
    return failed(e);
  }
  return { ok: `A link went to ${email}: opening it there proves the domain is ours (two days).` };
}

/** The link opened: the domain is ours. Anyone holding the link may open it; the link is the proof. */
export async function confirmDomainAction(_prev: { error?: string; done?: string } | undefined, formData: FormData): Promise<{ error?: string; done?: string }> {
  const response = await apiFetch("/api/auth/confirm-domain", { method: "POST", body: { token: text(formData, "token") } }).catch(() => null);
  if (!response) return { error: "The server cannot be reached. Try again in a moment." };
  if (response.status === 429) return { error: "Too many attempts. Wait a minute and try again." };
  if (!response.ok) return { error: (await problemOf(response)).message };
  const said = (await response.json()) as { domain: string; organization: string };
  return { done: `${said.domain} is ${said.organization}'s, proven.` };
}

/** That entry, made by another organization, is us: it becomes our organization. */
export async function claimAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  try {
    await api(`/api/organization/claims/${text(formData, "identityId")}`, { method: "POST" });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  return { ok: "Asked. The guest who stood for it confirms by email, or the organization that recorded it vouches; until then nothing passes." };
}

/** We agree that two organizations are one, or refuse with why. */
export async function answerMergeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const id = text(formData, "mergeId");
  const agree = text(formData, "answer") === "agree";
  const note = text(formData, "note");
  if (!agree && !note) return { error: "Say why they are not one organization." };
  try {
    await api(`/api/organization/merges/${id}/${agree ? "agree" : "refuse"}`, { method: "POST", body: agree ? {} : { note } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  return { ok: agree ? "Agreed. Once every side has, the app's owner merges them." : "Refused: they stay two." };
}

/** We recorded the entry: we vouch that the claimer is it, or refuse with why. */
export async function answerClaimAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const id = text(formData, "claimId");
  const vouch = text(formData, "answer") === "vouch";
  const note = text(formData, "note");
  if (!vouch && !note) return { error: "Say why it is not them." };
  try {
    await api(`/api/organization/claims/incoming/${id}/${vouch ? "vouch" : "refuse"}`, { method: "POST", body: vouch ? {} : { note } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/organization");
  return { ok: vouch ? "Vouched: it is them now." : "Refused: nothing passes." };
}

/** The guest who stood for the entry opened the link: the claim is confirmed. */
export async function confirmClaimAction(_prev: { error?: string; done?: string } | undefined, formData: FormData): Promise<{ error?: string; done?: string }> {
  const response = await apiFetch("/api/auth/confirm-claim", { method: "POST", body: { token: text(formData, "token") } }).catch(() => null);
  if (!response) return { error: "The server cannot be reached. Try again in a moment." };
  if (response.status === 429) return { error: "Too many attempts. Wait a minute and try again." };
  if (!response.ok) return { error: (await problemOf(response)).message };
  const said = (await response.json()) as { organization: string };
  return { done: `Confirmed: ${said.organization} is the organization you stood for.` };
}

/** An administrator moves one switch of what projects may change (Fixed or Free). Projects' copies already made stay. */
export async function setLibertyAction(formData: FormData): Promise<void> {
  const key = text(formData, "key");
  if (!key) return;
  await api(`/api/liberty/${encodeURIComponent(key)}`, { method: "PUT", body: { free: text(formData, "free") === "1" } }).catch(() => undefined);
  revalidatePath("/organization/settings", "layout");
  revalidatePath("/organization");
}
