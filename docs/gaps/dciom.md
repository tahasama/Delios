# DCIOM: on hold

The owner's framework for governing document control (measures with thresholds, an advisory library, a health
score, escalation). Discussed, not decided; **nothing of it is built**. The owner: "keep that thought, we will be
back". These notes keep where the conversation stood.

## What was said

- DCIOM is an independent framework, not DELIOS's. The idea is to bring it in **as content**, not to rebuild it by
  hand: its measures (each with its thresholds), the advisory library (`AdvisoryLibrary.xlsx`: a situation, then the
  advice for it) and the weights of a health score.
- Not every organization wants it. Some want reporting only; escalation and governance mean nothing to them. The
  owner found the idea "kind of shaky".
- **AI only as a guide**: it never guesses a figure. From the data, it may word a verdict and point to the advice
  that fits; projects vary too much for fixed rules to say everything. Preferably not needed at all, but it could ship
  as a feature.
- **No Power BI.** Anything of DCIOM would live inside DELIOS.
- **Existing reports stay** whatever is decided: they answer the project's own questions.
- Already in DELIOS, so not to build twice: days per review step and in total on a route; each supplier
  document's planned date; transmittal answer-by days; escalation of a silent discipline (`ESCALATE_AFTER_DAYS`).

## The shape proposed (not agreed)

Three levels, each optional above the first:

1. **Reporting**, for everyone: the reports as they are.
2. **Performance**: measures with thresholds, read from the same record (no stored figures).
3. **Governance** (the DCIOM module, perhaps paid): the advisory library, a health score, escalation by thresholds.

One generic engine reads a content pack (measures, thresholds, advice, weights); DCIOM would be one pack, an
organization could load its own.

## Before anything is built

The owner decides whether, at which level, and whether it is part of DELIOS or sold apart.
