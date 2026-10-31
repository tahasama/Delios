import { api, projectPath } from "@/lib/client";
import type { Scope } from "@/lib/core/scope";
import { documentReaders, projectReaders } from "@/lib/documents/api-readers";
import { AlsoKnownAs, type Equivalent } from "./numbers";
import { ReadersPanel } from "./readers-panel";

/**
 * The document page's side reads, each on its own (owner, the ten states: "a tab or panel that loads on its own"): the
 * page stands while they read, and one failing says so in its place (`Part`), never read as "no other number" or "nobody
 * named".
 */
export async function OtherNumbers({ ctx, documentId, mayKeep }: { ctx: Scope; documentId: string; mayKeep: boolean }) {
  const numbers = await api<Equivalent[]>(projectPath(ctx, `/documents/${documentId}/numbers`), { keep: { areas: ["docs"], doc: documentId } });
  return <AlsoKnownAs documentId={documentId} numbers={numbers} mayKeep={mayKeep} />;
}

export async function WhoMayRead({ ctx, documentId, createdById, confidentiality, mayName, answerable }: {
  ctx: Scope; documentId: string; createdById: string | null; confidentiality: string; mayName: boolean; answerable: string[];
}) {
  const [named, people] = await Promise.all([documentReaders(ctx, documentId), projectReaders(ctx)]);
  return (
    <ReadersPanel
      documentId={documentId}
      confidentiality={confidentiality}
      readers={named.map((row) => ({ id: row.id, name: row.user.name, addedByName: row.addedByName, reason: row.reason, at: row.createdAt }))}
      candidates={people
        .filter((one) => !named.some((row) => row.userId === one.user.id) && one.user.id !== createdById)
        .map((one) => ({ id: one.user.id, name: one.user.name, functionName: one.function?.name ?? null }))}
      mayName={mayName}
      answerable={answerable}
    />
  );
}
