# The ten states every page handles

The owner's list (30 Oct 2026): empty, loading, error, no internet, slow network, no search result, permission denied,
session expired, form validation, success. Each page is checked against all ten; this file says what is built once for
every page, and what is still to check page by page. The Design Brief (the product & build documents) says what each
state must show.

## Built once, for every page

| State | Where | What the person sees |
| --- | --- | --- |
| Loading | each area's `loading.tsx`, `components/skeleton.tsx` | The page's outline in quiet grey; a filter keeps what is shown until the new answer |
| Error | `app/(app)/error.tsx`, `app/global-error.tsx` | "This page could not be shown", nothing saved lost, a reference to quote, Try again, Back to Home, Ask support; never the server's message or code trace (development only) |
| No internet | `components/offline-band.tsx` (root layout); `ActionForm` | A band at the top while offline, "Back online" for 3 s after; a form sent offline is refused before anything leaves, its words kept |
| Slow network | `ActionForm` | "Working…", then "Still sending…" after 3 s, and after 10 s a line saying the request is on its way and nothing is lost |
| Session expired | `proxy.ts` (`next` keeps the whole address, `x-delios-path`), `lib/core/sign-in-again.ts`, the sign-in page | A page that finds the session ended sends to sign in, says why, and comes back to the same page with its filters; a form refused for it (`SESSION_ENDED`) offers to sign in again in a new tab and keeps its words |
| Permission denied | `app/(app)/not-found.tsx`; `settings/no-access.tsx`; the backend's refusals (CONTROL_ONLY…) | An address one may not open reads "Not found, or not yours to open" inside the frame, with the way to the control function; Settings pages say who changes them |
| Form validation | `ActionForm`, `form-validation.ts` | Missing fields outlined in red beside the list of what is missing; the first one, found by the screen or named by the server, scrolled to and focused |
| No search result | quick find, `Select`, `JumpPick`, Assets | "Nothing matches that."; the quick find names the words searched and how to find more |
| Success | `ActionForm` (`ok`, `link`) | A line in emerald under the form, with the next step's link where the action gives one |
| Empty | `EmptyState` (`components/ui.tsx`) | Why it is empty and the one act that fills it |
| Permission denied by the server | `notYours` (`lib/client.ts`) in the readers of a document, package, transmittal, review, action, tag and a person's activity | A 403, 404 or 400 on the page's own thing reads "Not found, or not yours to open" (`notFound()`), the same words whether it exists or not; any other failure goes to the error page, never read as "not found" |
| Not at any address | `app/not-found.tsx` | "Nothing at this address", back to Home |

## Still to check page by page

- **Empty:** the four registers (documents, reviews, transmittals, the Schedule's table) are done: narrowed to nothing,
  they say so and offer to clear the filters; empty with no filter, they say what fills them. Every other table now says
  something too (`DataTable` `empty`, owner, 31 Oct 2026): why it is empty and what fills it, with the act where there is
  one (the Project directory, People & access, the organization's People and Organizations, the console's organizations,
  a supplier's package, the distribution matrix, the functions' grid, revisions' routing); a table given no words reads
  "Nothing to show here yet.", never a bare header. Lists that are not tables keep their own lines.
- **Success:** done for the acts that ended silently (about forty: the checks, records, legal hold, numbers taken back,
  tags, organization links, asks to send, the check on arrival, notifying again, packages, every act on a revision and a
  review): each returns its line, what happened and what comes next. Left silent on purpose: switches (they show their
  new state at once), acts that open another page (it is the answer), the two-step sign-in's setup (its own steps), and
  Count again (the report itself says when it was counted).
- **A part of a page on its own** (`components/part.tsx`, `Part`; `PartSkeleton` in `components/skeleton.tsx`): an async
  server component wrapped in it reads on its own: its grey outline while it reads, the rest of the page drawn already;
  if it fails, "<what> could not be shown. The rest of the page is fine, and nothing was lost." with Try again, the
  failure reported to us; `failed` keeps what still stands drawn above the line. Try again reads the part afresh. Used on
  Home's journal; the document page's other numbers and who may read it (`documents/[id]/side-parts.tsx`; before, a
  failed read showed as "no other number"); the review page's "What the earlier steps said" (`reviews/[id]/earlier-steps.tsx`);
  an action's documents, drawn at once and filled with where each got late when it comes, staying without it if it
  fails (`actions/[code]/needed-with-lateness.tsx`); the Schedule's lists' stages (before, a failed read showed "None yet").
