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
  api<OrganizationLink[]>("/api/organization/links").catch(() => []));

/** The projects of other organizations' that we take part in. Administrators only; empty for anyone else. */
export const joinedProjects = cache(async (): Promise<JoinedProject[]> =>
  api<JoinedProject[]>("/api/organization/joined").catch(() => []));

/** The organizations taking part in one of our projects. */
export const projectOrganizations = cache(async (scope: { projectId: string }): Promise<ProjectOrganization[]> =>
  api<ProjectOrganization[]>(projectPath(scope, "/organizations")).catch(() => []));

/** Where the signed-in person can switch to: other organizations' projects they are on, or home. */
export const elsewhere = cache(async (): Promise<Elsewhere[]> => api<Elsewhere[]>("/api/me/elsewhere").catch(() => []));

/** The guest accounts another organization made for our people before we linked, not yet brought over. */
export const guestAccounts = cache(async (linkId: string): Promise<{ id: string; name: string; email: string; active: boolean }[]> =>
  api<{ id: string; name: string; email: string; active: boolean }[]>(`/api/organization/joined/${linkId}/guests`).catch(() => []));
