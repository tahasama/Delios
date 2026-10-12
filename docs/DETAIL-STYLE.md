# The reference style — locked in by the owner

Schedule & actions (`src/app/(app)/actions/page.tsx`) and the action page
(`src/app/(app)/actions/[code]/page.tsx`) are the reference for every page,
card, form and hidden panel in DELIOS. The owner judged that they cannot be
made better. **When the owner says "apply the same", it means this file:**
build from these parts, in this order, with these exact classes, and change
nothing about them on the way.

Reference files, read them before styling anything:

| What | File |
|---|---|
| A list page (masthead, stages, plan, table, dock) | `actions/page.tsx`, `actions/plan-plate.tsx`, `actions/plan-cards.tsx`, `actions/plan-list-panel.tsx`, `actions/plan-timeline.tsx`, `actions/plan-register.tsx` |
| A detail page (plate, table, sheets, progress) | `actions/[code]/page.tsx`, `actions/[code]/needed-table.tsx`, `actions/[code]/lateness.tsx`, `actions/[code]/links-card.tsx` |
| Stages under a masthead | `StagePath` in `documents/[id]/next-step.tsx` (`under`, `pick`) |
| Telling people by hand | `components/notify-panel.tsx` |
| Progress | `components/timeline.tsx` |
| Status chip | `ToneChip` / `TONE` in `components/ui.tsx` (done, waiting, refused, idle, moving) |
| Controls | `btn()`, `inputCls`, `Field` in `components/ui.tsx`; `ActionForm` in `components/form.tsx`; `.ask`, `.plain` in `globals.css` |

## One size for every control

Set once on `:root` in `src/app/globals.css`: `--control-h` (2rem),
`--control-text` (13px), `--control-radius`. Every field, dropdown, button and
file field stands that height with that text. Never give a field or a button
its own height, padding or text size on a page; never restyle the file button.

## A list page (Schedule & actions)

1. **One sheet: masthead, stages, narrowing.** `register register-sheet
   register-sheet-open`. The masthead is `.plate-title` with one line under it
   (`mt-1 max-w-2xl text-xs leading-5 text-slate-500`) saying what is in force;
   a failure says so in a `rounded-md bg-red-50 px-2.5 py-1.5 text-xs ring-1
   ring-red-200` line right there.
2. **Stages** are `StagePath` with a short line under each (`under`): the
   revision in force, "Uploaded directly …", "Not released yet", "None yet".
   A stage is clickable (upload icon) only for whoever may act; "open" is an
   underline, the fill stays "where it stands". Width `max-w-3xl`, pills never
   wrap.
3. **The plan or the table** under it, full width, the register's `DataTable`
   with its band, facet chips, Clear all, count at `ml-auto`, footer pager.
4. **The dock** for a selection: `dock sticky bottom-4 … bg-brand-strong`, the
   count in mono, each act a `rounded-sm bg-white/10 px-3 py-2 text-xs
   font-semibold` link with its icon, Clear at `ml-auto`.

Dates read from today, never "overdue": "40 days ago · lasted 3 days", "Today",
"In 5 days · lasts 3 days". Each fact is said once.

## A detail page (an action)

1. **The plate and the narrowing, one sheet**, full width:

   ```tsx
   <div className="flex flex-col-reverse gap-3 border-b border-line px-5 pt-6 pb-3 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
     <div className="min-w-0 flex-1">
       <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{code}<span className="ml-2 font-sans text-xs font-normal">…second id…</span></p>
       <h1 className="plate-name mt-1 min-w-0">{name}</h1>
       <p className="plate-meta mt-2">…the facts somebody came for…</p>
       <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">…what to do on this page…</p>
     </div>
     <div className="flex shrink-0 items-center gap-2">{back link}{state chip}</div>
   </div>
   ```

2. **The table directly under it** — no card, no heading of its own.
3. **Two columns under the table:**
   `grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]`. Left, stacked
   (`space-y-4`), the sheets about the record; right, in an `aside`, `Card
   title="Progress"` holding the `Timeline`. Progress never shows a step open
   between two done ones; a date still to come is "due", never done.

Page spacing is `space-y-4`.

Applied the same way to the document register (masthead, filters that apply on
pick, Apply lit only while words or dates wait), the document page (state chip
on the right beside the way back), the packages list (`DataTable`, `ToneChip`)
and both package pages (plate, sheet heads, Progress aside at 280px).

## Every sheet

```tsx
<section id="…" className="register register-sheet register-sheet-open">
  <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
    <span className="stencil mr-1 text-slate-500">What this sheet is</span>
    <span className="text-[11px] text-slate-500">the sentence about it, lower case</span>
  </div>
  <ul className="divide-y divide-line">
    <li className="space-y-3 px-5 py-4 sm:px-6">…</li>
  </ul>
  <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">…a line about the whole sheet, with its link…</p>
</section>
```

Never a `Card` with a title for a sheet on a detail page (the Progress aside is
the one `Card`).

## A row in a sheet (the discipline row is the model)

Top to bottom, every row that asks something of the reader:

1. **Name and count, with one status chip on the right:**
   `flex flex-wrap items-center justify-between gap-x-3 gap-y-1`; the name
   `text-sm font-semibold text-slate-800`, the count beside it
   `ml-1.5 text-xs font-normal text-slate-500`; the chip
   `rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1` in one tone:
   - done `bg-emerald-50 text-emerald-800 ring-emerald-200`
   - waiting `bg-amber-50 text-amber-900 ring-amber-200`
   - not going ahead / refused `bg-red-50 text-red-800 ring-red-200`
   - not yet open `bg-slate-100 text-slate-600 ring-slate-200`

   Built once as `ToneChip` (`components/ui.tsx`); use it rather than writing the classes again.
2. **Who did it, when and why** (`whitespace-pre-line text-xs leading-5
   text-slate-600`), the reason on its own line. A take-back is kept under it in
   `text-[11px] text-slate-500`.
3. **What is missing, and the question**, in one box:
   `rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 ring-1 ring-line` —
   a bold count ("1 document is not ready"), each item (number as a mono link,
   title, where it stands), then the question in plain words ("Does Mechanical
   confirm going ahead with the action without it? Confirm, and say why.").
4. **One row of buttons:** `flex flex-wrap items-start gap-2`. Each act is a
   `.ask` (a link, or a `<details>` whose `<summary>` is `.ask`). An opened form
   takes the whole width under the row (`open:basis-full`, or
   `has-[details[open]]:basis-full` around `NotifyPanel`).

## Forms

`ActionForm` with `Field` and `inputCls`; one primary submit, its label the
act ("Record", "Confirm", "Add it, and answer"). A choice between two answers
is two radios worded as the answers to the question asked above them ("Going
ahead without it" / "Not without it"). An obligatory "why" is a `textarea`.
Hints say who reads it or where it shows, never "kept in the log". A form
asking something optional sits folded behind a plain question
("Will it not go ahead? Record a postponement"), so nobody takes it for a form
to fill.

People are always picked with `SearchPick` (the transmittal picker): name,
organization, function; recommended ones first and marked.

## Words

Plain, short, no jargon, the act named for what it does. Each fact once. A
status is a word in a chip; the sentence under it says how. Everything a
person wrote is shown where it matters, in full.

## The rules under the style

- **Nothing is dropped to make a row fit.** Evidence goes into a column held
  back in the column menu, and into the export.
- **State each fact once.** The plate says the date; the rows do not repeat it.
- **Every sheet is answerable or it is a record.** If somebody can act on what
  a sheet says, the control is in that sheet.
- **One rule colour:** `border-line`, `divide-line`, `border-line-strong` —
  never a slate step picked by eye.
