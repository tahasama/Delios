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
| Not at any address | `app/not-found.tsx` | "Nothing at this address", back to Home |

## Still to check page by page

- **Empty:** every list and tab uses `EmptyState` (or the register's own empty line), never a bare "None"; a list
  narrowed to nothing says so and offers to clear the filters.
- **Success:** every act's action returns its `ok` line (what happened, what comes next); acts that open a new page
  (sending for review opens the review) say it there.
- **Error in place:** a failing part of a page (a panel, a tab) shows its own error and leaves the rest of the page.
- **Loading inside a page:** a tab or panel that loads on its own shows its own outline.
- **Permission denied by a 403 while a page is drawn:** today it reads as an error (the reason is hidden in production);
  pages that may be refused call `notFound()` on 403 and 404 so the person reads "Not found, or not yours to open".
