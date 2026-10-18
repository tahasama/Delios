using System.Text.Json;
using Delios.Host.Audit;
using Delios.Host.Documents;
using Delios.Host.Identity;
using Delios.Host.Platform;
using Delios.Host.Tenancy;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Delios.Host.Settings;

/// <summary>A field the organization or the project added to a form, as kept (setting <c>OWN_FIELDS:{form}</c>).</summary>
/// <param name="Retired">Answered at least once, then taken off the form: no longer asked; the answers given stay on their records.</param>
public sealed record OwnField(string Id, string Key, string Label, string Control, string? SetKey, string Rule, string? Help, bool InRegister,
    bool Retired = false);

/// <summary>What one form asks, as the screens and the checks read it.</summary>
public sealed record FormView(string Form, IReadOnlyDictionary<string, string> Rules, IReadOnlyDictionary<string, string> Labels,
    IReadOnlyList<OwnField> Own, IReadOnlyList<string>? Used = null);

/// <summary>Body of saving one form: each field's rule and name, the fields of one's own, and each list's rule.</summary>
public sealed record FormRequest(Dictionary<string, string?>? Rules, Dictionary<string, string?>? Labels, OwnField[]? Own);

/// <summary>
/// What each form asks for, and what it insists on (Forms &amp; fields), worked out once here and checked on every save
/// (owner: rules live in the backend, an import or a script included). A project's forms are the project's: until it
/// changes one it reads the organization's (the default), and its first change gives it its own copy, which later
/// changes of the organization never touch (<c>FORMS_OWN</c>). Opening a project and adding an organization are the
/// organization's acts, so their forms stay the organization's. The control function changes a project's forms (on a
/// project with none, whoever opened it); an administrator the organization's.
/// </summary>
public static class FormRules
{
    public const string RuleKey = "FIELD_RULE:";
    public const string LabelKey = "FIELD_LABEL:";
    public const string OwnKey = "OWN_FIELDS:";
    /// <summary>Marks a project that keeps its own forms (its copy made on its first change).</summary>
    public const string OwnFormsKey = "FORMS_OWN";

    public const string Required = "REQUIRED";
    public const string Optional = "OPTIONAL";
    public const string Off = "OFF";

    /// <summary>A field of the app's on a form the organization may insist on or leave out: its key and how it stands by default.</summary>
    public sealed record Field(string Key, string Label, string Fallback);

    /// <summary>
    /// The app's fields each form may make required or leave out. A field the record cannot do without (a document's
    /// title, type, discipline, deliverable type; a transmittal's recipients and type) is not here: it is always asked.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, Field[]> Forms = new Dictionary<string, Field[]>
    {
        ["DOCUMENT"] =
        [
            new("subProject", "Sub-project", Optional), new("phase", "Phase", Optional),
            new("contractRef", "Contract or purchase order", Optional), new("criticality", "Criticality", Required),
            new("confidentiality", "Who may see it", Optional), new("retentionClass", "Retention period", Optional),
            new("plannedDate", "Planned date", Optional),
        ],
        ["REVISION"] = [new("changeDescription", "What changed, and why", Required)],
        ["TRANSMITTAL"] = [new("subject", "Subject", Required), new("message", "Message", Optional), new("cc", "Copy to", Optional)],
        ["REVIEW"] = [new("copies", "Copied in", Optional)],
        ["PACKAGE"] = [new("description", "Description", Optional), new("completionDate", "Due", Optional), new("po", "Contract or purchase order", Optional)],
        ["ASSET"] = [new("system", "System", Optional), new("area", "Area", Optional), new("unit", "Unit", Optional)],
        ["PROJECT"] = [new("startDate", "Start date", Optional), new("endDate", "End date", Optional), new("scopeStatement", "Scope", Optional)],
        ["PARTY"] = [new("contactId", "Who answers for it here", Optional), new("backupId", "Backup", Optional), new("liaisonFunction", "Who of ours works for it", Optional)],
    };

    /// <summary>The forms that are the organization's (its acts), not a project's.</summary>
    public static readonly HashSet<string> OrganizationForms = ["PROJECT", "PARTY"];

    /// <summary>Whether a project keeps its own forms.</summary>
    private static async Task<bool> OwnsAsync(DeliosDbContext db, Guid projectId, CancellationToken cancellationToken) =>
        await db.Set<Setting>().AsNoTracking().AnyAsync(s => s.ProjectId == projectId && s.Key == OwnFormsKey, cancellationToken);

    /// <summary>The settings a form is read from: the project's own copy, else the organization's.</summary>
    private static async Task<Dictionary<string, string>> SourceAsync(DeliosDbContext db, Guid? projectId, string form, CancellationToken cancellationToken)
    {
        Guid? scope = projectId is { } id && !OrganizationForms.Contains(form) && await OwnsAsync(db, id, cancellationToken) ? id : null;
        return await db.Set<Setting>().AsNoTracking()
            .Where(s => s.ProjectId == scope && (s.Key.StartsWith(RuleKey + form + ":") || s.Key.StartsWith(LabelKey + form + ":") || s.Key == OwnKey + form))
            .ToDictionaryAsync(s => s.Key, s => s.Value, cancellationToken);
    }

    private static List<OwnField> ReadOwn(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<List<OwnField>>(json, JsonSerializerOptions.Web) ?? []; }
        catch (JsonException) { return []; }
    }

    /// <summary>What one form asks on a project (or, for the organization's forms, on none).</summary>
    public static async Task<FormView> ReadAsync(DeliosDbContext db, Guid? projectId, string form, CancellationToken cancellationToken)
    {
        var source = await SourceAsync(db, projectId, form, cancellationToken);
        var fields = Forms.GetValueOrDefault(form) ?? [];
        var rules = fields.ToDictionary(f => f.Key, f => source.GetValueOrDefault($"{RuleKey}{form}:{f.Key}") is { } r && IsRule(r) ? r : f.Fallback);
        var labels = source.Where(s => s.Key.StartsWith($"{LabelKey}{form}:")).ToDictionary(s => s.Key[(LabelKey.Length + form.Length + 1)..], s => s.Value);
        var own = ReadOwn(source.GetValueOrDefault(OwnKey + form));
        return new FormView(form, rules, labels, own, projectId is { } id ? [.. await UsedAsync(db, id, form, cancellationToken)] : []);
    }

    /// <summary>
    /// The fields of one's own a record of this form on the project carries an answer to: answered at least once, they
    /// are retired, never taken away, and what they ask (the kind of answer, the list) stays as it was.
    /// </summary>
    public static async Task<HashSet<string>> UsedAsync(DeliosDbContext db, Guid projectId, string form, CancellationToken cancellationToken)
    {
        IQueryable<string?> stored = form switch
        {
            "DOCUMENT" => db.Documents.AsNoTracking().Where(d => d.ProjectId == projectId).Select(d => d.Extras),
            "TRANSMITTAL" => db.Transmittals.AsNoTracking().Where(t => t.ProjectId == projectId).Select(t => t.Extras),
            "PACKAGE" => db.Packages.AsNoTracking().Where(p => p.ProjectId == projectId).Select(p => p.Extras),
            "ASSET" => db.Set<Records.Asset>().AsNoTracking().Where(a => a.ProjectId == projectId).Select(a => a.Extras),
            _ => Enumerable.Empty<string?>().AsQueryable(),
        };
        var used = new HashSet<string>(StringComparer.Ordinal);
        if (stored is not IAsyncEnumerable<string?>) return used;
        foreach (var json in await stored.Where(e => e != null).ToListAsync(cancellationToken))
        {
            try
            {
                foreach (var (key, value) in JsonSerializer.Deserialize<Dictionary<string, string>>(json!) ?? [])
                    if (!string.IsNullOrWhiteSpace(value)) used.Add(key);
            }
            catch (JsonException) { }
        }
        return used;
    }

    private static bool IsRule(string value) => value is Required or Optional or Off;

    /// <summary>
    /// What a save of this form leaves empty that the form insists on: the app's fields (by what was given), the fields
    /// of one's own and, on a document, the lists of one's own (by the answers kept with it). A field left out is never
    /// asked, so its absence refuses nothing. Refused as FIELDS_REQUIRED, naming each field so the form outlines it.
    /// </summary>
    public static async Task<IResult?> CheckAsync(DeliosDbContext db, Guid? projectId, string form, IReadOnlyDictionary<string, bool> given,
        IReadOnlyDictionary<string, string?>? extras, CancellationToken cancellationToken, IReadOnlyCollection<string>? only = null)
    {
        var view = await ReadAsync(db, projectId, form, cancellationToken);
        var missing = new List<(string Key, string Label)>();
        foreach (var field in Forms.GetValueOrDefault(form) ?? [])
        {
            if (only is not null && !only.Contains(field.Key)) continue;
            if (view.Rules[field.Key] == Required && !given.GetValueOrDefault(field.Key))
                missing.Add((field.Key, view.Labels.GetValueOrDefault(field.Key) ?? field.Label));
        }
        if (only is null)
        {
            bool Filled(string key) => extras is not null && !string.IsNullOrWhiteSpace(extras.GetValueOrDefault(key));
            foreach (var own in view.Own.Where(o => !o.Retired && o.Rule == Required && !Filled(o.Key))) missing.Add(($"own:{own.Key}", own.Label));
        }
        if (missing.Count == 0) return null;
        var names = missing.Select(m => m.Label.ToLowerInvariant()).ToList();
        return Problems.Invalid("FIELDS_REQUIRED",
            $"Fill in {(names.Count == 1 ? names[0] : $"{string.Join(", ", names[..^1])} and {names[^1]}")}: this {Noun(form)} is not saved without {(names.Count == 1 ? "it" : "them")} (Settings, Forms & fields).",
            new { fields = missing.Select(m => m.Key).ToList() });
    }

    private static string Noun(string form) => form switch
    {
        "DOCUMENT" => "document", "REVISION" => "revision", "TRANSMITTAL" => "transmittal", "PACKAGE" => "package",
        "ASSET" => "tag", "PROJECT" => "project", "PARTY" => "organization", _ => "form",
    };

    /// <summary>
    /// The answers kept with a document to the fields of the project's own that are chosen from a list: each must be a
    /// value of that list in use, offered for the document's deliverable type (owner: forms follow the sets).
    /// </summary>
    public static async Task<IResult?> CheckChoiceAnswersAsync(DeliosDbContext db, Guid projectId, Catalog catalog, string? deliverableType,
        IReadOnlyDictionary<string, string?>? extras, CancellationToken cancellationToken)
    {
        if (extras is null || extras.Count == 0) return null;
        foreach (var field in (await ReadAsync(db, projectId, "DOCUMENT", cancellationToken)).Own.Where(o => o.Control == "CHOICE" && o.SetKey is not null))
        {
            if (extras.GetValueOrDefault(field.Key) is not { Length: > 0 } value) continue;
            if (!catalog.IsActive(field.SetKey!, value))
                return Problems.Invalid("VALUE_NOT_PUBLISHED", $"{value} is not a value of {field.Label} in use.", new { field = $"own:{field.Key}", value });
            if (!catalog.IsOfferedFor(field.SetKey!, value, deliverableType))
                return Problems.Invalid("VALUE_NOT_FOR_TYPE", $"{value} is not offered for this deliverable type.", new { field = $"own:{field.Key}", value });
        }
        return null;
    }

    /// <summary>
    /// A document's answers by the list they are chosen from, for a number part reading a list of one's own
    /// (<c>LIST:&lt;key&gt;</c>): the answer to the document form's field drawing from that list.
    /// </summary>
    public static async Task<IReadOnlyDictionary<string, string?>> ListAnswersAsync(DeliosDbContext db, Guid projectId,
        IReadOnlyDictionary<string, string?>? extras, CancellationToken cancellationToken)
    {
        var answers = new Dictionary<string, string?>();
        if (extras is null) return answers;
        foreach (var field in (await ReadAsync(db, projectId, "DOCUMENT", cancellationToken)).Own.Where(o => o.Control == "CHOICE" && o.SetKey is not null))
            if (extras.GetValueOrDefault(field.Key) is { Length: > 0 } value) answers.TryAdd(field.SetKey!, value);
        return answers;
    }

    public static void MapFormEndpoints(this IEndpointRouteBuilder app)
    {
        var project = app.MapGroup("/api/projects/{projectId:guid}/forms").WithTags("Settings")
            .AddEndpointFilter<TransactionFilter>().AddEndpointFilter<ProjectAccessFilter>();
        project.MapGet("", async (HttpContext h, DeliosDbContext db, CancellationToken c) =>
        {
            var access = ProjectAccessFilter.Of(h);
            var forms = new List<FormView>();
            foreach (var form in Forms.Keys) forms.Add(await ReadAsync(db, access.Project.Id, form, c));
            return Results.Ok(new
            {
                forms,
                own = await OwnsAsync(db, access.Project.Id, c),
                mayChange = await ProjectLists.MayChangeAsync(db, access, c),
                mayChangeOrganization = await Keepers.ConfiguresAsync(h),
            });
        });
        project.MapPut("/{form}", SaveAsync);
        // The organization's forms (opening a project, adding an organization), read where no project is open.
        app.MapGroup("/api/forms").WithTags("Settings").RequireAuthorization().AddEndpointFilter<TransactionFilter>()
            .MapGet("/{form}", async (string form, DeliosDbContext db, CancellationToken c) =>
                Forms.ContainsKey(form.ToUpperInvariant()) ? Results.Ok(await ReadAsync(db, null, form.ToUpperInvariant(), c)) : Problems.NotFound("FORM_NOT_FOUND", "No such form."));
    }

    /// <summary>
    /// <c>PUT /forms/{form}</c>: one form's rules, names, fields of one's own and lists' rules. A project's form is saved
    /// into the project's own copy (made first, from the organization's); the organization's forms by an administrator.
    /// </summary>
    private static async Task<IResult> SaveAsync(string form, FormRequest request, HttpContext http, DeliosDbContext db, AuditLog audit,
        IClock clock, CancellationToken cancellationToken)
    {
        var access = ProjectAccessFilter.Of(http);
        form = form.ToUpperInvariant();
        if (!Forms.ContainsKey(form)) return Problems.NotFound("FORM_NOT_FOUND", "No such form.");
        var organization = OrganizationForms.Contains(form);
        if (organization ? !await Keepers.ConfiguresAsync(http) : !await ProjectLists.MayChangeAsync(db, access, cancellationToken))
            return Problems.Forbidden("CONTROL_ONLY", organization
                ? "Opening a project and adding an organization are the organization's: an administrator decides what they ask."
                : "Whoever acts as the control function on this project decides what its forms ask (on a project with none, whoever opened it).");
        Guid? scope = organization ? null : access.Project.Id;
        if (scope is { } projectId && !await OwnsAsync(db, projectId, cancellationToken))
        {
            // The project's own copy of every form, from the organization's, before its first change.
            var originals = await db.Set<Setting>().AsNoTracking()
                .Where(s => s.ProjectId == null && (s.Key.StartsWith(RuleKey) || s.Key.StartsWith(LabelKey) || s.Key.StartsWith(OwnKey)))
                .ToListAsync(cancellationToken);
            foreach (var one in originals.Where(o => !OrganizationForms.Any(f => o.Key.Contains(f + ":") || o.Key.EndsWith(":" + f) || o.Key == OwnKey + f)))
                db.Add(new Setting { TenantId = access.Project.TenantId, ProjectId = projectId, Key = one.Key, Value = one.Value, UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = access.UserName });
            db.Add(new Setting { TenantId = access.Project.TenantId, ProjectId = projectId, Key = OwnFormsKey, Value = "1", UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = access.UserName });
            await db.SaveChangesAsync(cancellationToken);
        }
        var changes = new List<string>();
        async Task PutAsync(string key, string? value)
        {
            var row = await db.Set<Setting>().SingleOrDefaultAsync(s => s.ProjectId == scope && s.Key == key, cancellationToken);
            var was = row?.Value;
            if (string.IsNullOrWhiteSpace(value)) { if (row is not null) db.Remove(row); }
            else if (row is null) db.Add(new Setting { TenantId = access.Project.TenantId, ProjectId = scope, Key = key, Value = value.Trim(), UpdatedAt = clock.GetCurrentInstant(), UpdatedByName = access.UserName });
            else { row.Value = value.Trim(); row.UpdatedAt = clock.GetCurrentInstant(); row.UpdatedByName = access.UserName; }
            if ((was ?? "") != (value?.Trim() ?? "")) changes.Add($"{key[(key.IndexOf(':') + 1)..]}: {was ?? "(default)"} → {(string.IsNullOrWhiteSpace(value) ? "(default)" : value.Trim())}");
        }
        var fields = Forms[form];
        foreach (var (key, rule) in request.Rules ?? [])
        {
            var field = fields.FirstOrDefault(f => f.Key == key);
            if (field is null || rule is null || !IsRule(rule)) continue;
            await PutAsync($"{RuleKey}{form}:{key}", rule == field.Fallback ? null : rule);
        }
        foreach (var (key, label) in request.Labels ?? [])
            await PutAsync($"{LabelKey}{form}:{key}", label is { Length: > 0 } && label.Trim().Length <= 60 ? label : null);
        if (request.Own is { } own)
        {
            foreach (var one in own)
            {
                if (string.IsNullOrWhiteSpace(one.Label) || one.Label.Length > 60) return Problems.Invalid("LABEL_REQUIRED", "A field has a name of at most 60 characters.");
                if (!IsRule(one.Rule)) return Problems.Invalid("RULE_INVALID", $"{one.Label}: say whether it must be filled.");
                if (one.Control == "CHOICE" && string.IsNullOrWhiteSpace(one.SetKey)) return Problems.Invalid("LIST_REQUIRED", $"{one.Label}: a field chosen from a list names the list.");
                if (one.Control != "CHOICE" && one.SetKey is not null) return Problems.Invalid("LIST_ONLY_FOR_A_CHOICE", $"{one.Label}: only a field chosen from a list names a list.");
            }
            // A field answered at least once is retired, never taken away, and keeps the kind of answer and the list it asks.
            if (scope is { } formProject)
            {
                var used = await UsedAsync(db, formProject, form, cancellationToken);
                var before = (await ReadAsync(db, formProject, form, cancellationToken)).Own;
                foreach (var was in before.Where(b => used.Contains(b.Key)))
                {
                    var now = own.FirstOrDefault(o => o.Key == was.Key);
                    if (now is null)
                        return Problems.Conflict("FIELD_IN_USE", $"{was.Label} has been answered: retire it instead, and its answers stay on their records.");
                    if (now.Control != was.Control || now.SetKey != was.SetKey)
                        return Problems.Conflict("FIELD_IN_USE", $"{was.Label} has been answered: what it asks stays as it is. Retire it and add a new field instead.");
                }
            }
            await PutAsync(OwnKey + form, own.Length == 0 ? null : JsonSerializer.Serialize(own, JsonSerializerOptions.Web));
        }
        await db.SaveChangesAsync(cancellationToken);
        if (changes.Count > 0)
            await audit.WriteAsync(new Actor(access.UserId, access.UserName), "FORM_CHANGED", "Setting", null, form, string.Join("; ", changes),
                organization ? null : access.Project.Id, cancellationToken);
        return Results.NoContent();
    }
}
