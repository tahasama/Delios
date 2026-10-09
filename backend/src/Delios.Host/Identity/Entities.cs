using NodaTime;

namespace Delios.Host.Identity;

/// <summary>An organization using the system. Every other record belongs to exactly one.</summary>
public sealed class Tenant
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>Short unique name of the organization, in lower case, that people type at sign-in.</summary>
    public required string Slug { get; set; }
    public required string Name { get; set; }
    /// <summary>
    /// False switches the whole organization off: nobody in it can sign in and existing sessions stop working.
    /// </summary>
    public bool Active { get; set; } = true;
    /// <summary>When the row was created; filled in by the database (<c>now()</c>).</summary>
    public Instant CreatedAt { get; set; }
    /// <summary>Everyone signing in with a password must also give a code from their authenticator app.</summary>
    public bool MfaRequired { get; set; }
    /// <summary>
    /// Off when the organization signs in through its own identity provider only.
    /// Administrators keep their password, so a broken provider never locks everyone out.
    /// </summary>
    public bool PasswordSignIn { get; set; } = true;
}

/// <summary>
/// Which organization an email belongs to, so people sign in with their email and password alone. A person belongs to
/// one organization: the email is unique across all of them. Kept by a database trigger on <c>users</c>, outside
/// row-level security (it is read before anyone is known); holds nothing but the email and the organization.
/// </summary>
public sealed class SignInName
{
    /// <summary>The email in upper case, as <c>User.NormalizedEmail</c>.</summary>
    public required string NormalizedEmail { get; set; }
    public Guid TenantId { get; set; }
}

/// <summary>
/// The organization's own identity provider (Microsoft Entra ID, Google, Okta,
/// Keycloak…), spoken to over OpenID Connect. People sign in there; we match
/// them by email to an account that already exists here.
/// </summary>
public sealed class IdentityProvider
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    /// <summary>What the sign-in button says: "Sign in with Contoso".</summary>
    public required string Name { get; set; }
    /// <summary>The issuer, whose /.well-known/openid-configuration describes it.</summary>
    public required string Authority { get; set; }
    /// <summary>The client id the identity provider issued for this system when it was registered there.</summary>
    public required string ClientId { get; set; }
    /// <summary>Encrypted with the application's data protection keys; never returned.</summary>
    public required string ClientSecretProtected { get; set; }
    /// <summary>
    /// OAuth scopes asked for at sign-in, separated by spaces. "openid" is required; "email" is needed to match the person.
    /// </summary>
    public string Scopes { get; set; } = "openid profile email";
    /// <summary>Only emails in these domains are accepted. Empty: any the provider vouches for.</summary>
    public string[] AllowedDomains { get; set; } = [];
    /// <summary>False keeps the settings but stops anyone signing in through this provider.</summary>
    public bool Enabled { get; set; } = true;
}

/// <summary>An organization taking part in projects: ourselves, a contractor, a supplier, the client.</summary>
public sealed class Party
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    /// <summary>Short code for the party, unique within the tenant.</summary>
    public required string Code { get; set; }
    public required string Name { get; set; }
    /// <summary>True for our own organization's party; its people count as internal staff.</summary>
    public bool IsInternal { get; set; }
    /// <summary>Revoking a party ends its people's access without deleting anything.</summary>
    public bool Active { get; set; } = true;
    /// <summary>
    /// How an outside party takes part. IN_APP: their people hold accounts and
    /// answer here. BY_PROXY: one of ours carries the exchange and records their answer.
    /// </summary>
    public string Participation { get; set; } = Participations.InApp;
    /// <summary>The function of ours that carries the exchange for a party that answers by proxy. Empty: Document Control.</summary>
    public string? CustodianFunction { get; set; }
    /// <summary>Their own EDMS or portal, where they impose one, so the record says where it went.</summary>
    public string? ExternalSystem { get; set; }
    /// <summary>Whether an answer recorded on their behalf must carry its proof.</summary>
    public bool EvidenceRequired { get; set; } = true;
}

/// <summary>The allowed values of <c>Party.Participation</c>.</summary>
public static class Participations
{
    /// <summary>The party's people hold accounts and answer in the system themselves.</summary>
    public const string InApp = "IN_APP";
    /// <summary>One of our own people records the party's answers for them.</summary>
    public const string ByProxy = "BY_PROXY";
}

/// <summary>
/// A person who can sign in, within one tenant. Holds the password hash, lockout state and two-step sign-in (MFA) data.
/// Used by the sign-in endpoints, the session store and the permission checks.
/// </summary>
public sealed class User
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string Email { get; set; }
    /// <summary>Upper-cased email: the sign-in lookup key, unique per tenant.</summary>
    public required string NormalizedEmail { get; set; }
    public required string Name { get; set; }
    /// <summary>
    /// The password hashed by ASP.NET Core Identity's <c>PasswordHasher</c>; the password itself is never stored.
    /// </summary>
    public required string PasswordHash { get; set; }
    /// <summary>The party this person represents. Null means our own organization.</summary>
    public Guid? PartyId { get; set; }
    public Party? Party { get; set; }
    /// <summary>False stops the person signing in and ends their sessions, without deleting anything.</summary>
    public bool Active { get; set; } = true;
    /// <summary>Configures the tenant: people, projects, functions, the matrix.</summary>
    public bool IsAdmin { get; set; }
    /// <summary>
    /// Wrong passwords or codes in a row. Reaching <c>IdentityEndpoints.MaxFailedSignIns</c> locks the account and resets this to 0.
    /// </summary>
    public int FailedSignIns { get; set; }
    /// <summary>Sign-in is refused until this moment after too many failures. Null: not locked.</summary>
    public Instant? LockedUntil { get; set; }
    /// <summary>The authenticator secret, encrypted. Set at enrolment; in force once confirmed.</summary>
    public string? MfaSecretProtected { get; set; }
    /// <summary>When two-step sign-in was confirmed. Null: not set up (or set up but not yet confirmed).</summary>
    public Instant? MfaEnabledAt { get; set; }
    /// <summary>The last time step a code was accepted for: a code is used once.</summary>
    public long? MfaLastStep { get; set; }
    /// <summary>One-time codes for a lost phone, hashed. Each is removed when used.</summary>
    public string[] RecoveryCodeHashes { get; set; } = [];
    /// <summary>When the row was created; filled in by the database (<c>now()</c>).</summary>
    public Instant CreatedAt { get; set; }
}

/// <summary>
/// A project the organization works on. People get access through a <c>Membership</c>, and the project's settings drive due dates and file search.
/// </summary>
public sealed class Project
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    /// <summary>Short code, unique within the tenant.</summary>
    public required string Code { get; set; }
    public required string Name { get; set; }
    /// <summary>What we are contracted to do here (EPC, PMC, OWNER…). Rules can apply to one role only.</summary>
    public string ContractRole { get; set; } = "GENERIC";
    /// <summary>The kind of project (BUILDING, INFRASTRUCTURE…), from the organization's own list; GENERIC when none is said.</summary>
    public string Kind { get; set; } = "GENERIC";
    /// <summary>"ACTIVE" or another state; only ACTIVE projects can be opened by members.</summary>
    public string Status { get; set; } = "ACTIVE";
    /// <summary>IANA time zone of the site. Due dates and working days are counted in it.</summary>
    public string TimeZone { get; set; } = "UTC";
    /// <summary>The days the site does not work, ISO numbers (1 Monday … 7 Sunday). Due dates skip them.</summary>
    public int[] WeekendDays { get; set; } = [6, 7];
    /// <summary>
    /// Whether the system may read inside this project's files to search them:
    /// OFF (the default; nothing is read), ON_DEMAND (only what somebody asks for),
    /// AUTOMATIC (every file once it passes scanning). The project's client decides,
    /// so it is set per project: one contractor works for clients who choose differently.
    /// </summary>
    public string ContentExtraction { get; set; } = "OFF";
    /// <summary>When the row was created; filled in by the database (<c>now()</c>).</summary>
    public Instant CreatedAt { get; set; }
}

/// <summary>A job as the organization names it: Lead Electrical Engineer, Document Control.</summary>
public sealed class Function
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public required string Code { get; set; }
    public required string Name { get; set; }
    /// <summary>False takes the function out of use: memberships with it no longer give access.</summary>
    public bool Active { get; set; } = true;
    /// <summary>The permission matrix rows that belong to this function.</summary>
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
    /// <summary>
    /// The project contract role (see <c>Project.ContractRole</c>) this rule applies to. Null: every project.
    /// </summary>
    public string? ProjectRole { get; set; }
    /// <summary>
    /// The document family the row was written about, as a label: a family row is kept as one rule per document type
    /// in the family, each carrying the family's code, so the matrix reads back as the family it was written as.
    /// </summary>
    public string? Family { get; set; }
    /// <summary>Where the rule came from, in words (for example "Read from a filled-in distribution matrix").</summary>
    public string? Note { get; set; }
    /// <summary>What the rule allows, from the constants in <c>Verbs</c>.</summary>
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
    /// <summary>When the session started; filled in by the database (<c>now()</c>).</summary>
    public Instant CreatedAt { get; set; }
    /// <summary>When the session ends unless renewed (see <c>SessionStore.RenewIfDueAsync</c>).</summary>
    public Instant ExpiresAt { get; set; }
    /// <summary>When the person signed out. Null: still open.</summary>
    public Instant? RevokedAt { get; set; }
}

/// <summary>
/// The actions a permission rule can allow (read, create, review, approve and so on). Stored as text in <c>PermissionRule.Verbs</c>.
/// </summary>
public static class Verbs
{
    public const string Read = "READ";
    public const string Create = "CREATE";
    public const string Revise = "REVISE";
    public const string Review = "REVIEW";
    public const string Approve = "APPROVE";
    /// <summary>Send documents out to another party in a transmittal.</summary>
    public const string Transmit = "TRANSMIT";
    /// <summary>Be proposed as an internal recipient of a document (someone who receives it for action).</summary>
    public const string Receive = "RECEIVE";
    public const string Accept = "ACCEPT";
    /// <summary>
    /// Document Control rights: act on any document of the project, not only one's own (registers, transmittals, schedules).
    /// </summary>
    public const string Control = "CONTROL";
    public const string Configure = "CONFIGURE";

    /// <summary>Every verb in one set; the demo data uses it to give Document Control every right.</summary>
    public static readonly IReadOnlySet<string> All = new HashSet<string>
    {
        Read, Create, Revise, Review, Approve, Transmit, Receive, Accept, Control, Configure,
    };
}
