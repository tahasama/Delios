namespace Delios.Host.Operators;

/// <summary>The legal texts DELIOS publishes, by kind: who reads them, and whether a new organization accepts them.</summary>
public static class LegalKinds
{
    public const string Terms = "TERMS", Privacy = "PRIVACY", Dpa = "DPA", Subprocessors = "SUBPROCESSORS", Security = "SECURITY",
        Sla = "SLA", AcceptableUse = "ACCEPTABLE_USE", Cookies = "COOKIES", Imprint = "IMPRINT";

    public sealed record Kind(string Code, string Slug, string Title, string Lead, bool Accepted);

    /// <summary>In the order they are listed; <c>Accepted</c>: an organization accepts it when it signs up, and again at each new version.</summary>
    public static readonly Kind[] All =
    [
        new(Terms, "terms", "Terms of service", "What DELIOS is, what we promise, what each side answers for.", true),
        new(Dpa, "dpa", "Data processing agreement", "What we keep for each organization, only on its instructions (GDPR Article 28).", true),
        new(Privacy, "privacy", "Privacy notice", "What we keep about the people who sign in, why, for how long, and whom to ask.", false),
        new(Subprocessors, "subprocessors", "Subprocessors", "The companies that handle data for us, and for what.", false),
        new(Security, "security", "Security", "How the data is protected, kept and given back.", false),
        new(Sla, "sla", "Service levels", "How available DELIOS is, how fast we answer, and what happens when we fall short.", false),
        new(AcceptableUse, "acceptable-use", "Acceptable use", "What DELIOS may not be used for.", false),
        new(Cookies, "cookies", "Cookies", "The cookies DELIOS sets, and why none of them follows anyone.", false),
        new(Imprint, "imprint", "Legal notice", "Who runs DELIOS: the company, its address, its registration.", false),
    ];

    public static Kind? Of(string? codeOrSlug) =>
        All.FirstOrDefault(k => string.Equals(k.Code, codeOrSlug, StringComparison.OrdinalIgnoreCase) || string.Equals(k.Slug, codeOrSlug, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// The text a kind starts from before anything is published (version 0). What the app does is written; what only a
    /// lawyer may write is marked <c>[[LAWYER: …]]</c>, read in red on every page that shows it.
    /// </summary>
    public static string Starting(string kind) => kind switch
    {
        Terms => """
            ## Who we are
            [[LAWYER: The company that runs DELIOS: its legal name, registered address, registration number and VAT number.]]

            ## What DELIOS is
            DELIOS is a document management service for engineering and construction projects, run by us and used through a
            web browser. Each organization has its own space; organizations working on the same project link their spaces.

            ## Business use only
            DELIOS is sold to businesses and public bodies, for their work. It is not offered to consumers.
            [[LAWYER: The clause excluding consumers, and what happens if a consumer signs up anyway.]]

            ## Your account and your people
            Your organization's administrators decide who has an account and what each person may do. You answer for what your
            people do in DELIOS and for keeping their sign-in details safe.

            ## Your data stays yours
            Everything your organization puts in DELIOS remains yours. We keep it for you, on your instructions, as the data
            processing agreement says. You may take it out at any time.
            [[LAWYER: Ownership of content, the licence you give us to host and process it, and nothing more.]]

            ## Plans, prices and payment
            The plan, the price per user and how you pay are shown before you pay and on your organization's page. A yearly
            renewal is announced 30 days before. You may cancel from your organization's Settings; it ends at the end of the
            period paid. If a payment is missed, your organization reads only: everyone keeps reading and exporting, nobody
            adds or changes, and nothing is deleted.
            [[LAWYER: Payment terms, late payment, price changes, taxes, refunds.]]

            ## What we promise
            [[LAWYER: Availability (with reference to the service levels), support, warranties and their limits.]]

            ## What each side answers for
            [[LAWYER: Limitation and exclusion of liability, the cap, indemnities.]]

            ## When the contract ends
            Your data is handed back to you as an export, then deleted after the time agreed in the data processing agreement.
            [[LAWYER: Term, termination for convenience and for breach, what survives the end.]]

            ## Changes to these terms
            A new version is announced to your administrators before it applies, and accepted by one of them.
            [[LAWYER: How changes are notified and when they take effect; the right to leave if you do not agree.]]

            ## The law and the courts
            [[LAWYER: The governing law and the competent courts or arbitration.]]
            """,
        Dpa => """
            ## The parties and their roles
            Your organization decides why and how the data in its space is used: it is the controller. We keep and process it
            only on your instructions: we are the processor (GDPR Article 28).
            [[LAWYER: The parties, how this agreement attaches to the terms, and which prevails.]]

            ## What is processed
            - The documents, revisions, reviews, transmittals and every record your people put in DELIOS.
            - About the people who sign in: name, email, function, organization, what they did and when (the audit trail),
              what they opened and downloaded where your organization keeps it, sign-ins.
            - For as long as your organization uses DELIOS, and for the time after the end set below.
            [[LAWYER: Categories of data subjects and of personal data, special categories (none expected), duration.]]

            ## Only on your instructions
            We use your data only to run DELIOS for you. We never read your files: search reads only a document's number and
            title; text inside files is never extracted.
            [[LAWYER: Documented instructions, and what happens if an instruction would break the law.]]

            ## Confidentiality and security
            Everyone working on DELIOS is bound to confidentiality. The measures are described on the Security page, which is
            part of this agreement.
            [[LAWYER: Confidentiality undertaking; Article 32 measures as an annex.]]

            ## Subprocessors
            The companies that handle data for us are listed on the Subprocessors page. A new one is announced before it
            starts, and you may object.
            [[LAWYER: General written authorisation, notice period, right to object and its consequence.]]

            ## Helping you
            We help you answer your people's requests (access, correction, erasure: a person's name and email are replaced while
            what they did stays in the records, which your register must keep), and with security and impact assessments.
            [[LAWYER: Assistance with data subject rights, DPIAs and prior consultation; costs.]]

            ## If something goes wrong
            We tell your administrators without undue delay after we learn of a breach affecting your data, with what we know.
            [[LAWYER: Breach notification: content, timing (so you can meet your 72 hours), cooperation.]]

            ## At the end
            Your data is handed back as an export, then deleted from DELIOS after the agreed time, and from backups when they
            expire.
            [[LAWYER: The number of days, deletion of copies, certification of deletion.]]

            ## Audits
            [[LAWYER: Information and audit rights, frequency, notice, costs.]]

            ## Transfers outside the EU
            [[LAWYER: Where data is hosted, and the safeguards for any transfer (standard contractual clauses).]]
            """,
        Privacy => """
            ## Who is responsible
            For what your organization puts in DELIOS, your organization is responsible: ask its administrators first. For
            your account with us, our website and our customers' contacts, we are.
            [[LAWYER: The controller's identity and contact details; the data protection officer, if any.]]

            ## What we keep, and why
            - Your name, email, organization and function: to give you your account.
            - What you do in DELIOS (the audit trail): the register has to prove who did what, and when.
            - What you opened and downloaded, where your organization keeps it, and your sign-ins: for security.
            - Our customers' contacts and invoices: to run the contract and keep the accounts.
            [[LAWYER: The legal basis of each purpose (contract, legitimate interest, legal obligation).]]

            ## How long
            Activity is kept for as long as your organization chooses; the audit trail for as long as the register it proves.
            [[LAWYER: Retention periods for each kind of data, including billing records.]]

            ## Who else sees it
            The companies listed on the Subprocessors page, only to run DELIOS. Nobody else, and nothing is sold.

            ## Your rights
            You may ask to see, correct or erase what is kept about you, to limit it or object to it, and to take it with you.
            Asked of DELIOS, we pass the request to your organization, which decides for its space.
            [[LAWYER: How to exercise rights, the reply time, and the right to complain to a supervisory authority.]]

            ## Cookies
            See the Cookies page: only what DELIOS needs to work, nothing that follows you.
            """,
        Subprocessors => """
            ## Who handles data for us
            [[LAWYER: Confirm each company, its role, its location and the safeguards before publishing.]]

            - Hosting (servers, database, file storage): [[LAWYER: provider, country]]
            - Email sending: [[LAWYER: provider, country]]
            - Payments and invoicing (seller of record): [[LAWYER: provider, country]]
            - Robot check on sign-in, only when switched on (Cloudflare Turnstile): Cloudflare, Inc. [[LAWYER: country and safeguards]]

            ## Changes
            A new subprocessor is announced to every organization's administrators before it starts.
            """,
        Security => """
            ## Your data apart
            Each organization's data is kept apart in the database itself (row-level security), not only by the application.

            ## Files
            Every file is encrypted before it is stored, with a key of its own; nobody downloads from storage directly: every
            download passes the check of who may read it. Every file is checked for viruses on arrival.

            ## Sign-in
            Passwords are never stored, only their hash. Two-step sign-in may be asked of everyone. An organization may use its
            own sign-in (single sign-on). Repeated failed sign-ins lock the account for a while.

            ## What is recorded
            Every act that changes something is written to an audit trail that cannot be altered without it showing.

            ## Copies
            Every file is copied to a second place as it is stored; the database is backed up.
            [[LAWYER: Backup frequency, retention and location, to be confirmed with the hosting set-up.]]

            ## If something goes wrong
            [[LAWYER: Incident and breach procedure, and whom to contact.]]
            """,
        Sla => """
            ## Availability
            [[LAWYER: The availability promised each month, how it is measured, planned maintenance windows.]]

            ## Support
            [[LAWYER: Support hours, channels, response times by severity.]]

            ## When we fall short
            [[LAWYER: Service credits and how they are claimed.]]
            """,
        AcceptableUse => """
            ## Not allowed
            - Anything unlawful, or infringing someone else's rights.
            - Trying to reach another organization's data, or testing DELIOS's security without our written agreement.
            - Overloading DELIOS on purpose, or using it to spread malicious files.
            [[LAWYER: Complete the list; suspension and termination for breach.]]
            """,
        Cookies => """
            ## What DELIOS sets
            - Your session, so you stay signed in. Necessary.
            - Your display choices: light or dark, the menu's width, a pane's width, which filters you show. Necessary for the
              screens to look as you left them.

            ## What DELIOS does not set
            No analytics, no advertising, nothing that follows you elsewhere. That is why no consent banner is shown.
            [[LAWYER: Confirm that only strictly necessary cookies are set, under the ePrivacy rules of the countries served.]]
            """,
        Imprint => """
            [[LAWYER: The company's legal name, legal form, registered address, registration number and court, VAT number,
            share capital where required, the people who represent it, and a contact email and telephone number, as the
            countries we sell in require (for example Germany's §5 DDG, France's mentions légales).]]
            """,
        _ => "[[LAWYER: To be written.]]",
    };
}

/// <summary>
/// Every legal matter running DELIOS for many organizations brings (owner: "list every legal matter we must/may have"),
/// in the order they come: before the first customer, while the service runs, as it grows. The list is the app's; where
/// each stands, and its notes, are the DELIOS team's (<see cref="LegalMatterState"/>).
/// </summary>
public static class LegalMatters
{
    public sealed record Matter(string Key, string Group, bool Must, string Title, string What, string? Text = null);

    public const string BeforeFirst = "Before the first paying customer", Running = "While the service runs", Growing = "As DELIOS grows";

    public static readonly Matter[] All =
    [
        new("COMPANY", BeforeFirst, true, "A company that signs the contracts",
            "A legal entity of ours: registered, with its address, registration and VAT numbers, a bank account. It is the party in every contract and on every invoice."),
        new("TERMS", BeforeFirst, true, "Terms of service",
            "What DELIOS is, business use only, what we promise and what we do not, liability capped, the law and courts chosen, how the terms change. Accepted by each organization when it signs up, and again at each new version.", LegalKinds.Terms),
        new("DPA", BeforeFirst, true, "Data processing agreement (GDPR Article 28)",
            "Signed with every organization: we keep its data only on its instructions, our security, our subprocessors, our help with its people's requests, breach notice, audits, and its data handed back then deleted at the end.", LegalKinds.Dpa),
        new("PRIVACY", BeforeFirst, true, "Privacy notice (GDPR Articles 13 and 14)",
            "For the people who sign in and for the website: what is kept (names, emails, the audit trail, what was opened and downloaded, sign-ins), why, for how long, who sees it, their rights. Linked from the sign-in page.", LegalKinds.Privacy),
        new("SUBPROCESSORS", BeforeFirst, true, "List of subprocessors",
            "Hosting, email, payments, Cloudflare's robot check when switched on. Kept up to date, each change announced before it starts, organizations may object.", LegalKinds.Subprocessors),
        new("DATA_LOCATION", BeforeFirst, true, "Where the data lives, and transfers",
            "Hosted in the EU, said in the contract. Any subprocessor outside the EU needs standard contractual clauses and a transfer impact assessment."),
        new("SECURITY", BeforeFirst, true, "Security measures (GDPR Article 32)",
            "What protects the data: separation per organization, encrypted files, virus check, audit trail, two-step sign-in, backups. Published, and an annex to the data processing agreement.", LegalKinds.Security),
        new("CONSUMERS", BeforeFirst, true, "Business customers only",
            "Said in the terms and at sign-up. Consumer rules (a cancel button, automatic renewal limits, a 14-day withdrawal) then do not apply; we still cancel in one click and announce a yearly renewal 30 days before."),
        new("TAX", BeforeFirst, true, "VAT and invoices",
            "Either a seller of record (Paddle, Stripe acting as seller) collects and files VAT in each country and issues invoices, or we register where needed and issue compliant invoices ourselves, e-invoicing included where required."),
        new("IMPRINT", BeforeFirst, true, "Legal notice on the website",
            "The company's identity, address, registration and contact, as Germany (DDG §5), France (mentions légales) and others require.", LegalKinds.Imprint),
        new("COOKIES", BeforeFirst, true, "Cookies",
            "DELIOS sets only what it needs (the session, display choices): no consent banner while it stays so. Any analytics added later waits for consent.", LegalKinds.Cookies),
        new("INSURANCE", BeforeFirst, true, "Insurance",
            "Professional liability and cyber insurance, sized to the liability cap in the terms."),
        new("RECORDS", Running, true, "Records of processing (GDPR Article 30)",
            "Ours as processor (what we do for organizations) and as controller (our staff, our customers' contacts, billing)."),
        new("BREACH", Running, true, "Breach procedure",
            "Who decides, how organizations are told without undue delay (so they meet their 72 hours), when we tell the authority for our own data, the log of incidents."),
        new("REQUESTS", Running, true, "People's requests",
            "Access, correction, erasure: passed to the organization concerned. Erasure is by anonymizing a person (name and email replaced) while their acts stay in the records the register must keep (GDPR Article 17(3))."),
        new("RETENTION", Running, true, "How long each kind of data is kept",
            "Activity (opened, downloaded) as each organization chooses, then removed by itself; the audit trail with its register; backups; billing records as tax law asks."),
        new("EXIT", Running, true, "End of contract",
            "The organization's data handed back as an export, then deleted after the agreed time, copies included: the one exception to \"nothing is deleted\"."),
        new("SUPPORT_ACCESS", Running, true, "Support access",
            "We never open an organization's documents by default: only once one of its administrators grants it, for a set time, every act recorded."),
        new("ACCEPTANCES", Running, true, "Proof of acceptance",
            "Who accepted which version of the terms and the data processing agreement, for which organization, when: kept for good."),
        new("SLA", Growing, false, "Service levels",
            "Availability promised, support hours and response times, credits when we fall short. Large clients ask for it.", LegalKinds.Sla),
        new("ACCEPTABLE_USE", Growing, false, "Acceptable use",
            "What DELIOS may not be used for, and suspension for breach.", LegalKinds.AcceptableUse),
        new("DPO", Growing, false, "Data protection officer, EU representative",
            "A data protection officer if our processing becomes large-scale monitoring; an EU representative (Article 27) if the company sits outside the EU."),
        new("DPIA", Growing, false, "Impact assessment",
            "Keeping what employees opened and downloaded may call for a data protection impact assessment: ours to help with, the organization's to make."),
        new("STAFF", Growing, false, "Staff representatives",
            "In some countries (Germany's works councils) an organization must agree activity tracking with its staff representatives first: said in the terms and the data processing agreement."),
        new("CRA", Growing, false, "Cyber Resilience Act",
            "A hosted service sits mostly outside it. Handing a copy of DELIOS to an organization makes it a product: vulnerability reporting from 11 September 2026, every duty from 11 December 2027."),
        new("NIS2", Growing, false, "NIS2 and customers' security clauses",
            "Customers in critical sectors pass their own supplier-security duties on to us: questionnaires, audits, incident notice."),
        new("SIGNATURES", Growing, false, "Signatures",
            "The review stamp records who decided, when; it is not a qualified electronic signature (eIDAS). Said in the terms; a qualified signature would be a service of its own."),
        new("LICENCES", Growing, false, "Open-source licences and trademark",
            "The open-source components' licences honoured and listed; the DELIOS name protected as a trademark."),
        new("ESCROW", Growing, false, "Source code escrow",
            "Some large clients ask for the source code to be held by a third party, released if we stop."),
        new("SANCTIONS", Growing, false, "Sanctions and export control",
            "Customers checked against sanctions lists before a contract."),
        new("ACCESSIBILITY", Growing, false, "Accessibility",
            "The European Accessibility Act targets consumer services; public-sector clients may ask for accessibility (EN 301 549) in their tenders."),
    ];
}
