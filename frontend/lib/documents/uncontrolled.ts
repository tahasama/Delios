import { api, projectPath } from "@/lib/client";
import type { Scope } from "@/lib/core/scope";

/** How an uncontrolled document came (backend `Documents/Uncontrolled.cs`, worked out on reading, never kept). */
export const UNCONTROLLED_TYPES: { code: string; label: string; said: string }[] = [
  { code: "RECEIVED", label: "Received, not registered", said: "Came on a transmittal; never registered nor matched to one of ours" },
  { code: "KEPT_WITH", label: "Kept with what arrived", said: "Added to something received after it was recorded" },
  { code: "COVERING_LETTER", label: "Covering letter", said: "The letter or email that came with what was received outside the system" },
  { code: "SENT_PROOF", label: "Proof of sending", said: "Proof that something of ours went outside the system" },
  { code: "ANSWER_PROOF", label: "Proof of an answer", said: "Proof of an answer one of ours recorded for another organization" },
  { code: "EMAIL_REPLY", label: "Reply by email, set aside", said: "Came by email in reply to a transmittal; set aside, never recorded" },
  { code: "LIST_FILE", label: "List uploaded", said: "A list file uploaded on the Schedule, kept as the file that was read" },
];

export type UncontrolledRow = {
  fileId: string | null; name: string; size: number | null; type: string; came: string; href: string;
  from: string | null; by: string | null; at: string; note: string | null;
};

/** Every uncontrolled document of the project: our people only, each transmittal's as the reader may open it. */
export const uncontrolled = (scope: Scope) =>
  api<UncontrolledRow[]>(projectPath(scope, "/uncontrolled"), { keep: { areas: ["transmittals", "reviews", "plan"] } });
