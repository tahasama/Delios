import { deferred, deferredActions } from "./restate-defer";
import { db } from "./db";

/**
 * Tenancy primitives, free of any request context so that seeds, importers and
 * batch jobs can build a tenant explicitly.
 *
 * Two tenancy axes (see the Tenancy block in schema.prisma):
 *   orgId     — published configuration: value sets, schemes, parties, people
 *   projectId — the register: documents, revisions, and every record about them
 *
 * `scope.db` is a Prisma client that injects the current tenancy key into every
 * read and every write. Application code must never reach for the bare `db`
 * import for a tenant-scoped model; if a query needs to cross projects it has
 * to say so explicitly via `crossProject()`, which is auditable by grep.
 */

// ── Model classification ─────────────────────────────────────────────────────

export const ORG_SCOPED = new Set([
  "User",
  "Party",
  "ConfigSet",
  "ConfigValue",
  "Scheme",
  "SchemeRouting",
  "AuthorityRow",
  "WorkflowTemplate",
  "SpineLink",
  "SpineBaseline",
  "ControlledSet",
  "Function",
  "PermissionRule",
]);

export const PROJECT_SCOPED = new Set([
  "Delegation",
  "IssueRequest",
  "ControlSetting",
  "DocumentAccess",
  "ActionNote",
  "RegisterView",
  "NumberCounter",
  "Document",
  "Revision",
  "DocumentSnapshot",
  "Approval",
  "ReviewCycle",
  "ReviewAssignment",
  "ReviewComment",
  "Transmittal",
  "TransmittalItem",
  "TransmittalRecipient",
  "RegisteredCopy",
  "Action",
  "BaselineEntry",
  "ScheduleVersion",
  "ScheduleActivity",
  "Package",
  "PackageMember",
  "Relationship",
  "AssetItem",
  "StoredFile",
  "AuditEvent",
  "Defect",
  "CheckRun",
  "CheckRunItem",
  "Notification",
  "ObsolescenceRecord",
  "ExceptionEntry",
  "DistributionRule",
  "NumberRange",
  "WorkflowRun",
  "ScopeConfig",
  "RequirementCall",
  "SenderIssue",
  "ReadinessConfirmation",
]);

// Operations whose `where` selects existing rows.
const READ_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

// Operations that write a new row and therefore need the key in `data`.
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);

// Operations that both select and (may) write.
const UPSERT_OPS = new Set(["upsert"]);

// Single-row mutations: scope the `where`, but a composite-id `where` cannot
// take an extra key, so these are narrowed by a pre-check instead.
const SINGLE_WRITE_OPS = new Set(["update", "delete"]);

// ── The scoped client ────────────────────────────────────────────────────────

function keyFor(model: string | undefined): "orgId" | "projectId" | null {
  if (!model) return null;
  if (PROJECT_SCOPED.has(model)) return "projectId";
  if (ORG_SCOPED.has(model)) return "orgId";
  return null;
}

function injectData(data: unknown, key: string, value: string): unknown {
  if (Array.isArray(data)) return data.map((d) => injectData(d, key, value));
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    // Clamp, don't default. A scoped client can only ever write into its own
    // tenant, the same way it can only ever read from it — so a stray or
    // attacker-supplied projectId cannot redirect a write. Code that genuinely
    // needs another tenant builds one with `tenantFor`.
    return { ...rec, [key]: value };
  }
  return data;
}

/**
 * Who is reading, for the one question the register asks of a closed document:
 * are you named on it?
 *
 * Confidentiality above the open levels is not a ladder climbed by rank. The
 * people who may read such a document are named on the document itself by
 * whoever is answerable for its content — its author, or whoever uploaded the
 * file — and an administrator reads everything, because somebody must be able
 * to.
 */
export type Reader = {
  userId: string;
  /** Holds CONFIGURE: reads the whole register, closed documents included. */
  everything: boolean;
  /** The confidentiality codes open to everybody on the project. */
  openCodes: string[];
};

function closedDocumentFilter(reader: Reader) {
  return {
    OR: [
      { confidentiality: null },
      { confidentiality: { in: reader.openCodes } },
      // Answerable for it, so never locked out of it.
      { createdById: reader.userId },
      { revisions: { some: { OR: [{ authoredById: reader.userId }, { uploadedById: reader.userId }] } } },
      { access: { some: { userId: reader.userId } } },
    ],
  };
}

/**
 * The same rule, said once per model that hangs off a document: a closed
 * document's revisions, reviews, files and enclosures are as closed as the
 * document is. The transmittal itself stays visible — it is correspondence, and
 * what it carries is filtered here.
 */
const CLOSED_MODELS: Record<string, (reader: Reader) => Record<string, unknown>> = {
  Document: closedDocumentFilter,
  Revision: (reader) => ({ document: closedDocumentFilter(reader) }),
  ReviewCycle: (reader) => ({ revision: { document: closedDocumentFilter(reader) } }),
  ReviewComment: (reader) => ({ cycle: { revision: { document: closedDocumentFilter(reader) } } }),
  TransmittalItem: (reader) => ({ revision: { document: closedDocumentFilter(reader) } }),
  DocumentAccess: (reader) => ({ document: closedDocumentFilter(reader) }),
  DocumentSnapshot: (reader) => ({ document: closedDocumentFilter(reader) }),
  StoredFile: (reader) => ({ OR: [{ revisionId: null }, { revision: { document: closedDocumentFilter(reader) } }] }),
};

/**
 * Someone from another party reading our register. They are not staff: they see
 * what their own party produced, and what was issued to them on a transmittal.
 * Nothing else exists for them — in the register, in search, in exports.
 */
export type ExternalReader = { partyCode: string | null; userId: string; organization: string | null };

function externalDocumentFilter(reader: ExternalReader) {
  const addressedToThem = {
    OR: [
      { userId: reader.userId },
      ...(reader.organization ? [{ organization: reader.organization }] : []),
      ...(reader.partyCode ? [{ organization: reader.partyCode }] : []),
    ],
  };
  return {
    OR: [
      ...(reader.partyCode ? [{ originator: reader.partyCode }] : []),
      { revisions: { some: { transmittalItems: { some: { transmittal: { status: "ISSUED", recipients: { some: addressedToThem } } } } } } },
    ],
  };
}

/**
 * The same rule, said once per model that carries documents: a reader from
 * another party reaches a row only through a document they may see, a
 * transmittal they are on, or one they wrote themselves.
 */
const EXTERNAL_MODELS: Record<string, (reader: ExternalReader) => Record<string, unknown>> = {
  Document: externalDocumentFilter,
  Revision: (reader) => ({ document: externalDocumentFilter(reader) }),
  ReviewCycle: (reader) => ({ revision: { document: externalDocumentFilter(reader) } }),
  Transmittal: (reader) => ({
    OR: [
      { recipients: { some: { OR: [{ userId: reader.userId }, ...(reader.organization ? [{ organization: reader.organization }] : [])] } } },
      { createdById: reader.userId },
      ...(reader.organization ? [{ issuingParty: reader.organization }] : []),
    ],
  }),
};

export function scopedClient(
  orgId: string,
  projectId: string,
  /**
   * Who is reading. `null` means nobody in particular — seeds, importers and the
   * conformance engine, which measure the register rather than read it on
   * somebody's behalf — and then closed documents are not filtered out.
   */
  reader: Reader | null = null,
  /** Set when the reader belongs to another party; null for our own staff. */
  external: ExternalReader | null = null,
) {
  return db.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // The scoping the caller asked for, run first; what it touched is
          // restated afterwards, so a write and its consequence cannot drift.
          const scoped = async (): Promise<unknown> => {
          const key = keyFor(model);
          if (!key) return query(args);
          const value = key === "orgId" ? orgId : projectId;
          const a = (args ?? {}) as Record<string, unknown>;

          // Prisma types each operation's args narrowly; the extension is
          // generic over all of them, so the rewritten args are handed back
          // through a single cast at the boundary.
          const run = query as (args: unknown) => Promise<unknown>;

          if (READ_OPS.has(operation)) {
            const where = (a.where ?? {}) as Record<string, unknown>;
            const scopedWhere: Record<string, unknown> = { ...where, [key]: value };
            const extra: unknown[] = [];
            if (external && model && EXTERNAL_MODELS[model]) extra.push(EXTERNAL_MODELS[model](external));
            if (reader && !reader.everything && model && CLOSED_MODELS[model]) {
              // An open document is the ordinary register, read by everybody on
              // the project; a closed one is read by the people named on it.
              extra.push(CLOSED_MODELS[model](reader));
            }
            if (extra.length) {
              scopedWhere.AND = Array.isArray(where.AND)
                ? [...(where.AND as unknown[]), ...extra]
                : where.AND
                  ? [where.AND, ...extra]
                  : extra;
            }
            return run({ ...a, where: scopedWhere });
          }

          if (CREATE_OPS.has(operation)) {
            return run({ ...a, data: injectData(a.data, key, value) });
          }

          if (UPSERT_OPS.has(operation)) {
            const where = (a.where ?? {}) as Record<string, unknown>;
            return run({
              ...a,
              where: { ...where, [key]: value },
              create: injectData(a.create, key, value),
            });
          }

          if (SINGLE_WRITE_OPS.has(operation)) {
            // `where` here is a unique selector; adding a non-unique key is a
            // type error. The composite uniques added in Phase 1 already carry
            // the tenancy key, so a correctly-formed selector is scoped by
            // construction. A bare-cuid selector is left alone — the caller
            // obtained that id through a scoped read.
            return query(args);
          }

          return query(args);
          };

          const done = await scoped();
          // A write to a revision, a review cycle or a file changes what the
          // register says about the document that owns it — and what every
          // action waiting on that document is waiting for.
          if (model && RESTATES[model] && WRITE_OPS.has(operation)) {
            const waiting = deferred();
            for (const documentId of await touched(model, (args ?? {}) as Record<string, unknown>, done)) {
              // Inside a transaction the write lock is held, and restating on
              // another connection would wait for a lock that waits for it.
              // So it is remembered and done the moment the transaction ends.
              if (waiting) waiting.add(documentId);
              else await restateDocument(documentId);
            }
          }
          // A line added to or removed from an action's list changes the same
          // answer, from the other side.
          if (model === "BaselineEntry" && WRITE_OPS.has(operation)) {
            const waiting = deferredActions();
            for (const actionId of await touchedActions((args ?? {}) as Record<string, unknown>, done)) {
              if (waiting) waiting.add(actionId);
              else await restateActionById(orgId, projectId, actionId);
            }
          }
          return done;
        },
      },
    },
  });
}

/**
 * The models whose writes change what the register says about a document.
 *
 * `Document.latest*` is a copy of the newest revision's facts, kept so the
 * register can narrow, sort and page in SQL rather than reading every match
 * into memory. A copy is only as true as the last thing that wrote it, so
 * rather than trusting thirty call sites to remember, the client restates the
 * document itself after any write that could have changed it — and code
 * written later is covered by construction.
 */
const RESTATES: Record<string, "revision" | "byRevision"> = {
  Revision: "revision",
  ReviewCycle: "byRevision",
  StoredFile: "byRevision",
};

const WRITE_OPS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

/**
 * Which documents a write touched. A write by id says so in what it returns or
 * in what it was given; one by filter is asked of the database, because
 * `updateMany` answers with a count rather than the rows it changed.
 */
async function touched(model: string, args: Record<string, unknown>, result: unknown): Promise<string[]> {
  const kind = RESTATES[model];
  if (!kind) return [];
  const ids = new Set<string>();

  const fromRevision = async (revisionId: string) => {
    const revision = await db.revision.findUnique({ where: { id: revisionId }, select: { documentId: true } });
    if (revision) ids.add(revision.documentId);
  };

  for (const row of (Array.isArray(result) ? result : [result]) as ({ documentId?: string; revisionId?: string | null } | null)[]) {
    if (!row) continue;
    if (kind === "revision" && row.documentId) ids.add(row.documentId);
    if (kind === "byRevision" && row.revisionId) await fromRevision(row.revisionId);
  }

  for (const part of [args.where, args.data, args.create].filter(Boolean) as Record<string, unknown>[]) {
    if (kind === "revision" && typeof part.documentId === "string") ids.add(part.documentId);
    if (kind === "byRevision" && typeof part.revisionId === "string") await fromRevision(part.revisionId);
    if (kind === "revision" && typeof part.id === "string" && typeof part.documentId !== "string") await fromRevision(part.id);
  }

  // A write by filter names no row: ask which ones answer to it.
  if (!ids.size && args.where && typeof args.where === "object") {
    const where = args.where as Record<string, unknown>;
    if (kind === "revision") {
      const rows = await db.revision.findMany({ where, select: { documentId: true }, take: 500 });
      for (const row of rows) ids.add(row.documentId);
    } else {
      const rows = model === "ReviewCycle"
        ? await db.reviewCycle.findMany({ where: where as never, select: { revisionId: true }, take: 500 })
        : await db.storedFile.findMany({ where: where as never, select: { revisionId: true }, take: 500 });
      for (const row of rows) if (row.revisionId) await fromRevision(row.revisionId);
    }
  }

  return [...ids];
}

/**
 * The actions a write to the requirements list touched. A created or updated
 * line says its action; a deletion is found by what the selector matches, before
 * the row is gone, which is why the id is read from the result as well.
 */
async function touchedActions(args: Record<string, unknown>, result: unknown): Promise<string[]> {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string") ids.add(value);
  };
  const fromRecord = (record: unknown) => {
    if (record && typeof record === "object") add((record as Record<string, unknown>).actionId);
  };
  fromRecord(result);
  fromRecord(args.data);
  fromRecord(args.create);
  fromRecord(args.where);
  if (Array.isArray(args.data)) for (const one of args.data) fromRecord(one);
  return [...ids];
}

/** Rewrite what one action is waiting for, on its own tenant. */
async function restateActionById(orgId: string, projectId: string, actionId: string) {
  const { restateAction } = await import("./action-readiness");
  await restateAction(tenantFor(orgId, projectId), actionId);
}

/** Recompute a document's copy of its latest revision's facts. */
export async function restateDocument(documentId: string) {
  const latest = await db.revision.findFirst({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, value: true, state: true, statusCode: true, createdAt: true,
      plannedSubmissionDate: true, issueDate: true, releasedAt: true,
      files: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      cycles: { where: { binding: true, outcome: { not: null } }, orderBy: { sequence: "desc" }, take: 1, select: { outcome: true } },
    },
  });
  await db.document.update({
    where: { id: documentId },
    data: {
      latestRevisionId: latest?.id ?? null,
      latestRevValue: latest?.value ?? null,
      latestRevState: latest?.state ?? null,
      latestStatusCode: latest?.statusCode ?? null,
      latestVerdict: latest?.cycles[0]?.outcome ?? null,
      latestRevAt: latest?.createdAt ?? null,
      latestFileAt: latest?.files[0]?.createdAt ?? null,
      latestPlannedAt: latest?.plannedSubmissionDate ?? null,
      latestIssueAt: latest?.issueDate ?? null,
      latestReleasedAt: latest?.releasedAt ?? null,
    },
  });

  // Every action that lists this document is waiting on a different answer now.
  const waiting = await db.baselineEntry.findMany({ where: { documentId }, select: { actionId: true, projectId: true } });
  const seen = new Set<string>();
  for (const row of waiting) {
    if (seen.has(row.actionId)) continue;
    seen.add(row.actionId);
    const project = await db.project.findUnique({ where: { id: row.projectId }, select: { orgId: true } });
    if (project) await restateActionById(project.orgId, row.projectId, row.actionId);
  }
}


export type ScopedDb = ReturnType<typeof scopedClient>;

/**
 * The minimum a helper needs to act inside a tenancy. `Scope` satisfies it
 * structurally, so request code passes its scope straight through.
 */
export type Tenant = {
  orgId: string;
  projectId: string;
  db: ScopedDb;
};

/**
 * Build a tenant outside a request — seeds, importers, `run-checks`. Callers
 * name the project explicitly, which is exactly what a batch job should do.
 */
export function tenantFor(orgId: string, projectId: string): Tenant {
  return { orgId, projectId, db: scopedClient(orgId, projectId) };
}
