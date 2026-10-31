using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Platform;

/// <summary>
/// What happened, written down by the database at the moment it happens (owner: "record the thing using the trigger that
/// happens anyway", never swept for afterwards). Kept in tables of their own, never on the rows they are about: those
/// carry a version stamp, and a write beside the app's own would refuse its next save. Read by the app, never written by
/// it; <c>rebuild-recorded</c> (backend command) writes them again from what exists, should one ever look wrong.
/// </summary>
public static class Recorded
{
    /// <summary>The SQL that writes every recorded fact again from what exists, organization by organization.</summary>
    public const string Rebuild = """
        DO $$
        DECLARE t record;
        BEGIN
            FOR t IN SELECT id FROM tenants LOOP
                PERFORM set_config('app.tenant_id', t.id::text, true);
                DELETE FROM revision_facts;
                INSERT INTO revision_facts (revision_id, tenant_id, project_id, first_carried_at)
                    SELECT i.revision_id, t.id, x.project_id, min(x.issued_at)
                    FROM transmittal_items i JOIN transmittals x ON x.id = i.transmittal_id
                    WHERE i.revision_id IS NOT NULL AND x.review_step_id IS NULL
                    GROUP BY i.revision_id, x.project_id;
                DELETE FROM document_facts;
                PERFORM refresh_document_facts(id) FROM documents;
                DELETE FROM values_used;
                INSERT INTO values_used (project_id, field, code, tenant_id, documents)
                    SELECT project_id, 'DISCIPLINE', discipline, t.id, count(*) FROM documents GROUP BY project_id, discipline;
                INSERT INTO values_used (project_id, field, code, tenant_id, documents)
                    SELECT project_id, 'DOC_TYPE', doc_type, t.id, count(*) FROM documents GROUP BY project_id, doc_type;
                DELETE FROM transmittal_facts;
                INSERT INTO transmittal_facts (transmittal_id, tenant_id, project_id, answered_at)
                    SELECT p.id, t.id, p.project_id, min(a.issued_at)
                    FROM transmittals p JOIN transmittals a
                        ON a.in_reply_to_id = p.id OR (a.follows_id = p.id AND a.issued_by_id IS DISTINCT FROM p.issued_by_id)
                    GROUP BY p.id, p.project_id;
            END LOOP;
        END
        $$;
        """;

    /// <summary>What migration RecordedAsItHappens filled, as it stood then (a migration never changes).</summary>
    public const string RebuildCarriedAndAnswered = """
        DO $$
        DECLARE t record;
        BEGIN
            FOR t IN SELECT id FROM tenants LOOP
                PERFORM set_config('app.tenant_id', t.id::text, true);
                DELETE FROM revision_facts;
                INSERT INTO revision_facts (revision_id, tenant_id, project_id, first_carried_at)
                    SELECT i.revision_id, t.id, x.project_id, min(x.issued_at)
                    FROM transmittal_items i JOIN transmittals x ON x.id = i.transmittal_id
                    WHERE i.revision_id IS NOT NULL AND x.review_step_id IS NULL
                    GROUP BY i.revision_id, x.project_id;
                DELETE FROM transmittal_facts;
                INSERT INTO transmittal_facts (transmittal_id, tenant_id, project_id, answered_at)
                    SELECT p.id, t.id, p.project_id, min(a.issued_at)
                    FROM transmittals p JOIN transmittals a
                        ON a.in_reply_to_id = p.id OR (a.follows_id = p.id AND a.issued_by_id IS DISTINCT FROM p.issued_by_id)
                    GROUP BY p.id, p.project_id;
            END LOOP;
        END
        $$;
        """;
}

/// <summary>
/// What the register filters and sorts a document by, beyond its own columns, written by the database whenever one of its
/// revisions, reviews, files or transmittal lines changes (<c>refresh_document_facts</c>).
/// </summary>
public sealed class DocumentFact
{
    public Guid DocumentId { get; set; }
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    /// <summary>A revision of it is released now.</summary>
    public bool Released { get; set; }
    public string? ReleasedStatus { get; set; }
    public Instant? ReleasedAt { get; set; }
    /// <summary>The verdict its newest revision was last given.</summary>
    public string? Verdict { get; set; }
    /// <summary>Its newest revision's review is decided, not released yet.</summary>
    public bool Decided { get; set; }
    public Instant? FileAddedAt { get; set; }
    /// <summary>When one of ours first went out on a transmittal (other than a review's).</summary>
    public Instant? FirstIssuedAt { get; set; }
}

/// <summary>How many of a project's documents carry a discipline or a document type (field DISCIPLINE / DOC_TYPE).</summary>
public sealed class ValueUsed
{
    public Guid ProjectId { get; set; }
    public required string Field { get; set; }
    public required string Code { get; set; }
    public Guid TenantId { get; set; }
    public int Documents { get; set; }
}

/// <summary>A revision a transmittal (other than a review's) carried: when it first did. None: released and "not sent yet".</summary>
public sealed class RevisionFact
{
    public Guid RevisionId { get; set; }
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Instant FirstCarriedAt { get; set; }
}

/// <summary>A transmittal answered by another (one answering it, or following it from someone else): when first.</summary>
public sealed class TransmittalFact
{
    public Guid TransmittalId { get; set; }
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Instant AnsweredAt { get; set; }
}

internal sealed class DocumentFactConfiguration : IEntityTypeConfiguration<DocumentFact>
{
    public void Configure(EntityTypeBuilder<DocumentFact> b)
    {
        b.ToTable("document_facts");
        b.HasKey(x => x.DocumentId);
        b.HasIndex(x => x.TenantId);
        b.Property(x => x.ReleasedStatus).HasMaxLength(64);
        b.Property(x => x.Verdict).HasMaxLength(64);
    }
}

internal sealed class ValueUsedConfiguration : IEntityTypeConfiguration<ValueUsed>
{
    public void Configure(EntityTypeBuilder<ValueUsed> b)
    {
        b.ToTable("values_used");
        b.HasKey(x => new { x.ProjectId, x.Field, x.Code });
        b.HasIndex(x => x.TenantId);
        b.Property(x => x.Field).HasMaxLength(16);
        b.Property(x => x.Code).HasMaxLength(64);
    }
}

/// <summary>
/// A document's planned day as it moved (owner: past weeks judged against the plan as it stood then): written by the
/// database the moment <c>documents.planned_date</c> changes (trigger <c>record_planned_date</c>), never by the app.
/// Read by Progress by week; before the first change kept, a document's day is read as it stands.
/// </summary>
public sealed class PlannedDateChange
{
    public long Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid DocumentId { get; set; }
    public LocalDate? Was { get; set; }
    public LocalDate? Became { get; set; }
    public Instant At { get; set; }
}

internal sealed class PlannedDateChangeConfiguration : IEntityTypeConfiguration<PlannedDateChange>
{
    public void Configure(EntityTypeBuilder<PlannedDateChange> b)
    {
        b.ToTable("planned_date_changes");
        b.Property(x => x.Id).UseIdentityAlwaysColumn();
        b.HasIndex(x => new { x.ProjectId, x.DocumentId, x.At });
    }
}

internal sealed class RevisionFactConfiguration : IEntityTypeConfiguration<RevisionFact>
{
    public void Configure(EntityTypeBuilder<RevisionFact> b)
    {
        b.ToTable("revision_facts");
        b.HasKey(x => x.RevisionId);
        b.HasIndex(x => x.TenantId);
    }
}

internal sealed class TransmittalFactConfiguration : IEntityTypeConfiguration<TransmittalFact>
{
    public void Configure(EntityTypeBuilder<TransmittalFact> b)
    {
        b.ToTable("transmittal_facts");
        b.HasKey(x => x.TransmittalId);
        b.HasIndex(x => x.TenantId);
    }
}
