using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Reviews;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Platform;

public sealed class DeliosDbContext(DbContextOptions<DeliosDbContext> options)
    : DbContext(options), IDataProtectionKeyContext
{
    /// <summary>
    /// The keys that protect cookies and anti-forgery tokens. Shared through the
    /// database so that every node accepts what any other node issued.
    /// </summary>
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<Party> Parties => Set<Party>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Function> Functions => Set<Function>();
    public DbSet<PermissionRule> PermissionRules => Set<PermissionRule>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<IdentityProvider> IdentityProviders => Set<IdentityProvider>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    public DbSet<ValueEntry> ValueEntries => Set<ValueEntry>();
    public DbSet<NumberingScheme> NumberingSchemes => Set<NumberingScheme>();
    public DbSet<SchemeRouting> SchemeRoutings => Set<SchemeRouting>();
    public DbSet<NumberCounter> NumberCounters => Set<NumberCounter>();
    public DbSet<RevisionScheme> RevisionSchemes => Set<RevisionScheme>();
    public DbSet<RevisionSchemeRouting> RevisionSchemeRoutings => Set<RevisionSchemeRouting>();
    public DbSet<Document> Documents => Set<Document>();
    public DbSet<Revision> Revisions => Set<Revision>();
    public DbSet<StoredFile> StoredFiles => Set<StoredFile>();
    public DbSet<DocumentAccess> DocumentAccess => Set<DocumentAccess>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();
    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();

    public DbSet<ReviewRoute> ReviewRoutes => Set<ReviewRoute>();
    public DbSet<Review> Reviews => Set<Review>();
    public DbSet<ReviewStep> ReviewSteps => Set<ReviewStep>();
    public DbSet<ReviewParticipant> ReviewParticipants => Set<ReviewParticipant>();
    public DbSet<ReviewComment> ReviewComments => Set<ReviewComment>();

    public DbSet<Transmittals.IssueRequest> IssueRequests => Set<Transmittals.IssueRequest>();
    public DbSet<Transmittals.Transmittal> Transmittals => Set<Transmittals.Transmittal>();
    public DbSet<Transmittals.TransmittalItem> TransmittalItems => Set<Transmittals.TransmittalItem>();
    public DbSet<Transmittals.TransmittalRecipient> TransmittalRecipients => Set<Transmittals.TransmittalRecipient>();

    public DbSet<Packages.Package> Packages => Set<Packages.Package>();
    public DbSet<Packages.PackageMember> PackageMembers => Set<Packages.PackageMember>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(DeliosDbContext).Assembly);

        // Every Guid id is made in code (Guid.CreateVersion7), never by the database.
        // Saying so lets a new row reached through a navigation be inserted rather
        // than mistaken for an existing one and updated.
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            if (entity.FindPrimaryKey()?.Properties is [{ ClrType: var type, Name: "Id" } id] && type == typeof(Guid))
            {
                id.ValueGenerated = Microsoft.EntityFrameworkCore.Metadata.ValueGenerated.Never;
            }
        }
    }
}
