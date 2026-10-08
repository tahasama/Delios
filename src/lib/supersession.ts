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

/**
 * Who still holds a replaced revision without having been told.
 *
 * The backend keeps no project-wide answer to this: it would take every
 * transmittal and every document read one at a time. Until it answers it
 * (see docs/gaps/conformance-reports.md), nobody is listed.
 */
export async function untoldRecipients(_t: { projectId: string }): Promise<Untold[]> {
  return [];
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
