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
