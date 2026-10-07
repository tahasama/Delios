using NodaTime;

namespace Delios.Host.Identity;

/// <summary>An organization using the system. Every other record belongs to exactly one.</summary>
public sealed class Tenant
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required string Slug { get; set; }
    public required string Name { get; set; }
    public bool Active { get; set; } = true;
    public Instant CreatedAt { get; set; }
}

/// <summary>An organization taking part in projects: ourselves, a contractor, a supplier, the client.</summary>
public sealed class Party
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string Code { get; set; }
    public required string Name { get; set; }
    public bool IsInternal { get; set; }
    /// <summary>Revoking a party ends its people's access without deleting anything.</summary>
    public bool Active { get; set; } = true;
}

public sealed class User
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string Email { get; set; }
    /// <summary>Upper-cased email: the sign-in lookup key, unique per tenant.</summary>
    public required string NormalizedEmail { get; set; }
    public required string Name { get; set; }
    public required string PasswordHash { get; set; }
    /// <summary>The party this person represents. Null means our own organization.</summary>
    public Guid? PartyId { get; set; }
    public Party? Party { get; set; }
    public bool Active { get; set; } = true;
    /// <summary>Configures the tenant: people, projects, functions, the matrix.</summary>
    public bool IsAdmin { get; set; }
    public int FailedSignIns { get; set; }
    public Instant? LockedUntil { get; set; }
    public Instant CreatedAt { get; set; }
}

public sealed class Project
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    /// <summary>Short code, unique within the tenant.</summary>
    public required string Code { get; set; }
    public required string Name { get; set; }
    /// <summary>What we are contracted to do here (EPC, PMC, OWNER…). Rules can apply to one role only.</summary>
    public string ContractRole { get; set; } = "GENERIC";
    public string Status { get; set; } = "ACTIVE";
    /// <summary>IANA time zone of the site. Due dates and working days are counted in it.</summary>
    public string TimeZone { get; set; } = "UTC";
    /// <summary>The days the site does not work, ISO numbers (1 Monday … 7 Sunday). Due dates skip them.</summary>
    public int[] WeekendDays { get; set; } = [6, 7];
    public Instant CreatedAt { get; set; }
}

/// <summary>A job as the organization names it: Lead Electrical Engineer, Document Control.</summary>
public sealed class Function
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string Code { get; set; }
    public required string Name { get; set; }
    public bool Active { get; set; } = true;
    public List<PermissionRule> Rules { get; set; } = [];
}

/// <summary>
/// One row of the permission matrix: what a function may do, to which documents.
/// A null selector means any value.
/// </summary>
public sealed class PermissionRule
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid FunctionId { get; set; }
    public string? DeliverableType { get; set; }
    public string? DocType { get; set; }
    public string? Discipline { get; set; }
    public string? Criticality { get; set; }
    public string? Confidentiality { get; set; }
    public string? ProjectRole { get; set; }
    public string[] Verbs { get; set; } = [];
}

/// <summary>A person's function on one project. One function per person per project.</summary>
public sealed class Membership
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Guid UserId { get; set; }
    public Guid FunctionId { get; set; }
    public Function? Function { get; set; }
    public Project? Project { get; set; }
    /// <summary>The discipline this person answers for on the project.</summary>
    public string? Department { get; set; }
    public bool Active { get; set; } = true;
}

/// <summary>A signed-in browser. The cookie holds a random token; only its hash is stored.</summary>
public sealed class Session
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public required byte[] TokenHash { get; set; }
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public Instant CreatedAt { get; set; }
    public Instant ExpiresAt { get; set; }
    public Instant? RevokedAt { get; set; }
}

public static class Verbs
{
    public const string Read = "READ";
    public const string Create = "CREATE";
    public const string Revise = "REVISE";
    public const string Review = "REVIEW";
    public const string Approve = "APPROVE";
    public const string Transmit = "TRANSMIT";
    public const string Receive = "RECEIVE";
    public const string Accept = "ACCEPT";
    public const string Control = "CONTROL";
    public const string Configure = "CONFIGURE";

    public static readonly IReadOnlySet<string> All = new HashSet<string>
    {
        Read, Create, Revise, Review, Approve, Transmit, Receive, Accept, Control, Configure,
    };
}
