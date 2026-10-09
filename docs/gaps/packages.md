# Packages: what the screens need that the backend lacks

Screens: `/packages` (list, both tabs, and the two "New … package" forms), `/packages/add`, `/packages/[number]` (delivery package and supplier package views). Actions: `src/lib/actions/planning.ts` (package part), `src/lib/actions/supplier.ts`.

1. **Our own organization as a recipient (internal handover).** The "Delivered to" picker offers "us" for an internal handover. `GET /addressees` and `GET /api/parties` list only outside parties, and `/api/parties` gives no ids at all. Today the picker has no "(us)" option.
   Want: the internal party's id, e.g. `GET /addressees` → `parties[]` including `{ id, code, name, participation, isInternal: true }` (or `GET /api/parties` returning `id` and `isInternal`, internal one included).

2. **Several reasons for issue on one package.** The create form takes "Why they get it — one or several"; `CreatePackageRequest.Reason` holds one. Today more than one is refused ("More than one reason for issue on a package is not supported yet.").
   Want: `POST /packages` `reasons: string[]` (first leads the transmittal, the others named on it), returned as `PackageView.reasons`.

3. **Fields of your own on a package (form policy extras).** The create form shows organization-defined fields (`Added fields={packagePolicy.own}`); the package has nowhere to keep them. Refused when any is filled.
   Want: `POST /packages` `extras: Record<string,string>`, returned on `PackageView.extras`.

4. **Filling by asset tag.** The rule picker has "Tagged"; there are no asset tags in the backend (`PackageRule` has deliverableTypes/disciplines/docTypes/originators). The picker is empty; a tag in a rule is refused.
   Want (if tags come): `PackageRule.assetIds: Guid[]`.

5. **Reason for deleting.** The delete form asks "Why — goes on the record"; `DELETE /packages/{id}` takes no body and audits "deleted while empty". The reason is required by the form but not recorded.
   Want: `DELETE /packages/{id}` with `{ reason }` (or `POST /packages/{id}/delete { reason }`), written into the PACKAGE_DELETED audit detail.

6. **Completion date is optional in the backend.** Old packages always had one (`completionDate` drives "OVERDUE", "in N days"). `PackageView.completionDate`/`PackageSummary.completionDate` are nullable; packages created elsewhere without one show "—" and "in 0 days". The forms always send one. Want: `CreatePackageRequest.CompletionDate` required (or the screens accept that some have none).

7. **Package creation time on the full view.** `PackageView` has no `createdAt` (only `PackageSummary` does); the detail page's timeline needs it, so the page reads the list too. Want: `PackageView.createdAt`.

8. **Supplier package: per-document submission facts in the package view.** The supplier table shows, per document, when it was sent (on time / late), why it was rejected or returned, the review outcome, the incoming transmittal to check, how many times it was submitted, and the review comments. `MemberView` carries only `latestRevision`, `latestState`, `dueDate`, `requestedAt`; the page therefore reads every member document in full (`/documents/{id}`, `/context`, each `/reviews/{id}`), and the list page shows sent/overdue/waiting counts from `latestState` only.
   Want on `MemberView`: `latestRevisionId`, `submittedAt` (first submission of the latest revision), `submissions` (count of revisions submitted), `returnedReason`, `verdict`, `incomingTransmittal { id, number }`.

9. **Supplier attaching a file without sending it.** The supplier's document page has "Attach" then "Send". The backend keeps no file a supplier has not sent: a placeholder is filled by `POST /transmittals/incoming` (planned item). `attachSupplierFileAction` therefore sends at once on its own transmittal ("Sent on TR-…").
   Want (if the two steps are kept): a supplier draft — `POST /documents/{id}/uploads` + `POST /documents/{id}/revisions` allowed for the supplier's own placeholder as an unsent draft, later sent with `IncomingRequest.RevisionIds`.

10. **The status a supplier sends for.** `IncomingRequest.Planned[].Status` is required; the supplier package form does not ask it. The action derives it from the package's reason ("For approval" → the status labelled "Issued for approval", else the first non-executing status).
    Want: a default status per reason for issue (value prop), or the planned item's status optional with the backend choosing.

11. **Narrowing a supply package by deliverable type is lost on save.** `PackageRule.deliverableTypes` exists but the old rule picker has no such field; saving the rule from the screen sends `deliverableTypes: []`.

12. **Supplier package "Delivery list" download.** The supplier package header links `/api/requirements/sheet?sender=…` (old Next route); no backend export of a supplier's delivery list exists. Want: `GET /packages/{id}/export` (CSV/XLSX of the members with due dates and state).

13. **Packages CSV export.** The list's "Export CSV" links `/api/export/packages`; no backend export of packages. Want: `GET /packages/export` (CSV of `PackageSummary` rows).

14. **Who accepts / composes, for another organization's people.** Names of owners and acceptors come from `GET /addressees`, which refuses outside people; the supplier view does not show them, so this matters only if it ever does. Want: `PackageView.owners[]`/`acceptors[]` as `{ id, name }`.
