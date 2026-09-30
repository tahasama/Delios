/**
 * The height every card in the application comes to, as plain numbers.
 *
 * Kept away from the hook that reads them so both sides of the application can
 * have them: the schedule is a server component and works these out before it
 * queries, and the registers are client components and read the measured
 * number through `useCardHeight`. A value behind a "use client" boundary
 * reaches a server component as a reference rather than as a number, so this
 * module carries no directive.
 */

/** How many bars the plan draws before asking, and what one of them takes. */
export const PLAN_FIRST = 12;
export const PLAN_ROW = 30;

/** What the plan spends on everything that is not a bar: the band carrying the
 *  dates, the padding under the last bar, and the footer. */
export const CARD_CHROME = 6 + 20 + 16 + 45;

/**
 * The height a plan of twelve bars comes to. Two things use it: the plan, as
 * what it aims for before it has been measured, and every other register, as
 * the floor under a kept number. A number smaller than this was measured from
 * a plan narrowed to a handful of bars, and is thrown away rather than carried
 * around the application.
 */
export const PLAN_CARD_HEIGHT = PLAN_FIRST * PLAN_ROW + CARD_CHROME;

/** Where this browser keeps the height the plan measured. */
export const CARD_KEY = "actions:card";
