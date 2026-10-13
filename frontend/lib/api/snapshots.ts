import "server-only";
import { api, projectPath } from "./client";
import type { DocumentView } from "./types";
import type { DocumentSnapshotPayload } from "../history";

type Scope = { projectId: string };
type BackendSnapshot = {
  id: string; revisionId: string | null; capturedAt: string; eventType: string; eventLabel: string | null; actorName: string;
  document: DocumentView;
};

/** The backend's document, at one recorded point, in the shape the history screen reads. */
function payloadOf(doc: DocumentView): DocumentSnapshotPayload {
  return {
    document: {
      id: doc.id, docNumber: doc.number, title: doc.title, state: doc.state, kind: doc.kind, deliverableType: doc.deliverableType,
      docType: doc.docType, discipline: doc.discipline, originator: doc.originator, subProject: doc.subproject, contractRef: doc.contractRef,
      criticality: doc.criticality, confidentiality: doc.confidentiality, retentionClass: doc.retentionClass, isPlaceholder: doc.isPlaceholder,
      previousId: doc.previousNumber ?? null, legacyScheme: doc.legacyScheme ?? null, createdDate: doc.createdAt, receivedDate: doc.receivedDate,
      updatedAt: doc.updatedAt,
      revisions: doc.revisions.map((r) => ({
        id: r.id, value: r.value, series: r.series, state: r.state, statusCode: r.statusCode, phase: null, reasonForRevision: r.reasonForRevision,
        changeDescription: r.changeDescription, plannedSubmissionDate: null, issueDate: null, releasedAt: r.releasedAt, releasedByName: r.releasedByName,
        createdAt: r.createdAt,
        files: r.files.filter((f) => f.submission === r.submission).map((f) => ({
          id: f.id, name: f.name, kind: f.kind, mime: f.contentType, size: f.size, sha256: f.sha256, uploadedByName: r.authoredByName, createdAt: f.createdAt,
        })),
        approvals: [], cycles: [], workflowRuns: [], transmittalItems: [], copies: [],
      })),
      baselineEntries: [], packageMembers: [],
    },
    relationships: [],
  };
}

/** Every recorded point of a document, oldest first, as the history page lists them. */
export async function documentSnapshots(scope: Scope, documentId: string) {
  const rows = await api<BackendSnapshot[]>(projectPath(scope, `/documents/${documentId}/snapshots`)).catch(() => [] as BackendSnapshot[]);
  return rows.map((row) => ({
    id: row.id, payload: JSON.stringify(payloadOf(row.document)), revisionId: row.revisionId, capturedAt: new Date(row.capturedAt),
    eventType: row.eventType, eventLabel: row.eventLabel, actorName: row.actorName as string | null,
  }));
}
