namespace Delios.Host.Platform;

/// <summary>
/// Who runs this DELIOS (owner: build it ready to be sold or run by others; "the owner role" an option, not a must).
/// Run by DELIOS (<c>HOSTED=true</c>, the default): trials, plans, invoices, renewals and "reads only" apply, managed in
/// the console. Run by the organization itself (<c>HOSTED=false</c>, a copy installed for one company or by a partner):
/// none of that exists; every organization simply works, nothing is ever read only for a plan or a payment, and the
/// console keeps only what a team running it needs (organizations, legal texts, support, notices, team, log).
/// Read once at start (<c>Platform:Hosted</c>).
/// </summary>
public static class Hosting
{
    public static bool ByDelios { get; private set; } = true;

    public static void Read(IConfiguration config) => ByDelios = config.GetValue("Platform:Hosted", true);

    /// <summary>The refusal of a plan, a payment or an invoice where the organization runs DELIOS itself.</summary>
    public static IResult NotHosted() =>
        Problems.Conflict("NOT_HOSTED", "This DELIOS is run by the organization itself: there are no plans, payments or invoices.");
}
