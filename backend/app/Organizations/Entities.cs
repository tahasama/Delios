using NodaTime;

namespace Delios.Host.Organizations;

/// <summary>
/// A link between two organizations that both have DELIOS: the host's record of the other (its party, with its code)
/// stands for the other's own organization. The host invites through someone it knows there (an email); the other's
/// administrator accepts or refuses; either side may end it. Not a tenant table: both organizations read it.
/// </summary>
public sealed class OrganizationLink
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>The organization whose projects the other works on, and its record of the other.</summary>
    public Guid HostTenantId { get; set; }
    public Guid HostPartyId { get; set; }
    /// <summary>The party's code and name as the host knows them, for the other side to read.</summary>
    public required string HostPartyCode { get; set; }
    public required string HostPartyName { get; set; }
    /// <summary>The other organization, found by the email the host invited.</summary>
    public Guid GuestTenantId { get; set; }
    public required string InvitedEmail { get; set; }
    public string State { get; set; } = LinkStates.Invited;
    public Instant InvitedAt { get; set; }
    public required string InvitedByName { get; set; }
    /// <summary>Accepted or refused: when, by whom, and what they wrote.</summary>
    public Instant? AnsweredAt { get; set; }
    public string? AnsweredByName { get; set; }
    public string? AnswerNote { get; set; }
    /// <summary>Ended: when, by whom, which side ("HOST" or "GUEST"), and why.</summary>
    public Instant? EndedAt { get; set; }
    public string? EndedByName { get; set; }
    public string? EndedBySide { get; set; }
    public string? EndReason { get; set; }
}

/// <summary>Where a link between two organizations stands.</summary>
public static class LinkStates
{
    public const string Invited = "INVITED", Linked = "LINKED", Refused = "REFUSED", Ended = "ENDED";
}

/// <summary>
/// One person's own account (at home, where they sign in) linked to the account that stands for them in another
/// organization (the host), on that organization's projects. Not a tenant table: both organizations read it.
/// </summary>
public sealed class AccountLink
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid LinkId { get; set; }
    public Guid HomeTenantId { get; set; }
    public Guid HomeUserId { get; set; }
    public Guid HostTenantId { get; set; }
    public Guid HostUserId { get; set; }
    public Instant CreatedAt { get; set; }
    public Instant? EndedAt { get; set; }
}

/// <summary>
/// An organization taking part in one of our projects, with the role it plays there and, for a collaborator, the
/// function its people start with when their administrator puts them on it.
/// </summary>
public sealed class ProjectParty
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid ProjectId { get; set; }
    public Identity.Project? Project { get; set; }
    public Guid PartyId { get; set; }
    /// <summary>The role it plays on the project, from the published CONTRACT_ROLES. Optional.</summary>
    public string? Role { get; set; }
    public Guid? StartFunctionId { get; set; }
    public Identity.Function? StartFunction { get; set; }
    public bool Active { get; set; } = true;
    public Instant AddedAt { get; set; }
    public required string AddedByName { get; set; }
}
