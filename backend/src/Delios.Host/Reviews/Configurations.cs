using Delios.Host.Documents;
using Delios.Host.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Delios.Host.Reviews;

internal sealed class ReviewRouteConfiguration : IEntityTypeConfiguration<ReviewRoute>
{
    public void Configure(EntityTypeBuilder<ReviewRoute> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.TenantId, x.Name }).IsUnique();
        b.Property(x => x.Name).HasMaxLength(100);
        b.OwnsMany(x => x.Patterns, p => p.ToJson());
        b.OwnsMany(x => x.Steps, s => s.ToJson());
    }
}

internal sealed class ReviewConfiguration : IEntityTypeConfiguration<Review>
{
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

internal sealed class ReviewStepConfiguration : IEntityTypeConfiguration<ReviewStep>
{
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
    }
}

internal sealed class ReviewParticipantConfiguration : IEntityTypeConfiguration<ReviewParticipant>
{
    public void Configure(EntityTypeBuilder<ReviewParticipant> b)
    {
        b.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        b.HasIndex(x => new { x.StepId, x.UserId }).IsUnique();
        b.HasIndex(x => new { x.UserId, x.AnsweredAt });
        b.Property(x => x.UserName).HasMaxLength(200);
        b.Property(x => x.Answer).HasMaxLength(64);
        b.Property(x => x.GrantedStatus).HasMaxLength(64);
    }
}

internal sealed class ReviewCommentConfiguration : IEntityTypeConfiguration<ReviewComment>
{
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
