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
```

A company can move up later without losing anything:

```
Not on DELIOS ──> Collaborator   they register; we link our record of them to their organization.
                                 Their people then see everything recorded for them, under the same
                                 code and the same document numbers.
Guest ─────────> Collaborator   their company registers; the guest accounts are linked to their
                                 people's own accounts. History stays.
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
                  status, our people on it. Open, archive, reopen ours.
People            everyone in our organization, which projects each is on (ours and joined),
                  two-step sign-in, last sign-in. Invite, switch off, unlock.
                  Choose which of our people work on a joined project.
Companies         the organizations we work with: collaborators (linked), guests, not on DELIOS.
                  Invitations we sent, invitations we received (accept or refuse).
Defaults          the configuration a new project of ours starts with: who does what, how the project
                  works. Copied when the project is opened; the project then changes it freely.
                  Changing the defaults later changes only projects opened afterwards.
                  A project we join follows its owner's configuration.
Security, audit   sign-in rules for the whole organization; the audit trail of all its projects.
```

## Our role in a project

Optional, said when the project is opened (ours) or when we take part (theirs). The list of roles is the
organization's published list, CONTRACT_ROLES. Codes never change once used: new roles are added only
with the owner's approval.

## Steps

```
1. Links between organizations, invitations, accepting, ending.
2. Organizations taking part in a project, with their role and starting function.
3. Linked accounts: their administrator puts their people on our project; one sign-in; switching in and out.
4. The admin page: projects, people, companies, defaults, security and audit.
5. Moving up: a "not on DELIOS" party, or guests, linked to an organization that registers later.
```
