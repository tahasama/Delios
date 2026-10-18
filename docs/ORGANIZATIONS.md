# Organizations working together

Agreed with the owner. Every organization can have DELIOS. Nobody is forced to register to work with us.

## Three ways another organization works on our project

```
Collaborator      they have their own DELIOS organization.
                  Their people sign in with their own accounts (one login per person),
                  see our project among theirs, and their administrator manages them.
                  They can run their own projects with their own suppliers.

Guest             they have no DELIOS organization.
                  We create accounts for their people inside ours, for the work.
                  We close them when the work is done.

Not on DELIOS     nobody of theirs signs in.
                  They have a code (it goes into document numbers), and one of our people
                  records what they send and answers for them, with proof.
                  With an email for transmittals, ours reach them by email (files attached), and
                  their reply to that email comes back to the transmittal for Document Control to
                  record. Only replies: there is no open project mailbox.
```

A company can move up later without losing anything:

```
Not on DELIOS ──> Collaborator   they register; we link our record of them to their organization.
                                 Their people then see everything recorded for them, under the same
                                 code and the same document numbers.
Guest ─────────> Collaborator   their company registers and links; its administrator brings each guest
                                 account over (organization page): the person signs in at home from then
                                 on, with the same email and password, and keeps every project here.
```

## How it works underneath

```
A project belongs to the organization that opened it. Its data stays there.

Our organization (host)                         Their organization (collaborator)
  Party "ACME" ──── linked to ───────────────>  ACME's own organization
  Project P1001 ─── ACME takes part, as SUPPLIER
     their person on P1001  <── linked to ────  that person's own account (password, two-step sign-in)
```

- **A link between two organizations.** We invite them through someone we know there (an email address).
  Their administrator accepts. Our record of them (the party, with its code) is then linked to their
  organization. Either side can end the link. Their accounts on our projects then stop.
- **Taking part in a project.** On each of our projects we say which organizations take part, and the role
  each plays (owner, EPC, supplier…). For a collaborator, we also say the function their people start with.
- **Their people on our project.** Their administrator chooses which of their people work on our project.
  Each gets a linked account in our organization, holding the function we gave. We can change the function
  or take them off. They sign in at home only. Opening our project switches them into it, and back.
- **When someone leaves them.** Their administrator switches the person off at home, and every linked
  account goes with it.
- **What they see.** The same as any other organization's people on our project: what was sent to them,
  and their own documents. Organization fencing in the database is unchanged: our data stays in our
  organization.

## The organization's admin page

```
Projects          ours (we opened them) and joined (another organization's), with our role in each,
                  status, our people on it. Open, change, archive, reopen ours (/organization/projects,
                  always with why). A project's Settings shows only that project.
People            everyone in our organization, which projects each is on (ours and joined),
                  two-step sign-in, last sign-in. Invite, switch off, unlock.
                  Choose which of our people work on a joined project.
Companies         the organizations we work with: collaborators (linked), guests, not on DELIOS.
                  Invitations we sent, invitations we received (accept or refuse).
Defaults          the configuration a new project of ours starts with: who does what, how the project
                  works (/organization/defaults). Changed there directly, each answer marked the app's
                  or ours; can start from one project's choices; "Reset to the app's defaults".
                  Copied when the project is opened; the project then changes it freely, each answer
                  marked "as the defaults" or "changed here", and "Reset to the organization's defaults"
                  puts it back. Changing the defaults later changes only projects opened afterwards.
                  A project we join follows its owner's configuration.
Settings          the same cards as a project's Settings (/organization/settings), on the organization's
                  version, the default of every project. Each card carries its switch: Fixed, every project
                  uses ours as it is; Free, a project may take its own copy, which our changes never touch.
                  Made fixed later, a project's copy stays. Each card lists the projects with their own copy;
                  only there may one be put back to ours, for a mess, with why (its control function told).
Security, audit   sign-in rules for the whole organization; the audit trail of all its projects.
```

## One code and one name across DELIOS

An organization is one row in DELIOS's register (`OrganizationIdentity`, `Organizations/Registry.cs`, kept outside every
organization's data): one code and one name, the same in every list that holds it. Adding an organization already known
takes its code and name; a code or name of another is refused. The code and the name change once each (a mistake put
right), carried to every list holding it; an organization on DELIOS alone changes its own. Every value ever used (project
codes and names, organization codes and names, contract numbers) stays reserved to what used it (`reserved_values`).
Each organization taking part in a project carries the number of its contract with the project's organization
(`ProjectParty.ContractNumber`), unique on DELIOS, changed once.

Each carries an identifier with its country (company registration, else tax number, else professional register, else a
public body's), or why it has none, and its email domain. **Add** takes one already on DELIOS as it is and invites it to
link; **Create** makes one that is not, naming look-alikes first (same identifier, same domain, a name that reads the
same). An organization on DELIOS proves its domain by a link to an address there, then claims the entries others made
for it at that domain. Duplicates are merged: asked with why, agreed by each side, carried out by the app's owner
(`merge-organizations`); the merged one's values stay reserved and point to the one kept, and a list that held both keeps
both lines. Asking for someone of an organization on DELIOS brings that organization onto the project.

A claim (an organization on DELIOS saying an entry others recorded is it) passes nothing until it is confirmed: by the
guest who stood for that entry, through a link sent to their email; or, with no guest, by the organization that recorded
it, which vouches or refuses with why. People of another organization keep their own function, shown with their company
("ACME / Lead Engineer"); what they may do here follows their organization's role with us. A guest organization has one
account.

Not yet joined up by itself: a collaborator linked under a code other than its own (merge them).

## Our role in a project

Optional, said when the project is opened (ours) or when we take part (theirs). The list of roles is the
organization's published list, CONTRACT_ROLES; until it is published, the app's own stand in:

```
GENERIC        Not stated
EPC            EPC — engineer, procure, construct
EPCM           EPCM — engineer, procure, construction management
PMC            PMC — project management consultancy
DESIGN         Design office / architect
OWNER          Owner / operator
CM             Construction management
CONTRACTOR     Main contractor (builds only)
SUBCONTRACTOR  Subcontractor
SUPPLIER       Supplier / manufacturer / vendor
INSPECTOR      Third-party inspector / certifier
```

Codes never change once used: new roles are added only with the owner's approval (frontend
`lib/settings/profiles/roles.ts`, each with its starting matrix, and backend `BuiltInRoles`).

## Steps

```
1. Links between organizations, invitations, accepting, ending.
2. Organizations taking part in a project, with their role and starting function.
3. Linked accounts: their administrator puts their people on our project; one sign-in; switching in and out.
4. The admin page: projects, people, companies, defaults, security and audit.
5. Moving up: a "not on DELIOS" party, or guests, linked to an organization that registers later.
```

All five steps are built.
