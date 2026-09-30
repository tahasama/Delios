# The detail style

How a page that shows **one record** is drawn — one action, and from here on any
other single thing that has a list inside it. The registers have their own
style; this is its counterpart for a detail page, and it is deliberately built
out of the same parts so the two read as one application.

The reference implementation is the action page:
`src/app/(app)/actions/[code]/page.tsx` with
`src/app/(app)/actions/[code]/needed-table.tsx` and
`src/app/(app)/actions/[code]/lateness.tsx`.

## The order of the page

1. **The plate and the narrowing, one sheet, full width.** The record's name,
   the facts about it, what the page is asking of the reader, and the filters
   for the table below — in that order, in a single
   `register register-sheet register-sheet-open`.
2. **The table, full width, directly under it.** No card, no heading of its
   own: it is the answer to the sheet above.
3. **Two columns under the table.** On the left, stacked and not full width,
   the sheets that say something *about* the record. On the right, in an
   `aside`, the progress timeline beside them:
   `grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]`.

Page spacing is `space-y-4`; the question sheet carries `mb-4` to its table.

## The plate

```tsx
<div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 pt-6 pb-3 sm:px-6">
  <div className="min-w-0">
    <h1 className="plate-name min-w-0">
      <span className="font-mono text-[0.8em] font-medium tracking-tight text-slate-400">{code}</span> {name}
    </h1>
    <p className="plate-meta mt-1.5">…the two or three facts somebody came for…</p>
    <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-400">…what to do on this page…</p>
  </div>
  <div className="flex shrink-0 items-center gap-2">{backLink}{stateChip}</div>
</div>
```

Three levels, never two: `.plate-name` (serif, the record is read, not
scanned) · `.plate-meta` (12.5px, 500, slate-600, tabular figures) · the claim
in slate-400. The identifier is mono and grey beside the name, never instead of
it. Both classes are in `globals.css` beside `.plate-title`, which stays what a
whole register's masthead uses.

## Every sheet below the plate

One instrument, used for all of them — never a `Card` with a title:

```tsx
<section id="…" className="register register-sheet register-sheet-open">
  <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
    <span className="stencil mr-1 text-slate-400">What this sheet is</span>
    <span className="text-[11px] text-slate-400">the sentence about it, lower case</span>
    {link ? <Link className="ml-auto text-[11px] font-semibold text-link hover:underline">Somewhere →</Link> : null}
  </div>
  <ul className="divide-y divide-line">…rows at px-5 py-3 sm:px-6…</ul>
</section>
```

A count or a note sits at `ml-auto` in the band, in mono tabular figures. A
footer strip (`border-t border-line px-5 py-2 text-[11px] text-slate-400`)
holds anything said about the whole sheet.

## Asking a question inside a sheet

The register's own controls, never a form with labels above boxes: `.asking`
grid, `.plain` fields, one `.ask` button, on one line where the line fits.
Yes-or-no is a checkbox with its words beside it, not a pair of radios and not
a select. The form takes a line of its own (`w-full`) rather than being squeezed
into a row's right-hand end.

```tsx
<ActionForm action={…} hideSubmit hidden={{ … }}>
  <div className="asking mt-2.5 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
    <label className="flex min-w-0 items-center gap-2 whitespace-nowrap text-xs font-medium text-slate-700">
      <input type="checkbox" name="…" value="yes" defaultChecked={…} /> What ticking it means
    </label>
    <label className="min-w-0"><span className="sr-only">Note</span><input className="plain w-full" placeholder="…" /></label>
    <button className="ask">Record</button>
  </div>
</ActionForm>
```

Every field carries an `sr-only` name; the placeholder is the visible label.

## The table

The register's table, not a plain one — `DataTable` inside
`<section data-dt-frame className="register register-sheet">`:

- **`maxHeight: useCardHeight()`, never `height`.** The height the schedule's
  plan set is a **ceiling**: four documents draw four rows and the sheet stops
  there. Only a longer list is held to that line, and only that one scrolls.
  With a ceiling set, the section is `flex flex-col`, the wrapper around the
  table is `flex min-h-0 flex-1 flex-col`, and `DataTable` takes `stretch`.
- a question sheet above it holding the search (`.plain`) and the narrowing
  (`.plain` selects), filtering **in the browser** where the page already holds
  every row;
- a band with the sheet's name in `.stencil`, the tabs as `.facet` links,
  facet chips for what is narrowed with a **Clear all**, and a count at
  `ml-auto`;
- `fill`, sortable headers, hide/move/resize from the column menu (kept in
  `localStorage`), a pinned first column, row ticking that feeds the Export
  tool, and a `data-dt-foot` with `1–n of n`, the pager and Rows;
- a coloured rail on the first cell saying where the row stands.

## The rules under the style

- **Nothing is dropped to make a row fit.** Evidence a reader might need goes
  into a column held back in the column menu, and into the export — never
  deleted because the table got wide.
- **State each fact once.** The plate says the date; the rows do not repeat it.
- **Every sheet is answerable or it is a record.** If somebody can act on what
  a sheet says, the control is in that sheet.
