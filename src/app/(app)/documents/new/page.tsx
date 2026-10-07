import { api } from "@/lib/api/client";
import type { ListValue } from "@/lib/api/types";
import { requireSession } from "@/lib/session";
import { Banner, PageHeader } from "@/components/ui";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create document" };

/** Registering a document: the backend allocates the number when the form is sent. */
export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ received?: string }> }) {
  const session = await requireSession();
  const received = (await searchParams).received === "1";
  if (!session.can("CREATE") || !session.user.isInternal) {
    return (
      <div>
        <PageHeader title="Create a document" />
        <Banner tone="warn" title={session.user.isInternal ? "Your function cannot register documents" : "Another organization's access"}>
          {session.user.isInternal ? "Document Control can give your function the right to register documents." : "Document Control registers what you owe; you then add its files and revisions."}
        </Banner>
      </div>
    );
  }
  const lists = await api<Record<string, ListValue[]>>("/api/values", {
    query: { sets: "DELIVERABLE_TYPES,DOCUMENT_TYPES,DISCIPLINES,SUBPROJECTS,CRITICALITY,CONFIDENTIALITY,RETENTION_CLASSES" },
  });
  const parties = await api<{ code: string; name: string }[]>("/api/parties");
  return (
    <div>
      <PageHeader title={received ? "Receive a document" : "Create a document"} subtitle="The number is allocated when you finish, from your organization's numbering." />
      <RegisterForm lists={lists} parties={parties} received={received} />
    </div>
  );
}
