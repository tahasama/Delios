# Walkthrough and test checklist

Ordinary use, one pass per role. Everyone signs in with `demo1234`.

Set it up (or reset it) with:

```bash
npm run demo
```

`npm run demo` loads the demo project, the requirements process, the DMP, one
review waiting on you, and the walkthrough documents below. The walkthrough
owns every document whose title starts with `WALK`; re-running it rebuilds
only those.

## The people

| Sign in as | Who they are | What they see |
|---|---|---|
| `author@delios.local` | Author, Electrical | Their own drafts; can create and send for review |
| `reviewer@delios.local` | Reviewer | Documents waiting for advice |
| `approver@delios.local` | Lead engineer | Documents waiting for the verdict |
| `controller@delios.local` | Document Control | Everything: release, issue, check what arrives |
| `client@delios.local` | ONEE, the client | Only what was issued to them |
| `vendor@delios.local` | MADASUD, a supplier | Only their own package and documents |
| `admin@delios.local` | Administrator | All of the above, plus Settings |

## The documents it prepares

| # | Where it stands | Sign in as |
|---|---|---|
| WALK 1 | A draft with its author | author |
| WALK 2 | Out for advice | reviewer |
| WALK 3 | Advice given; waiting on the decision | approver |
| WALK 4 | Decided "to be IFC", not released | controller |
| WALK 5 | Released at IFC, nobody told | controller |
| WALK 6 | Released at IFA and issued to the client | client |
| WALK 7 | Arrived from MADASUD, waiting to be checked | controller |

---

## 1 · Author

- [ ] Home lists **Your drafts** with WALK 1.
- [ ] Documents: the register opens, WALK 1 reads **In preparation**.
- [ ] Open WALK 1 → **Attach a file** works, and the preview shows it.
- [ ] **Send for review / approval**: the route is drawn left to right, people
      are proposed, and you can add or remove one.
- [ ] After sending, the revision reads **In review** and the first step shows
      who has it.
- [ ] Create a document: two steps, no scrolling, the number is allocated on
      finish, and the title is refused if it is only "Drawing".

## 2 · Reviewer

- [ ] Home lists **Review — your advice** with WALK 2.
- [ ] Open it: the PDF shows, comments can be added, one marked blocking.
- [ ] The verdict list is the organization's own (C1–C4), each saying what it
      does.
- [ ] Give advice: it moves to the next step and no approval is recorded.
- [ ] Reviews: every review ever made is listed, yours among them.

## 3 · Approver (the decision)

- [ ] Home lists **Give the verdict** with WALK 3.
- [ ] The earlier advice is shown above your own choice.
- [ ] Choosing a verdict that proceeds asks **It may then be used for** and
      will not submit without it.
- [ ] Choosing C3 asks what must change instead, and the status disappears.
- [ ] Give C1 with "to be IFC": the document says **to be IFC**, and the
      approval is recorded under your name.

## 4 · Document Control

- [ ] WALK 4: the release step says the reviewers decided IFC and the button
      reads **Release as IFC**. There is no status to choose.
- [ ] Release it: rev A becomes **Released**, the document becomes **Active**,
      and the banner offers **Issue it now**.
- [ ] WALK 5: issue it on a transmittal — subject, message, recipients, reason.
      The transmittal shows the documents it carries.
- [ ] WALK 7: Transmittals opens on **Check what arrived**. Run the acceptance
      check, accept it, then send it down a review route.
- [ ] Documents: filter by review verdict, supplier, contract/PO, revision
      state and released-for.

## 5 · Client

- [ ] Home is quiet; nothing internal is visible.
- [ ] Transmittals: TR-W… from us is there, with WALK 6 attached.
- [ ] Open the document: the PDF and the current revision only. No drafts, no
      other projects.
- [ ] Acknowledge receipt, and the sender sees it.

## 6 · Supplier

- [ ] Packages: only MADASUD's package, with what is expected and what is late.
- [ ] Their own documents are visible; ours are not.

## 7 · Schedule & actions (controller or project manager)

- [ ] The three cards say what is in force: schedule, departments, requirements.
- [ ] The plan draws a bar per activity with today as a line.
- [ ] A0007 is overdue: the activity page names the departments that are short
      and says the automatic warning was sent.
- [ ] **Notify by transmittal** opens the form addressed to those departments,
      with the missing documents named.
- [ ] Requirements: steps 1–3 read in order; a department sheet downloads and
      uploads back.

## 8 · Administrator (Settings)

- [ ] Disciplines, types & sets: tabs by purpose, a set opens, a value edits in
      place, a code in use cannot be renamed.
- [ ] Review routes: a route is drawn; add a step, remove a step, save.
- [ ] Functions & permissions: tick a box to grant, untick to remove; a
      function can name its department.
- [ ] People & access: add someone, set their department, change their job.
- [ ] Parties: name who answers for a party and an optional backup.
- [ ] Projects: rename one, read the warning about existing numbers.
- [ ] Numbering: each scheme shows a real number with every part named.
- [ ] Scope & readiness: each step says where it stands and what is still to do.

## 9 · Assurance and reports

- [ ] Assurance: run the checks; the figure and the documents with problems
      appear, each with where to fix it.
- [ ] Out-of-date risks: the superseded revision nobody was told about is
      listed, with **Send rev B to them**.
- [ ] Reports: figures and a chart per report, with a link to the list rather
      than a second copy of it, and a CSV that holds everything.
- [ ] Audit trail: every act above appears, with who and when.

## 10 · The whole loop, once

- [ ] Create a document, attach a file, send it down a route.
- [ ] Advise, decide "to be IFC", release, issue it to the client.
- [ ] Start rev B, take it through the same route, release it.
- [ ] Out-of-date risks now names whoever received rev A; send it to them and
      the risk clears.
