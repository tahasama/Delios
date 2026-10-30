/**
 * Who runs this DELIOS (backend Platform/Hosting.cs, the same HOSTED in .env): DELIOS for many organizations (trials,
 * plans, invoices), or the organization itself (none of that: those pages and figures are not shown).
 */
export const HOSTED = process.env.DELIOS_HOSTED !== "false";
