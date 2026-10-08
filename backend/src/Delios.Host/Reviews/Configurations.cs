using Delios.Host.Documents;
using Delios.Host.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Delios.Host.Reviews;

/// <summary>Tells Entity Framework how to store <see cref="ReviewRoute"/>: name unique per tenant, patterns and steps kept as JSON columns on the route row.</summary>
internal sealed class ReviewRouteConfiguration : IEntityTypeConfiguration<ReviewRoute>
{
    /// <summary>Called by Entity Framework when it builds the model (see <c>DeliosDbContext</c>).</summary>
    public void Configure(EntityTypeBuilder<ReviewRoute> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.Name }).IsUnique();
        b.Property(x => x.Name).HasMaxLength(100);
        b.OwnsMany(x => x.Patterns, p => p.ToJson());
        b.OwnsMany(x => x.Steps, s => s.ToJson());
    }
}

/// <summary>Tells Entity Framework how to store <see cref="Review"/>: its links, indexes, column lengths, and <c>Version</c> as a row version (a value that changes on every update, so two people saving the same review at once is detected).</summary>
internal sealed class ReviewConfiguration : IEntityTypeConfiguration<Review>
{
    /// <summary>Called by Entity Framework when it builds the model.</summary>
    public void Configure(EntityTypeBuilder<Review> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Document>().WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Revision>().WithMany().HasForeignKey(x => x.RevisionId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(x => x.Steps).WithOne().HasForeignKey(x => x.ReviewId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(x => x.Comments).WithOne().HasForeignKey(x => x.ReviewId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ProjectId, x.Number }).IsUnique();
        b.HasIndex(x => x.RevisionId);
        b.HasIndex(x => new { x.ProjectId, x.State });
        b.Property(x => x.Number).HasMaxLength(64);
        b.Property(x => x.RouteName).HasMaxLength(100);
        b.Property(x => x.State).HasMaxLength(16);
        b.Property(x => x.Verdict).HasMaxLength(64);
        b.Property(x => x.GrantedStatus).HasMaxLength(64);
        b.Property(x => x.StartedByName).HasMaxLength(200);
        b.Property(x => x.ClosedByName).HasMaxLength(200);
        b.Property(x => x.ReturnReason).HasMaxLength(64);
        b.Property(x => x.StartedAt).HasDefaultValueSql("now()");
        b.Property(x => x.Version).IsRowVersion();
    }
}

/// <summary>Tells Entity Framework how to store <see cref="ReviewStep"/>: one row per step, unique by review and index; <c>ByProxy</c> is computed, not stored.</summary>
internal sealed class ReviewStepConfiguration : IEntityTypeConfiguration<ReviewStep>
{
    /// <summary>Called by Entity Framework when it builds the model.</summary>
    public void Configure(EntityTypeBuilder<ReviewStep> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(x => x.Participants).WithOne().HasForeignKey(x => x.StepId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ReviewId, x.Index }).IsUnique();
        b.HasIndex(x => new { x.TenantId, x.State });
        b.Property(x => x.Title).HasMaxLength(200);
        b.Property(x => x.FunctionCode).HasMaxLength(32);
        b.Property(x => x.Mode).HasMaxLength(8);
        b.Property(x => x.State).HasMaxLength(16);
        b.Property(x => x.Answer).HasMaxLength(64);
        b.HasOne<Party>().WithMany().HasForeignKey(x => x.PartyId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<StoredFile>().WithMany().HasForeignKey(x => x.EvidenceFileId).OnDelete(DeleteBehavior.Restrict);
        b.Property(x => x.PartyName).HasMaxLength(200);
        b.Property(x => x.Participation).HasMaxLength(16);
        b.Property(x => x.Reason).HasMaxLength(64);
        b.Property(x => x.DispatchChannel).HasMaxLength(64);
        b.Property(x => x.DispatchRef).HasMaxLength(200);
        b.Property(x => x.DispatchedByName).HasMaxLength(200);
        b.Property(x => x.ForeignAnswer).HasMaxLength(200);
        b.Property(x => x.RecordedByName).HasMaxLength(200);
        b.Ignore(x => x.ByProxy);
    }
}

/// <summary>Tells Entity Framework how to store <see cref="ReviewParticipant"/>: a user sits at most once on a step.</summary>
internal sealed class ReviewParticipantConfiguration : IEntityTypeConfiguration<ReviewParticipant>
{
    /// <summary>Called by Entity Framework when it builds the model.</summary>
    public void Configure(EntityTypeBuilder<ReviewParticipant> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.StepId, x.UserId }).IsUnique();
        b.HasIndex(x => new { x.UserId, x.AnsweredAt });
        b.Property(x => x.UserName).HasMaxLength(200);
        b.Property(x => x.Answer).HasMaxLength(64);
        b.Property(x => x.GrantedStatus).HasMaxLength(64);
        b.Property(x => x.AnsweredByName).HasMaxLength(200);
    }
}

/// <summary>Tells Entity Framework how to store <see cref="ReviewComment"/>: column lengths, and the creation time set by the database.</summary>
internal sealed class ReviewCommentConfiguration : IEntityTypeConfiguration<ReviewComment>
{
    /// <summary>Called by Entity Framework when it builds the model.</summary>
    public void Configure(EntityTypeBuilder<ReviewComment> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ReviewId, x.Status });
        b.Property(x => x.AuthorName).HasMaxLength(200);
        b.Property(x => x.Text).HasMaxLength(4000);
        b.Property(x => x.Class).HasMaxLength(64);
        b.Property(x => x.ClosesWith).HasMaxLength(16);
        b.Property(x => x.Status).HasMaxLength(16);
        b.Property(x => x.Resolution).HasMaxLength(2000);
        b.Property(x => x.ClosedByName).HasMaxLength(200);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}

/// <summary>Tells Entity Framework how to store <see cref="ReviewDelegation"/>.</summary>
internal sealed class ReviewDelegationConfiguration : IEntityTypeConfiguration<ReviewDelegation>
{
    /// <summary>Called by Entity Framework when it builds the model.</summary>
    public void Configure(EntityTypeBuilder<ReviewDelegation> b)
    {
        b.ToTable("review_delegations");
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<Review>().WithMany().HasForeignKey(x => x.ReviewId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<User>().WithMany().HasForeignKey(x => x.FromUserId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<User>().WithMany().HasForeignKey(x => x.ToUserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.ReviewId, x.StepIndex, x.Status });
        b.HasIndex(x => new { x.ToUserId, x.Status });
        b.Property(x => x.FromName).HasMaxLength(200);
        b.Property(x => x.ToName).HasMaxLength(200);
        b.Property(x => x.Verb).HasMaxLength(16);
        b.Property(x => x.Reason).HasMaxLength(1000);
        b.Property(x => x.Status).HasMaxLength(16);
        b.Property(x => x.RefusedReason).HasMaxLength(1000);
        b.Property(x => x.Flag).HasMaxLength(500);
        b.Property(x => x.AskedByName).HasMaxLength(200);
        b.Property(x => x.GrantedByName).HasMaxLength(200);
    }
}
