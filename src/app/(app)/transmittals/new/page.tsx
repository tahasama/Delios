import { api } from "@/lib/api/client";
import type { Addressees, ListValue, RegisterPage } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { LISTS } from "@/lib/lists";
import { Banner, PageHeader } from "@/components/ui";
import { ComposeForm } from "./compose-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New transmittal" };

/**
 * Composing a transmittal: released revisions (the ones chosen in the
 * register, or any released one), who it goes to, why, and a message. It is
 * numbered and sent when the form is submitted; one goes to our own people
 * chosen, and one to each outside organization.
 */
export default async function NewTransmittalPage({ searchParams }: { searchParams: Promise<{ docs?: string }> }) {
  const session = await requireSession();
  if (!(session.can("CONTROL") || session.can("TRANSMIT")) || !session.user.isInternal) {
    return <div><PageHeader title="New transmittal" /><Banner tone="warn" title="Your function does not issue transmittals">Ask for a document to be issued from its page; Document Control sends it.</Banner></div>;
  }
  const docs = (await searchParams).docs ?? "";
  const [register, addressees, lists] = await Promise.all([
    api<RegisterPage>(projectPath(session, "/register"), { query: { released: true, ids: docs || undefined, per: 250, sort: "docNumber", dir: "asc" } }),
    api<Addressees>(projectPath(session, "/addressees")),
    api<Record<string, ListValue[]>>("/api/values", { query: { sets: LISTS.reasonsForIssue } }),
  ]);
  const items = register.rows.filter((r) => r.releasedRevisionId).map((r) => ({
    revisionId: r.releasedRevisionId!, number: r.number, title: r.title, revision: r.releasedRevision ?? "", status: r.releasedStatus,
  }));
  return (
    <div>
      <PageHeader title="New transmittal" subtitle="Released revisions only. The number is allocated when you send it." />
      <ComposeForm items={items} preselected={!!docs} addressees={addressees}
        reasons={(lists[LISTS.reasonsForIssue] ?? []).filter((r) => r.status === "ACTIVE").map((r) => ({ code: r.code, label: r.label, answer: r.props?.response === true }))} />
    </div>
  );
}
