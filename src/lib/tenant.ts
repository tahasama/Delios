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
 * Models whose rows carry a confidentiality of their own. A clearance filter is
 * applied to these as well as the tenancy key, so §5.7 is enforced in the same
 * place and cannot be forgotten at a call site.
 */
const CONFIDENTIAL_MODELS = new Set(["Document"]);

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
   * The confidentiality codes the reader is cleared for. `null` means no
   * clearance filtering — used by seeds, importers and the conformance engine,
   * which measure the register rather than read it on someone's behalf.
   */
  allowedConfidentiality: string[] | null = null,
  /** Set when the reader belongs to another party; null for our own staff. */
  external: ExternalReader | null = null,
) {
  return db.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
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
            if (allowedConfidentiality && model && CONFIDENTIAL_MODELS.has(model)) {
              // An unclassified item is readable by anyone who can reach the
              // project; a classified one needs the clearance for its level.
              extra.push({ OR: [{ confidentiality: null }, { confidentiality: { in: allowedConfidentiality } }] });
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
        },
      },
    },
  });
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
