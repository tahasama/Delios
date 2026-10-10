---
version: 1
slug: "src-app-app-actions"
primary_target: "src/app/(app)/actions"
related_targets: ["src/app/(app)/actions/[code]"]
---

# Schedule & actions — surface brief

Scope: Schedule & actions (/actions) and the action page (/actions/[code]). Mode: Operate. Users: Document Control at a desk on a big screen, long sessions; planners; discipline engineers confirming. Trial of a new visual world on these two pages only; if it fails, fall back to "same look, better layout". Owner's complaint: generic, everything looks the same.

## Direction contract

THESIS: The planning board. Schedule & actions in the manner of a site office's T-card board: a light, quiet page where colour lives only on the action cards, each in its week's column, its colour its state. Refuses grey cards of equal weight, and the paper-form costume of the first trial (rejected: colours, paper feel, narrow fonts, heaviness).

OWN-WORLD: The app's own type and light ground. Seven state colours, each colouring a whole card (fill and edge) and a tag (ready green, done deep green, late receipt violet, still ahead blue, at risk amber, overdue red, nothing listed grey), used identically on the board, the timeline bars, the colour key and the table. Facts as a label over a figure, divided by thin rules, no boxes.

STORY: The planner opens the board and sees each week at a glance — how many cards, how many red or amber, this week lit — opens a card, and reads the action's name, its state tag and four facts.

FIRST VIEWPORT: /actions: title and in-force date; the stage path, where the dates come from, and five facts (documents ready, went ahead with documents missing, no date, disciplines tagged, discipline lists), red figures where somebody is needed; filters; three tabs, The board first; the board's week columns with cards. /actions/[code]: the way back, the action name large with its state tag to the right, four facts under it (action No., day of the work, documents ready, disciplines confirmed), the documents table below.

FORM: Planning board (T-card board), the owner's choice in re-roll round 1, seed key 1edae805. Raise kept from that round: bold areas of solid colour, one item owning its space.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
