using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Messaging;
using Delios.Host.Reviews;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Delios.Host.Platform;

/// <summary>
/// The application's single Entity Framework Core <c>DbContext</c>: the object that opens database connections, turns LINQ queries into SQL
/// and saves changes. Each <c>DbSet</c> property below is one table. Registered in PlatformSetup as one instance per HTTP request (scoped).
/// It also stores the Data Protection keys (<c>IDataProtectionKeyContext</c>).
/// </summary>
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
    public DbSet<SignInName> SignInNames => Set<SignInName>();
    public DbSet<Organizations.OrganizationLink> OrganizationLinks => Set<Organizations.OrganizationLink>();
    public DbSet<Organizations.AccountLink> AccountLinks => Set<Organizations.AccountLink>();
    public DbSet<Organizations.ProjectParty> ProjectParties => Set<Organizations.ProjectParty>();
    public DbSet<Settings.Setting> Settings => Set<Settings.Setting>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<Function> Functions => Set<Function>();
    public DbSet<PermissionRule> PermissionRules => Set<PermissionRule>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<KnownDevice> KnownDevices => Set<KnownDevice>();
    public DbSet<IdentityProvider> IdentityProviders => Set<IdentityProvider>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    public DbSet<ValueEntry> ValueEntries => Set<ValueEntry>();
    public DbSet<ValueSet> ListSets => Set<ValueSet>();
    public DbSet<NumberingScheme> NumberingSchemes => Set<NumberingScheme>();
    public DbSet<SchemeRouting> SchemeRoutings => Set<SchemeRouting>();
    public DbSet<NumberCounter> NumberCounters => Set<NumberCounter>();
    public DbSet<RevisionScheme> RevisionSchemes => Set<RevisionScheme>();
    public DbSet<RevisionSchemeRouting> RevisionSchemeRoutings => Set<RevisionSchemeRouting>();
    public DbSet<Document> Documents => Set<Document>();
    public DbSet<Revision> Revisions => Set<Revision>();
    public DbSet<StoredFile> StoredFiles => Set<StoredFile>();
    public DbSet<DocumentAccess> DocumentAccess => Set<DocumentAccess>();
    public DbSet<HandBackRequest> HandBackRequests => Set<HandBackRequest>();
    public DbSet<NumberEquivalent> NumberEquivalents => Set<NumberEquivalent>();
    public DbSet<Settings.KeptCopy> KeptCopies => Set<Settings.KeptCopy>();
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
    public DbSet<Transmittals.EmailReply> EmailReplies => Set<Transmittals.EmailReply>();
    /// <summary>No row-level security: a reply by email is routed by it before anyone knows whose it is.</summary>
    public DbSet<Transmittals.ReplyAddress> ReplyAddresses => Set<Transmittals.ReplyAddress>();
    public DbSet<Organizations.ReservedValue> ReservedValues => Set<Organizations.ReservedValue>();
    public DbSet<Organizations.OrganizationIdentity> OrganizationIdentities => Set<Organizations.OrganizationIdentity>();
    public DbSet<Organizations.OrganizationHolder> OrganizationHolders => Set<Organizations.OrganizationHolder>();
    public DbSet<Organizations.OrganizationMerge> OrganizationMerges => Set<Organizations.OrganizationMerge>();
    public DbSet<Organizations.OrganizationClaim> OrganizationClaims => Set<Organizations.OrganizationClaim>();

    public DbSet<Packages.Package> Packages => Set<Packages.Package>();
    public DbSet<Search.SearchWatermark> SearchWatermarks => Set<Search.SearchWatermark>();
    public DbSet<Extraction.FileText> FileTexts => Set<Extraction.FileText>();
    public DbSet<Checks.CheckRun> CheckRuns => Set<Checks.CheckRun>();
    public DbSet<Checks.Defect> Defects => Set<Checks.Defect>();
    public DbSet<Checks.CheckOptOut> CheckOptOuts => Set<Checks.CheckOptOut>();
    public DbSet<Documents.RegisterView> RegisterViews => Set<Documents.RegisterView>();
    public DbSet<Actions.ScheduleSource> ScheduleSources => Set<Actions.ScheduleSource>();
    public DbSet<Actions.ScheduleImport> ScheduleImports => Set<Actions.ScheduleImport>();
    public DbSet<Actions.Activity> Activities => Set<Actions.Activity>();
    public DbSet<Actions.Requirement> Requirements => Set<Actions.Requirement>();
    public DbSet<Actions.ActivityDecision> ActivityDecisions => Set<Actions.ActivityDecision>();
    public DbSet<Actions.Notice> Notices => Set<Actions.Notice>();
    public DbSet<Packages.PackageMember> PackageMembers => Set<Packages.PackageMember>();

    /// <summary>
    /// Called once by Entity Framework Core when it first builds the model. Applies every <c>IEntityTypeConfiguration</c> class in this assembly
    /// (the *Configuration classes in each feature folder), then marks every Guid <c>Id</c> as set by the application, not the database.
    /// </summary>
    /// <summary>The project whose lists this request reads; none: the organization's.</summary>
    public Guid? ListsProject { get; private set; }
    /// <summary>The lists that project keeps its own copy of; every other list is read as the organization's, the default.</summary>
    public string[] ListsOwnKeys { get; private set; } = [];

    /// <summary>
    /// Reads the lists as this project sees them from now on in the request: its own copy of the lists it keeps, the
    /// organization's of the others. Set by <c>ProjectAccessFilter</c> and by the <c>X-Delios-Project</c> header.
    /// </summary>
    public void UseListsOf(Guid projectId, string[] ownKeys, bool ownRules = false)
    {
        ListsProject = projectId;
        ListsOwnKeys = ownKeys;
        RulesProject = ownRules ? projectId : null;
    }

    /// <summary>
    /// The project whose own copy of what functions may do is read in this request; none: the organization's rules.
    /// Set with the lists (<see cref="UseListsOf"/>), from the project in hand.
    /// </summary>
    public Guid? RulesProject { get; private set; }

    /// <summary>Reads what functions may do as the organization's (its Settings), whatever project the request is in.</summary>
    public void UseOrganizationRules() => RulesProject = null;

    /// <summary>Reads every list as the organization's (the organization's Settings).</summary>
    public void UseOrganizationLists()
    {
        ListsProject = null;
        ListsOwnKeys = [];
        RulesProject = null;
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(DeliosDbContext).Assembly);
        // A list is read as the project in hand sees it: its own copy of the lists it keeps, the organization's of the others.
        modelBuilder.Entity<ValueEntry>().HasQueryFilter(v => ListsOwnKeys.Contains(v.SetKey) ? v.ProjectId == ListsProject : v.ProjectId == null);
        // What a function may do is read the same way: the project's own copy where it keeps one, else the organization's.
        modelBuilder.Entity<PermissionRule>().HasQueryFilter(r => r.ProjectId == RulesProject);
        modelBuilder.Entity<ValueSet>().HasQueryFilter(v => ListsOwnKeys.Contains(v.ListKey) ? v.ProjectId == ListsProject : v.ProjectId == null);

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
