using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NodaTime;

namespace Delios.Host.Operators;

/// <summary>
/// The DELIOS team's own space (owner: "the US space"), above every organization: the people who run DELIOS, what each
/// organization has with us (its plan, its contract, what it accepted), what it asks, the legal texts and every legal
/// matter. Kept outside every organization's data (no row-level security: these tables hold no organization's
/// documents); read and written only through <c>/api/console</c>, signed in with an operator's own account.
/// </summary>
public sealed class Operator
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Email { get; set; }
    public required string NormalizedEmail { get; set; }
    public required string Name { get; set; }
    public required string PasswordHash { get; set; }
    /// <summary>
    /// The authenticator secret, encrypted (Data Protection). Two-step sign-in is always asked of an operator: set up on
    /// the first sign-in by scanning a QR code, in force once a code confirms it (<see cref="MfaEnabledAt"/>).
    /// </summary>
    public string? MfaSecretProtected { get; set; }
    public Instant? MfaEnabledAt { get; set; }
    /// <summary>One-time codes for a lost phone, hashed; each is removed once used.</summary>
    public string[] RecoveryCodeHashes { get; set; } = [];
    /// <summary>The last code step accepted: a code works once.</summary>
    public long? MfaLastStep { get; set; }
    public bool Active { get; set; } = true;
    public int FailedSignIns { get; set; }
    public Instant? LockedUntil { get; set; }
    public Instant CreatedAt { get; set; }
    public Instant? LastSignInAt { get; set; }
}

public sealed class OperatorSession
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required byte[] TokenHash { get; set; }
    public Guid OperatorId { get; set; }
    public Instant CreatedAt { get; set; }
    public Instant ExpiresAt { get; set; }
    public Instant? RevokedAt { get; set; }
}

/// <summary>What an organization has with us: its plan, where it stands, how it pays, its contract.</summary>
public sealed class Subscription
{
    public Guid TenantId { get; set; }
    /// <summary>A plan of <see cref="Plan"/>, by its code; none yet while it tries DELIOS.</summary>
    public string? Plan { get; set; }
    /// <summary><see cref="SubscriptionStates"/>, as last set; what applies today is <see cref="Subscriptions.Effective"/>.</summary>
    public string State { get; set; } = SubscriptionStates.Trial;
    public Instant? TrialEndsAt { get; set; }
    /// <summary>Paid up to this day; past it (and the grace days), the organization reads only.</summary>
    public Instant? PaidUntil { get; set; }
    /// <summary><see cref="BillingWays"/>: by card through the seller of record, or on invoice.</summary>
    public string? Billing { get; set; }
    /// <summary>Users agreed in the contract, when it says a number.</summary>
    public int? Seats { get; set; }
    /// <summary>The contract's own reference, and the day it was signed.</summary>
    public string? ContractRef { get; set; }
    public LocalDate? ContractSignedOn { get; set; }
    /// <summary>The seller of record's own reference for this customer (Paddle, Stripe…), once connected.</summary>
    public string? ProviderRef { get; set; }
    public string? Notes { get; set; }
    /// <summary>Cancelled by one of its administrators (one click): nothing renews; it reads only once paid up to.</summary>
    public Instant? CancelledAt { get; set; }
    public string? CancelledBy { get; set; }
    /// <summary>The next moment its administrators are reminded the trial ends (<see cref="Trials.NextReminder"/>); none: nothing to tell.</summary>
    public Instant? RemindAt { get; set; }
    /// <summary>When they were last reminded of this trial's end; cleared when the end moves.</summary>
    public Instant? TrialToldAt { get; set; }
    /// <summary>A plan its administrator asked for on Contract &amp; plan, waiting for DELIOS to set it up; cleared once a plan is set.</summary>
    public string? PlanAsked { get; set; }
    public int? PlanAskedUsers { get; set; }
    public string? PlanAskedNote { get; set; }
    public Instant? PlanAskedAt { get; set; }
    public string? PlanAskedBy { get; set; }
    public Instant UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}

public static class SubscriptionStates
{
    /// <summary>Trying DELIOS until its trial ends.</summary>
    public const string Trial = "TRIAL";
    /// <summary>Paying, or under contract.</summary>
    public const string Active = "ACTIVE";
    /// <summary>Not paid: everyone reads and exports, nobody adds or changes. Nothing is deleted.</summary>
    public const string ReadOnly = "READ_ONLY";
    /// <summary>The contract ended: its data handed back as an export, then deleted after the agreed time.</summary>
    public const string Ended = "ENDED";
    public static readonly string[] All = [Trial, Active, ReadOnly, Ended];
}

public static class BillingWays
{
    public const string Card = "CARD", Invoice = "INVOICE";
    public static readonly string[] All = [Card, Invoice];
}

/// <summary>A plan we sell, named and priced by the DELIOS team in the console (its code theirs, kept once used).</summary>
public sealed class Plan
{
    public required string Code { get; set; }
    public required string Name { get; set; }
    /// <summary>Per user who works in the organization, per month.</summary>
    public decimal? PricePerUser { get; set; }
    public string Currency { get; set; } = "EUR";
    public string? Notes { get; set; }
    public bool Active { get; set; } = true;
}

/// <summary>
/// One version of a legal text (terms, privacy notice, data processing agreement…). A new version is published, never an
/// old one changed. A part still to be written by a lawyer is marked <c>[[LAWYER: …]]</c> and read in red everywhere.
/// </summary>
public sealed class LegalDocument
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary><see cref="LegalKinds"/>.</summary>
    public required string Kind { get; set; }
    public int Version { get; set; }
    public required string Title { get; set; }
    public required string Body { get; set; }
    /// <summary>What changed in this version, for whoever accepted the one before.</summary>
    public string? Note { get; set; }
    public Instant PublishedAt { get; set; }
    public required string PublishedBy { get; set; }
}

/// <summary>Who accepted which version of which legal text, for which organization, when.</summary>
public sealed class LegalAcceptance
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public required string UserName { get; set; }
    public required string UserEmail { get; set; }
    public required string Kind { get; set; }
    public int Version { get; set; }
    public Instant At { get; set; }
    public string? Address { get; set; }
}

/// <summary>Where one legal matter stands for the DELIOS team: its list is the app's (<see cref="LegalMatters.All"/>).</summary>
public sealed class LegalMatterState
{
    public required string Key { get; set; }
    /// <summary><see cref="MatterStates"/>.</summary>
    public string Status { get; set; } = MatterStates.ToDo;
    public string? Note { get; set; }
    public Instant UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}

/// <summary>Where a legal matter stands (codes confirmed by the owner, 30 Oct 2026). A must is never NOT_NEEDED.</summary>
public static class MatterStates
{
    public const string ToDo = "TO_DO", Placeholder = "PLACEHOLDER", WithLawyer = "WITH_LAWYER", InForce = "IN_FORCE", NotNeeded = "NOT_NEEDED";
    public static readonly string[] All = [ToDo, Placeholder, WithLawyer, InForce, NotNeeded];
}

/// <summary>
/// An organization letting the DELIOS team in to help (owner, from the advice: "we never read an organization's documents
/// by default"): granted by one of its administrators, for a set time, with why; ended early by them at any time.
/// </summary>
public sealed class SupportGrant
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid GrantedById { get; set; }
    public required string GrantedByName { get; set; }
    public required string Why { get; set; }
    public Instant From { get; set; }
    public Instant Until { get; set; }
    public Instant? EndedAt { get; set; }
    public string? EndedByName { get; set; }
}

/// <summary>A setting of the DELIOS platform itself, set in the console (how organizations reach DELIOS support).</summary>
public sealed class PlatformSetting
{
    public required string Key { get; set; }
    public required string Value { get; set; }
    public Instant UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
}

public static class PlatformKeys
{
    public const string SupportEmail = "SUPPORT_EMAIL", SupportHours = "SUPPORT_HOURS", SupportPhone = "SUPPORT_PHONE";
    /// <summary>How many days a new organization tries DELIOS; 0: no end.</summary>
    public const string TrialDays = "TRIAL_DAYS";
    public static readonly string[] All = [SupportEmail, SupportHours, SupportPhone, TrialDays];
}

/// <summary>Every act of the DELIOS team in its console, kept for good.</summary>
public sealed class OperatorEvent
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid OperatorId { get; set; }
    public required string OperatorName { get; set; }
    public required string Action { get; set; }
    public Guid? TenantId { get; set; }
    public string? Detail { get; set; }
    public Instant At { get; set; }
}

internal sealed class OperatorConfiguration :
    IEntityTypeConfiguration<Operator>, IEntityTypeConfiguration<OperatorSession>, IEntityTypeConfiguration<Subscription>,
    IEntityTypeConfiguration<Plan>, IEntityTypeConfiguration<LegalDocument>, IEntityTypeConfiguration<LegalAcceptance>,
    IEntityTypeConfiguration<LegalMatterState>, IEntityTypeConfiguration<SupportGrant>, IEntityTypeConfiguration<OperatorEvent>,
    IEntityTypeConfiguration<PlatformSetting>
{
    public void Configure(EntityTypeBuilder<Operator> b)
    {
        b.ToTable("operators");
        b.Property(x => x.Email).HasMaxLength(254);
        b.Property(x => x.NormalizedEmail).HasMaxLength(254);
        b.HasIndex(x => x.NormalizedEmail).IsUnique();
        b.Property(x => x.Name).HasMaxLength(200);
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }

    public void Configure(EntityTypeBuilder<OperatorSession> b)
    {
        b.ToTable("operator_sessions");
        b.HasIndex(x => x.TokenHash).IsUnique();
        b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
    }

    public void Configure(EntityTypeBuilder<Subscription> b)
    {
        b.ToTable("subscriptions");
        b.HasKey(x => x.TenantId);
        b.Property(x => x.Plan).HasMaxLength(32);
        b.Property(x => x.State).HasMaxLength(16);
        b.Property(x => x.Billing).HasMaxLength(16);
        b.Property(x => x.ContractRef).HasMaxLength(100);
        b.Property(x => x.ProviderRef).HasMaxLength(200);
        b.Property(x => x.Notes).HasMaxLength(4000);
        b.Property(x => x.UpdatedBy).HasMaxLength(200);
        b.Property(x => x.CancelledBy).HasMaxLength(200);
        b.Property(x => x.PlanAsked).HasMaxLength(32);
        b.Property(x => x.PlanAskedNote).HasMaxLength(2000);
        b.Property(x => x.PlanAskedBy).HasMaxLength(200);
        b.HasIndex(x => x.RemindAt);
    }

    public void Configure(EntityTypeBuilder<Plan> b)
    {
        b.ToTable("plans");
        b.HasKey(x => x.Code);
        b.Property(x => x.Code).HasMaxLength(32);
        b.Property(x => x.Name).HasMaxLength(100);
        b.Property(x => x.Currency).HasMaxLength(3);
        b.Property(x => x.PricePerUser).HasPrecision(10, 2);
        b.Property(x => x.Notes).HasMaxLength(2000);
    }

    public void Configure(EntityTypeBuilder<LegalDocument> b)
    {
        b.ToTable("legal_documents");
        b.Property(x => x.Kind).HasMaxLength(32);
        b.HasIndex(x => new { x.Kind, x.Version }).IsUnique();
        b.Property(x => x.Title).HasMaxLength(200);
        b.Property(x => x.Note).HasMaxLength(2000);
        b.Property(x => x.PublishedBy).HasMaxLength(200);
    }

    public void Configure(EntityTypeBuilder<LegalAcceptance> b)
    {
        b.ToTable("legal_acceptances");
        b.Property(x => x.UserName).HasMaxLength(200);
        b.Property(x => x.UserEmail).HasMaxLength(254);
        b.Property(x => x.Kind).HasMaxLength(32);
        b.Property(x => x.Address).HasMaxLength(64);
        b.HasIndex(x => new { x.TenantId, x.Kind, x.Version });
    }

    public void Configure(EntityTypeBuilder<LegalMatterState> b)
    {
        b.ToTable("legal_matters");
        b.HasKey(x => x.Key);
        b.Property(x => x.Key).HasMaxLength(64);
        b.Property(x => x.Status).HasMaxLength(16);
        b.Property(x => x.Note).HasMaxLength(4000);
        b.Property(x => x.UpdatedBy).HasMaxLength(200);
    }

    public void Configure(EntityTypeBuilder<SupportGrant> b)
    {
        b.ToTable("support_grants");
        b.Property(x => x.GrantedByName).HasMaxLength(200);
        b.Property(x => x.Why).HasMaxLength(2000);
        b.Property(x => x.EndedByName).HasMaxLength(200);
        b.HasIndex(x => x.TenantId);
    }

    public void Configure(EntityTypeBuilder<PlatformSetting> b)
    {
        b.ToTable("platform_settings");
        b.HasKey(x => x.Key);
        b.Property(x => x.Key).HasMaxLength(64);
        b.Property(x => x.Value).HasMaxLength(1000);
        b.Property(x => x.UpdatedBy).HasMaxLength(200);
    }

    public void Configure(EntityTypeBuilder<OperatorEvent> b)
    {
        b.ToTable("operator_events");
        b.Property(x => x.OperatorName).HasMaxLength(200);
        b.Property(x => x.Action).HasMaxLength(64);
        b.Property(x => x.Detail).HasMaxLength(4000);
        b.HasIndex(x => x.At);
        b.HasIndex(x => x.TenantId);
    }
}
