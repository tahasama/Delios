namespace Delios.Host.Audit;

/// <summary>
/// The kinds of act in the audit trail, worked out once from each act's code (the screens read the kind, never the
/// code): reviews, releases, returns and ends, transmittals, packages, the schedule, the register, people and
/// settings, reading, sign-ins. Each kind has its own side colour on the screens (lib/core/rails.ts, "Audit trail").
/// </summary>
public static class AuditKinds
{
    /// <summary>The kinds, in the order the screens list them: key and the words for it.</summary>
    public static readonly (string Key, string Label)[] All =
    [
        ("REVIEW", "Reviews and decisions"),
        ("RELEASE", "Releases and issues"),
        ("RETURN", "Returns, holds and ends"),
        ("TRANSMITTAL", "Transmittals"),
        ("PACKAGE", "Packages"),
        ("SCHEDULE", "Schedule"),
        ("REGISTER", "The register"),
        ("PEOPLE", "People and settings"),
        ("READING", "Opened and downloaded"),
        ("SIGN_IN", "Sign-ins and security"),
    ];

    private static bool Starts(string action, params string[] prefixes) => prefixes.Any(action.StartsWith);

    /// <summary>The kind of one act, from its code.</summary>
    public static string Of(string action) => action switch
    {
        "DOCUMENT_VIEWED" or "DOWNLOAD" or "TRANSMITTAL_OPENED" or "ACTIVITY_READ" => "READING",
        _ when Starts(action, "SIGN_IN", "LOGIN", "ACCOUNT_", "MFA_", "PASSWORD", "SSO_", "SECURITY_", "SESSION") => "SIGN_IN",
        _ when Starts(action, "RETURN", "WITHDRAW", "VOID", "UNVOID", "HELD", "REVISION_HELD", "REVISION_HOLD", "LEGAL_HOLD", "HOLD",
            "CANCEL", "REINSTATE", "DECISION_REVERSED", "APPROVAL_WITHDRAWN") => "RETURN",
        _ when Starts(action, "REVIEW", "STEP_", "COMMENT", "DELEGATION", "APPROVAL", "OUTSIDE_APPROVAL", "WORKFLOW", "CONDITION") => "REVIEW",
        _ when Starts(action, "RELEASE", "ISSUE", "SENT_FOR_RELEASE", "SUPERSEDED", "REVISION_ESTABLISHED") => "RELEASE",
        _ when Starts(action, "TRANSMITTAL", "EMAIL_REPLY", "SUPPLY_", "CUSTODY") => "TRANSMITTAL",
        _ when Starts(action, "PACKAGE", "SHORTFALL") => "PACKAGE",
        _ when Starts(action, "ACTIVITY", "READINESS", "POSTPONEMENT", "NEED_", "SCHEDULE", "REQUIREMENT", "DEPARTMENTS", "NOTICE") => "SCHEDULE",
        _ when Starts(action, "USER_", "MEMBERSHIP", "PERSON_", "PROJECT_", "ORGANIZATION", "GUEST_", "GRANT_ALL", "CONTROL_", "SETTING",
            "FUNCTION", "PERMISSION", "CONFIG", "TENANT", "ACCESS_", "VISITOR", "SCOPE", "TEMPLATE") => "PEOPLE",
        _ => "REGISTER",
    };
}
