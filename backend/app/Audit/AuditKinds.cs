namespace Delios.Host.Audit;

/// <summary>
/// The kinds of act in the audit trail, worked out once from each act's code (the screens read the kind, never the
/// code): reviews, releases, returns and ends, transmittals, packages, the schedule, the register, people and
/// settings, reading, sign-ins. Each kind has its own side colour on the screens (lib/core/rails.ts, "Audit trail").
/// Every code the app writes is named here; a new one falls to the register until it is placed.
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

    private static readonly Dictionary<string, string[]> Codes = new()
    {
        ["READING"] = ["DOCUMENT_VIEWED", "DOWNLOAD", "ACTIVITY_READ", "TRANSMITTAL_OPENED"],
        ["SIGN_IN"] = ["SIGN_IN", "SIGN_IN_MFA", "SIGN_IN_SSO", "SIGN_IN_FAILED", "LOGIN", "ACCOUNT_LOCKED", "MFA_ENABLED", "MFA_DISABLED",
            "MFA_FAILED", "MFA_RESET", "PASSWORD_RESET", "PASSWORD_RESET_ASKED", "SSO_CONFIGURED", "SECURITY_POLICY_CHANGED", "SWITCHED_IN",
            "ACCESS_REFUSED"],
        ["REVIEW"] = ["REVIEW_STARTED", "REVIEW_ISSUED", "STEP_DISPATCHED", "ADVICE", "VERDICT", "REVIEW_DECIDED", "REVIEW_SENT_BACK_TO_STEP", "COMMENT_CHANGED",
            "COMMENT_WITHDRAWN", "COMMENT_CLOSED", "DELEGATION_REQUESTED", "DELEGATION_GRANTED", "DELEGATION_REFUSED", "DELEGATION_WITHDRAWN",
            "OUTSIDE_APPROVAL_ASKED", "OUTSIDE_APPROVED", "OUTSIDE_REFUSED", "RESUBMITTED"],
        ["RELEASE"] = ["RELEASED", "SENT_FOR_RELEASE", "ISSUED", "ISSUE_REQUESTED", "SUPERSEDED", "STAMPED", "STAMP_NOT_POSSIBLE"],
        ["RETURN"] = ["RETURNED_TO_AUTHOR", "RETURNED_FOR_CORRECTION", "RETURNED_TO_SENDER", "WITHDRAWN_FOR_UPDATE", "APPROVAL_WITHDRAWN",
            "DECISION_REVERSED", "VOIDED", "UNVOIDED", "VOID_REASSESSED", "LEGAL_HOLD", "REVISION_HELD", "REVISION_HOLD_LIFTED", "HELD_RETURNED",
            "HANDED_BACK", "HAND_BACK_REFUSED", "ASKED_BACK", "STATE_TRANSITION"],
        ["TRANSMITTAL"] = ["TRANSMITTAL_ISSUED", "TRANSMITTAL_RECEIVED", "TRANSMITTAL_ACKNOWLEDGED", "TRANSMITTAL_DISPATCHED", "TRANSMITTAL_CHASED",
            "TRANSMITTAL_FILES_KEPT", "EMAIL_REPLY_RECEIVED", "EMAIL_REPLY_SET_ASIDE", "SUPPLY_REQUESTED", "SENT_TO_SUPPLIER", "SUBMISSION_ACCEPTED"],
        ["PACKAGE"] = ["PACKAGE_CREATED", "PACKAGE_CHANGED", "PACKAGE_RULE", "PACKAGE_SHARED", "PACKAGE_UNSHARED", "PACKAGE_MEMBERS_ADDED",
            "PACKAGE_MEMBERS_REMOVED", "PACKAGE_DELIVERED", "PACKAGE_ASSESSED", "PACKAGE_ACCEPTED", "PACKAGE_CLOSED", "PACKAGE_DELETED",
            "SHORTFALL_ISSUED", "SHORTFALL_ACCEPTED"],
        ["SCHEDULE"] = ["SCHEDULE_READ", "SCHEDULE_NOT_READ", "SCHEDULE_SOURCE_SET", "SCHEDULE_DAYS_SET", "DEPARTMENTS_READ", "DEPARTMENTS_NOT_READ", "DEPARTMENTS_NOTIFIED",
            "REQUIREMENTS_READ", "REQUIREMENTS_NOT_READ", "REQUIREMENTS_ISSUED", "REQUIREMENT_CALL", "REQUIREMENT_CALL_ANSWERED",
            "REQUIREMENT_CALL_REMINDED", "LIST_READ_FROM_UPLOAD", "LIST_UPLOADED_WITHOUT_DOCUMENT", "ACTIVITY_DECISION", "ACTIVITY_DEPARTMENTS",
            "ACTIVITY_REQUEST_ANSWERED", "ACTIVITY_REQUEST_CHECKED", "ACTIVITY_REQUEST_CONFIRMED", "ACTIVITY_REQUEST_REFUSED", "READINESS_CONFIRMED",
            "READINESS_REVOKED", "POSTPONEMENT_CONFIRMED", "NEED_ADDED", "NEED_REMOVED", "NEED_WAIVED", "NEED_WAIVER_WITHDRAWN", "NOTICE_SENT",
            "CONTROLLED_UPLOADED", "CONTROLLED_SUBMITTED", "CONTROLLED_APPROVED", "CONTROLLED_REJECTED", "CONTROLLED_DISCARDED"],
        ["REGISTER"] = ["REGISTER_ENTRY", "UNPLANNED_REGISTERED", "METADATA_CHANGE", "REVISION_ESTABLISHED", "FILE_UPLOADED", "FILES_UPDATED",
            "FILE_CLEAN", "REVISION_FILES_READY", "REVISION_FILES_REJECTED", "RECORD_CONFIRMED", "RECORD_CORRECTED", "RELATIONSHIP", "ASSET_ADDED",
            "ASSET_UPDATED", "ASSET_RETIRED", "CHECK_RUN", "CHECK_SWITCHED_ON", "CHECK_SWITCHED_OFF", "DEFECT_ACCEPTED", "EXCEPTION_RECORDED",
            "CONTENT_EXTRACTED", "EXTRACTION_REQUESTED", "EXTRACTION_MODE_CHANGED", "NUMBER_RANGE_ISSUED"],
        ["PEOPLE"] = ["USER_CREATED", "USER_UPDATED", "SIGN_UP", "EMAIL_CONFIRMED", "MEMBERSHIP_CHANGED", "PERSON_CONFIRMED", "PERSON_REFUSED",
            "PERSON_JOINED_PROJECT", "PERSON_LEFT_PROJECT", "LINKED_PERSON_ADDED", "LINKED_PERSON_REMOVED", "GUEST_BROUGHT_OVER", "GRANT_ALL",
            "CONTROL_PEOPLE", "ACCESS_GRANTED", "ACCESS_REVOKED", "FUNCTION_CREATED", "FUNCTION_UPDATED", "PARTY_CREATED", "PARTY_UPDATED",
            "ORGANIZATION_IDENTIFIED", "DOMAIN_LINK_SENT", "DOMAIN_CONFIRMED", "ORGANIZATION_CLAIMED", "CLAIM_VOUCHED", "CLAIM_REFUSED", "MERGE_ASKED", "MERGE_AGREED", "MERGE_REFUSED",
            "PROJECT_CREATED", "PROJECT_UPDATED", "PROJECT_JOINED", "PROJECT_PARTY_SET", "PROJECT_PARTY_REMOVED", "ORGANIZATION_INVITED",
            "ORGANIZATION_INVITATION_RECEIVED", "ORGANIZATION_LINKED", "ORGANIZATION_REFUSED", "ORGANIZATION_LINK_ENDED", "TENANT_CREATED",
            "SETTING_CHANGED", "LIBERTY_CHANGED", "SETTING_RESET", "SETTING_PUT_BACK", "VALUE_CHANGED", "VALUE_DELETED", "LIST_CREATED", "LIST_CHANGED", "LIST_DELETED", "SET_CREATED", "SET_CHANGED", "SET_DELETED", "NUMBERING_SCHEME_CREATED", "NUMBERING_SCHEME_UPDATED", "NUMBERING_SCHEME_DELETED", "NUMBERING_ROUTED",
            "REVISION_SCHEME_CREATED", "REVISION_SCHEME_UPDATED", "REVISION_SCHEME_ROUTED", "ROUTE_CREATED", "ROUTE_UPDATED",
            "VERDICT_LIST_CREATED", "VERDICT_LIST_CHANGED"],
    };

    private static readonly Dictionary<string, string> ByCode = Codes.SelectMany(k => k.Value.Select(code => (code, k.Key)))
        .ToDictionary(x => x.code, x => x.Key);

    private static bool Starts(string action, params string[] prefixes) => prefixes.Any(action.StartsWith);

    /// <summary>The kind of one act, from its code: named above, else by the start of its code, else the register.</summary>
    public static string Of(string action) => ByCode.TryGetValue(action, out var kind) ? kind : action switch
    {
        _ when Starts(action, "SIGN_IN", "MFA_", "PASSWORD", "SSO_", "SECURITY_") => "SIGN_IN",
        _ when Starts(action, "REVIEW", "STEP_", "COMMENT", "DELEGATION", "OUTSIDE_") => "REVIEW",
        _ when Starts(action, "RETURN", "WITHDRAW", "VOID", "HOLD", "CANCEL", "REINSTATE") => "RETURN",
        _ when Starts(action, "TRANSMITTAL", "EMAIL_REPLY") => "TRANSMITTAL",
        _ when Starts(action, "PACKAGE", "SHORTFALL") => "PACKAGE",
        _ when Starts(action, "ACTIVITY", "READINESS", "SCHEDULE", "REQUIREMENT", "DEPARTMENTS", "NEED_", "CONTROLLED_") => "SCHEDULE",
        _ when Starts(action, "USER_", "PERSON_", "PROJECT_", "ORGANIZATION", "FUNCTION_", "PARTY_", "SETTING", "ROUTE_", "NUMBERING") => "PEOPLE",
        _ => "REGISTER",
    };

    /// <summary>
    /// The document a revision or a file of the log belongs to, so the screens open the document from either: entity id
    /// to document id, for the rows given.
    /// </summary>
    public static async Task<Dictionary<Guid, Guid>> DocumentsOfAsync(Platform.DeliosDbContext db, IEnumerable<AuditEvent> rows,
        CancellationToken cancellationToken)
    {
        var revisions = rows.Where(e => e.EntityType == "Revision" && e.EntityId != null).Select(e => e.EntityId!.Value).Distinct().ToList();
        var files = rows.Where(e => e.EntityType == "StoredFile" && e.EntityId != null).Select(e => e.EntityId!.Value).Distinct().ToList();
        var found = new Dictionary<Guid, Guid>();
        if (revisions.Count > 0)
            foreach (var r in await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToListAsync(
                         db.Revisions.Where(r => revisions.Contains(r.Id)).Select(r => new { r.Id, r.DocumentId }), cancellationToken))
                found[r.Id] = r.DocumentId;
        if (files.Count > 0)
            foreach (var f in await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToListAsync(
                         db.StoredFiles.Where(f => files.Contains(f.Id) && f.DocumentId != null).Select(f => new { f.Id, f.DocumentId }), cancellationToken))
                found[f.Id] = f.DocumentId!.Value;
        return found;
    }

    private static readonly System.Text.RegularExpressions.Regex IdPattern =
        new(@"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b", System.Text.RegularExpressions.RegexOptions.Compiled);

    /// <summary>
    /// What the ids written inside these acts' details stand for (a scheme, a route, a person, an organization, a
    /// document…), so a detail reads with names (owner: an id is never shown).
    /// </summary>
    public static async Task<Dictionary<Guid, string>> NamesInAsync(Platform.DeliosDbContext db, IEnumerable<AuditEvent> rows,
        CancellationToken cancellationToken)
    {
        var ids = rows.Where(e => e.Detail != null).SelectMany(e => IdPattern.Matches(e.Detail!).Select(m => Guid.Parse(m.Value))).Distinct().ToList();
        var names = new Dictionary<Guid, string>();
        if (ids.Count == 0) return names;
        async Task Add<T>(IQueryable<T> rowsOf, System.Linq.Expressions.Expression<Func<T, KeyValuePair<Guid, string>>> pick)
        {
            foreach (var one in await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToListAsync(rowsOf.Select(pick), cancellationToken))
                names.TryAdd(one.Key, one.Value);
        }
        await Add(db.NumberingSchemes.Where(x => ids.Contains(x.Id)), x => new KeyValuePair<Guid, string>(x.Id, x.Name));
        await Add(db.RevisionSchemes.Where(x => ids.Contains(x.Id)), x => new KeyValuePair<Guid, string>(x.Id, x.Name));
        await Add(db.ReviewRoutes.Where(x => ids.Contains(x.Id)), x => new KeyValuePair<Guid, string>(x.Id, x.Name));
        await Add(db.ListSets.Where(x => ids.Contains(x.Id)), x => new KeyValuePair<Guid, string>(x.Id, x.Name));
        await Add(db.Functions.Where(x => ids.Contains(x.Id)), x => new KeyValuePair<Guid, string>(x.Id, x.Name));
        await Add(db.Users.Where(x => ids.Contains(x.Id)), x => new KeyValuePair<Guid, string>(x.Id, x.Name));
        await Add(db.Parties.Where(x => ids.Contains(x.Id)), x => new KeyValuePair<Guid, string>(x.Id, x.Name));
        await Add(db.Projects.Where(x => ids.Contains(x.Id)), x => new KeyValuePair<Guid, string>(x.Id, x.Code));
        await Add(db.Documents.Where(x => ids.Contains(x.Id)), x => new KeyValuePair<Guid, string>(x.Id, x.Number));
        return names;
    }

    /// <summary>A detail with every id in it put as the name it stands for; one no longer found reads "(removed)".</summary>
    public static string? Readable(string? detail, IReadOnlyDictionary<Guid, string> names) =>
        detail is null ? null : IdPattern.Replace(detail, m => names.TryGetValue(Guid.Parse(m.Value), out var name) ? name : "(removed)");
}
