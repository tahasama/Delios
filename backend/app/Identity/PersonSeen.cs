using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Identity;

/// <summary>
/// When a person was last seen, written by the act itself (owner: never worked out again from the whole audit trail):
/// on a project, the first and last time they acted or read there and when they were first
/// put on it; with no project, their last sign-in. Written only by the audit functions in the database (<c>audit_seen</c>),
/// in the same transaction as the act; read by the organization's People and Organizations.
/// </summary>
public sealed class PersonSeen
{
    /// <summary>The line of a person's sign-ins (no project): <see cref="LastAt"/> is their last sign-in.</summary>
    public static readonly Guid SignIns = Guid.Empty;

    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    /// <summary>The project; <see cref="SignIns"/> for the person's sign-ins.</summary>
    public Guid ProjectId { get; set; }
    public Instant? FirstAt { get; set; }
    public Instant? LastAt { get; set; }
    /// <summary>Put on the project: the earliest time it was recorded.</summary>
    public Instant? JoinedAt { get; set; }
}

internal sealed class PersonSeenConfiguration : IEntityTypeConfiguration<PersonSeen>
{
    public void Configure(EntityTypeBuilder<PersonSeen> b)
    {
        b.ToTable("people_seen");
        b.HasKey(x => new { x.UserId, x.ProjectId });
        b.HasIndex(x => x.TenantId);
    }
}
