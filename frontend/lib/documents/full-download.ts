import { api } from "@/lib/client";

/** A full download asked by the person signed in (backend Documents/FullDownload.cs), read fresh: it changes on its own. */
export type FullDownloadRow = {
  id: string;
  projectId: string | null;
  scope: string;
  requestedAt: string;
  layout: "TREE" | "LEVELS" | "FLAT";
  levels: string[];
  withRegister: boolean;
  withReviews: boolean;
  withTransmittals: boolean;
  withAudit: boolean;
  documents: number;
  leftOut: string[];
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "REPLACED";
  finishedAt: string | null;
  size: number | null;
  fileCount: number | null;
  error: string | null;
};

export const fullDownloads = () => api<FullDownloadRow[]>("/api/full-downloads");

export { LEVELS } from "./full-download-levels";
