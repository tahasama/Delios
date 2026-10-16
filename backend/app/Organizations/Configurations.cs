using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Delios.Host.Organizations;

internal sealed class OrganizationLinkConfiguration : IEntityTypeConfiguration<OrganizationLink>
{
    public void Configure(EntityTypeBuilder<OrganizationLink> b)
    {
        b.HasIndex(x => x.HostTenantId);
        b.HasIndex(x => x.GuestTenantId);
        // One open link (invited or linked) per party of ours.
        b.HasIndex(x => x.HostPartyId).IsUnique().HasFilter("state IN ('INVITED', 'LINKED')");
        b.Property(x => x.HostPartyCode).HasMaxLength(32);
        b.Property(x => x.HostPartyName).HasMaxLength(200);
        b.Property(x => x.InvitedEmail).HasMaxLength(320);
        b.Property(x => x.State).HasMaxLength(16);
        b.Property(x => x.InvitedByName).HasMaxLength(200);
        b.Property(x => x.AnsweredByName).HasMaxLength(200);
        b.Property(x => x.AnswerNote).HasMaxLength(2000);
        b.Property(x => x.EndedByName).HasMaxLength(200);
        b.Property(x => x.EndedBySide).HasMaxLength(8);
        b.Property(x => x.EndReason).HasMaxLength(2000);
        b.Property(x => x.InvitedAt).HasDefaultValueSql("now()");
    }
}

internal sealed class AccountLinkConfiguration : IEntityTypeConfiguration<AccountLink>
{
    public void Configure(EntityTypeBuilder<AccountLink> b)
    {
        b.HasIndex(x => new { x.LinkId, x.HomeUserId }).IsUnique().HasFilter("ended_at IS NULL");
        b.HasIndex(x => x.HomeUserId);
        b.HasIndex(x => x.HostUserId);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }
}

internal sealed class ProjectPartyConfiguration : IEntityTypeConfiguration<ProjectParty>
{
    public void Configure(EntityTypeBuilder<ProjectParty> b)
    {
        b.HasIndex(x => new { x.ProjectId, x.PartyId }).IsUnique();
        b.Property(x => x.Role).HasMaxLength(32);
        b.Property(x => x.AddedByName).HasMaxLength(200);
        b.Property(x => x.AddedAt).HasDefaultValueSql("now()");
        b.Property(x => x.ContractNumber).HasMaxLength(64);
        b.Property(x => x.PreviousContractNumber).HasMaxLength(64);
        b.Property(x => x.ContractChangedByName).HasMaxLength(200);
    }
}
