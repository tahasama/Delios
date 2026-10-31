/**
 * A sandbox (owner: "a test production… anyone could register an inexistent company"): the whole site is a testing
 * area, said on every page and in every email (backend `Email:Sandbox`). Set by SANDBOX=true in .env, read by the
 * screens' server when a page is drawn (nothing to rebuild).
 */
export const SANDBOX = process.env.DELIOS_SANDBOX === "true";

export const SANDBOX_LINE = "Sandbox: a testing area. Everything here is made up: companies, people, files. Add no real data; it may be wiped.";
