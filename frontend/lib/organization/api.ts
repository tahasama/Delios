import "server-only";
import { cache } from "react";
import { api, projectPath } from "@/lib/client";

/**
 * Organizations working together (docs/ORGANIZATIONS.md), as the screens read them: the links between our
 * organization and others, the projects of others we take part in, the organizations taking part in one of ours,
 * and the other organizations the signed-in person can switch into.
 */

/** A link between two organizations. `side`: HOST when we invited them (they work on our projects), GUEST when they invited us. */
export type OrganizationLink = {
  id: string; side: "HOST" | "GUEST"; organization: string; otherTenantId: string; partyId: string | null; partyCode: string; partyName: string;
  state: "INVITED" | "LINKED" | "REFUSED" | "ENDED"; invitedEmail: string; invitedAt: string; invitedBy: string;
  answeredAt: string | null; answeredBy: string | null; answerNote: string | null;
  endedAt: string | null; endedBy: string | null; endedBySide: "HOST" | "GUEST" | null; endReason: string | null;
};

/** A project of another organization's that we take part in, with our people on it. */
export type JoinedProject = {
  linkId: string; hostTenantId: string; hostOrganization: string; projectId: string; code: string; name: string; status: string;
  role: string | null; startFunction: string | null; ourPeople: { userId: string; name: string; function: string; active: boolean }[];
};

/** An organization taking part in one of our projects. `kind`: COLLABORATOR, GUEST or NOT_ON_DELIOS. */
export type ProjectOrganization = {
  partyId: string; code: string; name: string; kind: "COLLABORATOR" | "GUEST" | "NOT_ON_DELIOS"; linkedOrganization: string | null;
  role: string | null; startFunctionId: string | null; startFunction: string | null; active: boolean; people: number;
  /** The contract between the project's organization and this one; changed once at most. */
  contractNumber?: string | null; previousContractNumber?: string | null; contractChangedByName?: string | null; contractChangedAt?: string | null;
};

/** Another organization the signed-in person can switch into (or back home), with their projects there. */
export type Elsewhere = { tenantId: string; organization: string; home: boolean; projects: { id: string; code: string; name: string }[] };

/** Our links with other organizations, both ways. Administrators only; empty for anyone else. */
export const organizationLinks = cache(async (): Promise<OrganizationLink[]> =>
  api<OrganizationLink[]>("/api/organization/links", { keep: { areas: [] } }).catch(() => []));

/** The projects of other organizations' that we take part in. Administrators only; empty for anyone else. */
export const joinedProjects = cache(async (): Promise<JoinedProject[]> =>
  api<JoinedProject[]>("/api/organization/joined", { keep: { areas: [] } }).catch(() => []));

/** The organizations taking part in one of our projects. */
export const projectOrganizations = cache(async (scope: { projectId: string }): Promise<ProjectOrganization[]> =>
  api<ProjectOrganization[]>(projectPath(scope, "/organizations"), { keep: { areas: [] } }).catch(() => []));

/** Where the signed-in person can switch to: other organizations' projects they are on, or home. */
export const elsewhere = cache(async (): Promise<Elsewhere[]> => api<Elsewhere[]>("/api/me/elsewhere", { keep: { areas: [] } }).catch(() => []));

/** The guest accounts another organization made for our people before we linked, not yet brought over. */
export const guestAccounts = cache(async (linkId: string): Promise<{ id: string; name: string; email: string; active: boolean }[]> =>
  api<{ id: string; name: string; email: string; active: boolean }[]>(`/api/organization/joined/${linkId}/guests`, { keep: { areas: [] } }).catch(() => []));

/** Our own organization as DELIOS knows it: its identifier (or why none) and the email domain it proved. */
export type OwnIdentity = {
  id: string; code: string; name: string; country: string | null; kind: string | null; number: string | null; noIdentifierReason: string | null;
  identifierWas: { was: string; by: string; at: string } | null; domain: string | null; domainConfirmedAt: string | null;
};
export const ownIdentity = cache(async (): Promise<OwnIdentity | null> => api<OwnIdentity>("/api/organization/identity", { keep: { areas: [] } }).catch(() => null));

/** Entries other organizations made for us before we came onto DELIOS, at the domain we proved: each can be claimed. */
export type Claims = {
  /** Entries others made that look like us, each with where our claim on it stands. */
  candidates: { id: string; code: string; name: string; why: string;
    claim: { id: string; state: "WAITING" | "CONFIRMED" | "REFUSED"; method: "GUEST_EMAIL" | "VOUCH"; sentTo: string | null; refusedWhy: string | null } | null }[];
  /** Claims on entries we made, waiting for us to vouch. */
  incoming: { id: string; claimedByName: string; createdAt: string;
    entry: { code: string; name: string } | null; claimer: { code: string; name: string; identifier: string | null; domain: string | null } | null }[];
};
export const claims = cache(async (): Promise<Claims> => api<Claims>("/api/organization/claims", { keep: { areas: [] } }).catch(() => ({ candidates: [], incoming: [] })));

/** Merges asked by us or waiting on us. */
export type MergeView = {
  id: string; state: "ASKED" | "AGREED" | "REFUSED" | "DONE"; why: string; requestedByName: string; requestedAt: string; ours: boolean;
  keep: { code: string; name: string }; merge: { code: string; name: string }; waitsOnUs: boolean;
  refusedByName: string | null; refusedWhy: string | null; doneAt: string | null;
};
export const merges = cache(async (): Promise<MergeView[]> => api<MergeView[]>("/api/organization/merges", { keep: { areas: [] } }).catch(() => []));
