# Transmittals: what the screens need that the backend lacks

The transmittal screens (`/transmittals`, `/transmittals/[id]`, `/transmittals/new`) and their actions
(`src/lib/actions/transmittals.ts`) now run on the backend. Where the backend keeps nothing, the screens
show nothing and the actions answer "… is not supported yet." Each item: what, where, and the endpoint or
field that would close it.

## Recipients

1. **Which account / party a recipient is.** Detail page (who it went to, "is this mine", who sends it on)
   and New transmittal (follow-up prefill). `RecipientView` has only `name` and `organization`; the
   frontend matches names against `/addressees`, which fails for anyone outside our organization (403) and
   for two people with the same name.
   Want: `GET /transmittals/{id}` → `recipients[].userId: Guid?`, `recipients[].partyId: Guid?`.
2. **Who carries the exchange with an organization (custodian).** Detail page, "Not on this system —
   *names* sends it to them". The custodian function of a party is not published; the screen shows
   Document Control holders, and decides "mine" from `/work` DISPATCH_TRANSMITTAL items.
   Want: `GET /addressees` → `parties[].custodians: { id, name }[]` (or `custodianFunction`), and on the
   transmittal `recipients[].carriers`.
3. **Copies (CC).** New transmittal "Copy to (CC)", detail page "copied in", log "copies". Recipients have
   no kind; `createTransmittalAction` refuses copies.
   Want: `ComposeRequest.copyUserIds: Guid[]`, `RecipientView.kind: "TO" | "CC"` (CC never asked to
   acknowledge, not counted in Seen), `LogRow.copies: int`.
4. **Notify again.** Detail page "Notify again" (`chaseTransmittalAction`).
   Want: `POST /transmittals/{id}/notify-again { recipientIds: Guid[] }`, and `RecipientView.notifiedAt`.
5. **Views after the first.** Detail page "opened it, and N times since — last …". Only `openedAt` is kept.
   Want: `RecipientView.viewCount: int`, `lastViewedAt`.
6. **Party facts for sending on by hand.** Detail page mark-as-sent form: `externalSystem` (their system's
   name) and `evidenceRequired` (proof mandatory) are not published.
   Want: `GET /addressees` → `parties[].externalSystem: string?`, `parties[].evidenceRequired: bool`, and
   `DispatchAsync` refusing without proof when required.
7. **Proof file's name.** Detail page "proof: *name*" shows "proof of sending".
   Want: `RecipientView.proofFile: { id, name }` (same for `TransmittalView.proofFileId`).
8. **The day it went.** Mark-as-sent form "The day it went"; New transmittal "Date sent / Date received".
   The backend stamps now; a day other than today is refused.
   Want: `DispatchRequest.dispatchedOn: DateOnly?`, `ComposeRequest.issuedOn`, `IncomingRequest.receivedOn`
   (validated not in the future, not before issue).

## Composing

9. **Drafts.** New transmittal "Create it as a draft", detail page draft bar and Issue button
   (`issueTransmittalAction`). Every transmittal is sent when made.
   Want: `POST /transmittals { …, draft: true }`, `POST /transmittals/{id}/issue`, state DRAFT in the view
   and the log.
10. **A letter with no documents.** New transmittal allows subject + message alone; `ComposeAsync` needs
    1–500 revisions (`ITEMS_REQUIRED`). Want: allow 0 revisions when a subject and message are given.
11. **Threads: answers and follow-ups.** Detail page "The exchange" (answers, "This is itself an answer
    to"), "Follow-ups" (supplement / replaces), New transmittal `?replyTo=` and `?follows=`. Refused in the
    action. Want: `ComposeRequest.inReplyToId`, `followsId`, `followKind: SUPPLEMENT|REPLACES`;
    `TransmittalView.inReplyTo`, `answers[]`, `follows`, `followedBy[]` ({ id, number, subject, issuedAt,
    direction, items, recipients }).
12. **Organization's own fields on a transmittal.** Settings → Forms & fields for TRANSMITTAL; extras are
    refused. Want: `ComposeRequest.extras: Record<string,string>` and `TransmittalView.extras`.
13. **Who raised it (id).** New transmittal reply prefill finds the sender by name.
    Want: `TransmittalView.issuedById`.

## Receiving

14. **A note on how it arrived.** New transmittal (received) "Note"; detail page "They wrote:". Refused.
    Want: `IncomingRequest.note` → `TransmittalView.receiptNote`.
15. **Who an incoming transmittal is for.** New transmittal (received) step 3 "For" requires people;
    they are not recorded (ignored by the action). Want: `IncomingRequest.userIds` → recipients.
16. **Sender as free text.** New transmittal "Received from" is typed; the action matches it to an active
    outside party by name or code and refuses otherwise. Fine as long as every sender is a party; a picker
    would remove the guess (frontend change, not a backend one).
17. **Adding files after it was recorded.** Detail page "Keep with it" (`attachTransmittalFilesAction`).
    The receipt is fixed at arrival, so this may be by design. If wanted:
    `POST /transmittals/{id}/attachments { fileIds }` kept apart from the receipt.
18. **Accept / reject as a transmittal.** Detail page "On arrival". The action checks each SUBMISSION item
    on arrival (`POST /revisions/{id}/arrival`, reject = the first published `act: return` outcome to the
    sender). There is no transmittal-level decision, note or condition-by-condition check
    (`conditionsResult`), and the log's state does not count submissions still waiting for the arrival
    check (it shows them as accepted; the detail page shows "to check").
    Want: `LogRow.status` = TO_CHECK while any SUBMISSION item's revision is RECEIVED at that submission;
    optionally `POST /transmittals/{id}/arrival { outcome, note }` applying to all its submissions.
19. **Registering an unplanned item from its file.** Detail page "Make it a document →" links to
    `/documents/new?fromFile=<fileId>` (documents area). The backend registers by
    `(transmittalId, itemId)`. `src/lib/api/transmittals.ts` has `unplannedItemOfFile(scope, fileId)` (scans
    the TO_REGISTER log) and `registerUnplannedItem(...)` for that page to use.
    Want: `GET /files/{id}` → `{ transmittalId, transmittalItemId }`, or the item id in the link.

## The log

20. **Status filter and column.** The log offers Draft / Issued / To check / Accepted / Rejected. The
    backend's states are TO_SEND / OVERDUE / AWAITING_REPLY / AWAITING_ACK / TO_REGISTER / COMPLETE.
    Mapped: Issued = everything outgoing (plus, with "Received", what is to register); To check =
    TO_REGISTER; Accepted = incoming COMPLETE; Draft and Rejected list nothing. "Issued" without a
    direction misses incoming "to check" (the backend filter cannot OR a status with a direction).
21. **Sorting.** Number, subject and received have no backend order; they fall back to the issue date.
    Want: `sort=number|subject` in `TransmittalLogEndpoints.Sort`.
22. **Date filters.** "Received" and "Written" read the issue date (the backend keeps one date).
23. **Recipients' organizations.** Outgoing "To" shows `toName` ("Internal distribution" for our own
    people) rather than the companies of the people it went to. Want: `LogRow.recipients[].organization`.
24. **Checked by.** Log column "Checked by" is empty. Want: `LogRow.checkedBy` (last arrival decision or
    registration).
25. **Export.** The log's Export goes to `/api/export/transmittals` (export area, not ported here); it
    should call `GET /transmittals/log/export?format=csv|xlsx` with the same filters (`ids=` for one).
