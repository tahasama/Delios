import "server-only";
import { cache } from "react";
import { api, projectPath } from "@/lib/client";
import type { RevisionSeries } from "@/lib/settings/api-admin";

/**
 * What the document management plan is written from that only the keepers read elsewhere, gathered by the backend for
 * everyone of ours on the project (`GET /api/projects/{id}/plan`, `PlanEndpoints`): numbering, how revisions are named,
 * the review routes with who answers each step, the functions with what they may do and who holds them here.
 */
export type ProjectPlan = {
  numbering: { name: string; delimiter: string; fields: { label: string; source: string; value: string | null; digits: number | null }[]; deliverableTypes: string[] }[];
  revisions: { name: string; isDefault: boolean; forwardOnly: boolean; series: RevisionSeries[]; deliverableTypes: string[] }[];
  routes: {
    name: string; description: string | null; isDefault: boolean; verdictSet: string;
    patterns: { deliverableType: string | null; docType: string | null; discipline: string | null; criticality: string | null; originator: string | null }[];
    steps: { title: string; functionCode: string | null; partyCode: string | null; reason: string | null; mode: string; days: number | null; grantsStatuses: string[]; people: string[]; holders: string[] }[];
  }[];
  functions: {
    code: string; name: string; clearance: string | null;
    rows: { verbs: string[]; deliverableType: string | null; docType: string | null; discipline: string | null; criticality: string | null; confidentiality: string | null; note: string | null }[];
    holders: { name: string; department: string | null }[];
  }[];
  control: string[];
  departments: string[];
};

export const projectPlan = cache(async (scope: { projectId: string }): Promise<ProjectPlan> =>
  api<ProjectPlan>(projectPath(scope, "/plan")));
