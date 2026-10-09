/**
 * §12.3 — when a revision is replaced, everyone who received it must be told.
 *
 * Who received it is read from the issued transmittals that carried it. A
 * recipient counts as told when:
 *   - they have an account here: the release notified them in the app;
 *   - they were sent the current revision (or anything later) by transmittal.
 * Nothing said outside the system counts: controlled information and its
 * replacement travel only through it.
 * Whoever is left is who still holds an out-of-date revision without knowing.
 */
import { api, projectPath } from "@/lib/api/client";

export type Recipient = { key: string; name: string; organization: string | null; userId: string | null; via: string };
export type Untold = {
  document: { id: string; docNumber: string; title: string };
  old: { id: string; value: string; supersededAt: Date | null };
  current: { id: string; value: string; statusCode: string | null } | null;
  recipients: Recipient[];
  /** The reason the old revision was issued for — the new one goes for the same reason. */
  reason: string | null;
  /** A transmittal already prepared to send the current revision, not issued yet. */
  draft: { id: string; number: string } | null;
};

type UntoldRow = {
  documentId: string; documentNumber: string; title: string; oldRevisionId: string; oldValue: string; supersededAt: string | null;
  current: { id: string; value: string; statusCode: string | null } | null; reason: string | null;
  recipients: { key: string; name: string; organization: string | null; userId: string | null; via: string }[];
};

/**
 * Who still holds a replaced revision without having been told, as the
 * backend works it out (GET /exposures/untold). A transmittal prepared and
 * not issued is not looked for: drafts are kept apart until issued.
 */
export async function untoldRecipients(t: { projectId: string }): Promise<Untold[]> {
  const rows = await api<UntoldRow[]>(projectPath(t, "/exposures/untold")).catch(() => [] as UntoldRow[]);
  return rows.map((row) => ({
    document: { id: row.documentId, docNumber: row.documentNumber, title: row.title },
    old: { id: row.oldRevisionId, value: row.oldValue, supersededAt: row.supersededAt ? new Date(row.supersededAt) : null },
    current: row.current,
    recipients: row.recipients,
    reason: row.reason,
    draft: null,
  }));
}

/**
 * The new-transmittal form, filled in to send the current revision to whoever
 * still holds the old one. The sender can change anything before creating it.
 */
export function sendCurrentLink(u: Untold): string | null {
  if (!u.current) return null;
  const companies = [...new Set(u.recipients.map((r) => r.organization).filter(Boolean))] as string[];
  const p = new URLSearchParams({
    revisions: u.current.id,
    to: u.recipients.map((r) => (r.organization ? `${r.name} (${r.organization})` : r.name)).join("\n"),
    party: companies.join(", "),
    subject: `${u.document.docNumber} — rev ${u.current.value} replaces rev ${u.old.value}`,
    message: `Please find enclosed rev ${u.current.value} of ${u.document.docNumber} (${u.document.title}). It replaces rev ${u.old.value}, which you received on ${[...new Set(u.recipients.map((r) => r.via))].join(", ")}. Stop using rev ${u.old.value} and discard any copy of it.`,
  });
  if (u.reason) p.set("reason", u.reason);
  return `/transmittals/new?${p}`;
}
