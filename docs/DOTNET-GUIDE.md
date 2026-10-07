# The backend, for someone new to .NET

This guide is for reading, running and debugging the DELIOS backend without
knowing .NET beforehand. It explains the words you will meet, how the program
starts, and follows one real request through the code from the browser to the
database and back. `docs/SYSTEM.md` says what each part is for; this guide
says where it is and how it works.

## 1. What you are looking at

```
backend/
  Delios.slnx                    the "solution": the list of projects below
  src/Delios.Host/               the application (one project, built into one program)
    Program.cs                   where the program starts
    Platform/                    start-up, settings, database context, errors, health, metrics
    Tenancy/                     keeping organizations apart; one transaction per request
    Identity/                    people, sessions, sign-in, two-step sign-in, single sign-on, permissions
    Audit/                       the tamper-proof log of every act
    Documents/                   the register: documents, numbering, revisions, files, values lists
    Reviews/                     review routes, reviews, release, stamping, Document Control's check
    Transmittals/                issuing documents to people and other organizations
    Packages/                    sets of documents delivered together
    Schedules/                   the schedule, activities and what they need
    Checks/                      the checks engine and defect register
    Reports/                     the five reports and their exports
    Search/                      search (Postgres, or OpenSearch when switched on)
    Extraction/                  reading text inside files (switched off by default)
    Messaging/                   the outbox and RabbitMQ: work for the worker
    Seeding/                     the demo organization
    Platform/Migrations/         generated files that build and change the database schema
  tests/Delios.Tests/            the automated tests
```

Each folder is a **module**: one part of the business. Inside a module the
files are usually:

| File | What it holds |
|---|---|
| `Entities.cs` | The records stored in the database, as C# classes (a `Document`, a `Review`) |
| `Configurations.cs` (or at the end of `Entities.cs`) | How each class maps to its table: lengths, indexes, links |
| `…Service.cs` | The rules: what is allowed, what happens, in what order |
| `…Endpoints.cs` | The web addresses (`/api/projects/{id}/documents`) and the small functions that answer them |
| `Contracts.cs` | The shapes of what comes in and goes out over HTTP |

## 2. The words you will meet

**Class, record.** A class is a bundle of data and functions. A `record` is a
class meant to carry data; two records with the same values are equal. Most
request and response shapes are records:
`public sealed record WaiverRequest(string? Note);`

**`?` after a type.** The value may be missing (`null`). `string?` may be
null, `string` may not. The compiler warns when code forgets to check.

**`required`, `init`.** `required` means the value must be given when the
object is created. `init` means it can be set only then.

**Namespace, `using`.** A namespace is a folder name for code
(`Delios.Host.Documents`). `using Delios.Host.Documents;` at the top of a file
lets that file use the names inside without repeating the folder.

**`async`, `await`, `Task`.** Waiting for the database or the network does not
block the server. A method marked `async` returns a `Task` (a promise of a
result), and `await` waits for one without holding a thread. The rule: if a
method name ends in `Async`, put `await` before calling it.

**`CancellationToken`.** Passed along every call. If the browser goes away or
the server shuts down, the work in progress stops instead of finishing for
nobody.

**Dependency injection (DI).** Classes do not create the things they need;
they ask for them in their constructor, and the framework hands them over.
`public sealed class DocumentService(DeliosDbContext db, Numbering numbering, …)`
says "give me the database and the numbering service". Every such service is
registered once in `Platform/PlatformSetup.cs` (`services.AddScoped<…>()`).
"Scoped" means one copy per request; "Singleton" one copy for the whole program.
If you add a service and forget to register it, the program says so at start-up:
`Unable to resolve service for type …`.

**Primary constructor.** `class X(Y y)` is short for a class with a
constructor taking `y` and keeping it. You will see it on almost every service.

**LINQ.** The `.Where(...)`, `.Select(...)`, `.OrderBy(...)` chains. On a list
they run in memory; on `db.Documents` they are translated into SQL and run in
Postgres. `d => d.ProjectId == id` is a small inline function (a lambda): "for
each `d`, keep it if…".

**Entity Framework Core (EF), DbContext.** EF turns C# classes into database
rows and back. `Platform/DeliosDbContext.cs` lists every table
(`DbSet<Document> Documents`). `db.Documents.Add(x)` prepares an insert;
nothing is written until `await db.SaveChangesAsync()`.

**Migration.** A generated file in `Platform/Migrations/` that changes the
database schema one step (add a table, a column). They run in order, once, by
the `migrate` container. A few were edited by hand to add row-level security;
those lines say `RowLevelSecurity.Enable(...)`.

**Endpoint, filter.** An endpoint is a web address mapped to a function, in
the `Map…Endpoints` method of each `…Endpoints.cs`. A filter runs before (and
after) the endpoint: `TransactionFilter` opens the transaction,
`ProjectAccessFilter` loads what the signed-in person may do on the project.

**`IResult`, Problems.** What an endpoint returns: `Results.Ok(x)` (200),
`Results.Created(...)` (201), or a problem from `Platform/Problems.cs`:
`Invalid` (422), `Forbidden` (403), `NotFound` (404), `Conflict` (409). Every
problem carries a stable `code` (`TITLE_REQUIRED`) the frontend can translate.

**NodaTime.** `LocalDate` is a calendar day (a planned date, a due date),
`Instant` a moment (when something happened). Days are counted in the
project's time zone.

## 3. How the program starts

`Program.cs` is about forty lines:

1. `builder.AddPlatform()` (in `Platform/PlatformSetup.cs`) reads settings,
   registers every service and connects the database, cache, queue and storage.
2. If the program was started with a command (`migrate`, `create-tenant`,
   `seed-demo`, `reindex`), `Platform/Commands.cs` runs it and exits. This is
   how the one-shot `migrate` container works.
3. Otherwise `app.UsePlatform()` maps every endpoint and the program serves.

The same program runs in two **roles**, set by the `Delios__Role` setting:

- **api** answers HTTP requests.
- **worker** takes work from RabbitMQ: scanning uploads, stamping releases,
  reading schedules, running checks, reading text from files.

## 4. One request, end to end: registering a document

The browser sends:

```
POST /api/projects/{projectId}/documents
{ "title": "Inlet works general arrangement", "deliverableType": "ENG", "docType": "DWG", "discipline": "CI", "subproject": "10" }
```

1. **Sign-in check.** `Identity/SessionAuthentication.cs` reads the session
   cookie, finds the session (cached for 30 seconds in Valkey), and sets the
   organization in `Tenancy/TenantContext.cs`. No valid session: 401.
2. **The address.** `Documents/DocumentEndpoints.cs`, `MapDocumentEndpoints`:
   `project.MapPost("/documents", RegisterAsync)`.
3. **Filters.** `TransactionFilter` opens a database transaction. When it does,
   `Tenancy/TenantTransactionInterceptor.cs` tells Postgres which organization
   this is (`app.tenant_id`). From here on, Postgres itself hides every other
   organization's rows (row-level security), even if a query forgets to filter.
   `ProjectAccessFilter` then loads the person's function on the project and
   what it allows.
4. **The endpoint function** `RegisterAsync` in the same file is three lines:
   it hands the work to `DocumentService.RegisterAsync` and turns the answer
   into a 201 or a problem.
5. **The rules.** `Documents/DocumentService.cs`, `RegisterAsync`: checks the
   title, that each value is in the organization's published lists
   (`Documents/Catalog.cs`), that the person's function may create this kind
   of document, then asks `Documents/Numbering.cs` for the next number.
6. **Saving.** `db.Documents.Add(document)` then `db.SaveChangesAsync()`.
   Then `Audit/AuditLog.cs` writes `REGISTER_ENTRY` to the audit trail.
7. **Commit.** Back in `TransactionFilter`: the response is not an error, so
   the transaction commits. Had anything failed, nothing would be saved.
8. **The answer.** 201 Created, with the document as JSON.

Every other endpoint follows the same path: address → filters → small endpoint
function → service with the rules → save → audit → commit.

## 5. Work done in the background

Some work is slow or must happen later: scanning a file, stamping a PDF,
reading a schedule, running checks. It goes like this:

1. In the same transaction as the change, the service writes a message to the
   **outbox** table: `db.Enqueue(FileUploaded.RoutingKey, new FileUploaded(...))`
   (`Messaging/Outbox.cs`). If the transaction rolls back, the message never existed.
2. `OutboxRelay` (same file, running in the API) sends committed messages to
   RabbitMQ.
3. In the worker, `Messaging/FileQueueConsumer.cs` receives each message and,
   by its routing key, calls the right handler (`FileProcessor`, `Stamping`,
   `ScheduleImporter`, `CheckEngine`, `ExtractionProcessor`).
4. If a handler throws, the message is retried up to 5 times, 30 seconds
   apart, then parked in the **dead queue** (`delios.files.dead`, shared by
   every queue) for a person to look at. An alert (`FilesParked`) fires.

Queues are declared in `Messaging/RabbitMq.cs` (`Topology`).

## 6. The database

- Tables are the `DbSet`s in `Platform/DeliosDbContext.cs`; each table's class
  is in its module's `Entities.cs`, its details in the `Configurations`.
- Column names are snake_case in Postgres (`document_id`), PascalCase in C#
  (`DocumentId`).
- Lists that are stored inside a row as JSON (a review route's steps, a
  revision's submissions) are configured with `OwnsMany(...).ToJson()`.
- Every organization's table has row-level security switched on in its
  migration.

**To add a field** (for example a `Weight` on documents):

1. Add the property to the class in `Documents/Entities.cs`.
2. If it needs a length or an index, add it in the configuration.
3. Create the migration, from `backend/src/Delios.Host`:
   `dotnet ef migrations add DocumentWeight -o Platform/Migrations`
4. Read the generated file: it should only add your column.
5. For a new table, add `RowLevelSecurity.Enable(migrationBuilder, "table_name");`
   at the end of `Up`, and `using Delios.Host.Tenancy;` at the top.
6. Run the tests (`MigrationTests` checks the model and migrations agree).

## 7. Running it

| What | Command (from the repository root unless said) |
|---|---|
| The whole stack | `sh deploy/init-env.sh` once, then `docker compose -f deploy/compose.yaml --profile app up -d` |
| Create or update the database | `docker compose -f deploy/compose.yaml --profile app run --rm migrate` |
| The demo organization | `docker compose -f deploy/compose.yaml --profile app run --rm migrate seed-demo` |
| A walk through every feature | `pwsh deploy/demo.ps1` (needs the stack and the demo organization) |
| Build | `cd backend && dotnet build` |
| Tests (needs Docker running) | `cd backend && dotnet test` |
| One test class | `dotnet test --filter "FullyQualifiedName~ScheduleTests"` |
| Formatting, as CI checks it | `dotnet format --verify-no-changes` |
| Monitoring | add `--profile monitoring`; Grafana on port 3301 |

The API answers on `http://localhost:8080`. The description of every endpoint
is at `/api/openapi/v1.json`. RabbitMQ's own page is on port 15672.

## 8. Debugging

**Start from the error the screen received.** Every problem has a `code`
(search for it: `grep -rn TITLE_REQUIRED backend/src`) and a `traceId`. The
code leads to the line that refused; the trace id finds the request in the logs.

**Logs.** `docker compose -f deploy/compose.yaml logs -f api` (or `worker`).
Each line is JSON: `@m` is the message, `@l` the level, `@x` the exception.
One line per request says the path, status and time. Search them for the trace id.

**Something did not happen in the background** (no stamp, schedule not read,
file stuck in "processing"):

1. Worker logs: is there an exception for that message?
2. RabbitMQ page (port 15672), Queues: is a message waiting in a `.dead` queue?
3. The `outbox_messages` table: is a message not sent? (The `OutboxStuck` alert watches this.)

**Wrong data on screen.** The audit trail says who did what and when: the
`audit_events` table, or search for the action name (`REGISTER_ENTRY`,
`NEED_WAIVED`…) in the code to see where it is written.

**Running under a debugger.** Open `backend/` in VS Code (C# Dev Kit) or
Rider, start the infrastructure with Docker Compose, then start `Delios.Host`
with breakpoints. Easiest is to debug a test: set a breakpoint in the code,
right-click the test, Debug. The test starts its own database and queue.

**Common errors**

| You see | It usually means |
|---|---|
| `Unable to resolve service for type X` at start-up | X is not registered in `PlatformSetup.cs` |
| `42501: new row violates row-level security policy` | A write ran without the organization set (outside a request, the code must call `tenant.Set(...)` and open a transaction) |
| `relation "x" does not exist` | Migrations have not run: `run --rm migrate` |
| `… records are kept: they are never deleted` | Something tried to delete a document, revision, file, review or transmittal: the database refuses it, by design |
| `The model for context has pending changes` (test) | An entity changed without a migration: add one |
| 409 Conflict | The thing is no longer in a state that allows the action (already released, already sent…); the `code` says which |
| 422 with `VALUE_NOT_PUBLISHED` | The value is not in the organization's list: publish it, or choose another |
| 429 Too Many Requests on sign-in | More than 10 attempts a minute from one address: wait a minute |

## 9. Where to look for…

| Question | Look in |
|---|---|
| What can a function do? | `Identity/ProjectAccess.cs`, `Holds` and `Allows`; the matrix is data |
| How is a number made? | `Documents/Numbering.cs` |
| What happens on release? | `Reviews/ReviewService.cs`, then `Reviews/Stamping.cs` in the worker |
| Who receives an issue? | `Transmittals/TransmittalService.cs` |
| When is an activity ready? | `Schedules/Readiness.cs` |
| What does check XX-00 test? | `Checks/Catalog.cs`, search the id |
| How is a report counted? | `Reports/ReportBuilder.cs` |
| Every setting and its default | `Platform/Options.cs`; production values in `deploy/compose.yaml` |
| What to switch on, and how | `docs/ACTIVATION.md` |
