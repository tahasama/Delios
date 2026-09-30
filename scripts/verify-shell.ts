// Phase 5 exit criterion: the shell shows people their job, not the Standard's
// table of contents — and nothing that is built is unreachable.
import "dotenv/config";
import { readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const APP = "src/app/(app)";

/** Every route that exists on disk, as a URL path. */
function routes(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    // Route groups like (app) do not appear in the URL.
    const segment = entry.startsWith("(") ? "" : `/${entry}`;
    const here = prefix + segment;
    if (readdirSync(full).includes("page.tsx")) out.push(here || "/");
    out.push(...routes(full, here));
  }
  return out;
}

function main() {
  const all = routes(APP).filter((r) => !r.includes("["));
  const nav = readFileSync("src/components/navigation.tsx", "utf-8");
  const setup = readFileSync(`${APP}/admin/setup-pages.ts`, "utf-8");

  // Links appear both as object properties (nav tables) and as JSX attributes
  // (the Settings and Help links), so read both forms.
  const linked = new Set<string>();
  for (const source of [nav, setup]) {
    for (const m of source.matchAll(/href: "([^"]+)"/g)) linked.add(m[1]);
    for (const m of source.matchAll(/href="([^"{]+)"/g)) linked.add(m[1]);
  }
  // Reached from within a parent screen rather than from navigation.
  const reachedInline = new Set([
    "/documents/new",
    "/transmittals/new",
    "/conformance/checks",
    "/conformance/defects",
    "/conformance/statement",
    "/conformance/traceability",
    "/conformance/audit",
    "/exposures",
    "/actions/schedules",
    "/actions/requirements",
    "/reviews/send",
    "/packages/add",
    "/notifications",
    "/guide",
    "/guide/codes",
  ]);

  console.log("\nEverything built is reachable\n");
  const orphans = all.filter((r) => !linked.has(r) && !reachedInline.has(r));
  check("no page is orphaned", orphans.length === 0, orphans.join(", ") || "all reachable");

  console.log("\nThe shell leads with jobs, not the Standard's structure\n");
  const primaryBlock = nav.slice(nav.indexOf("function primaryNav"), nav.indexOf("function moreNav"));
  const primaryCount = [...primaryBlock.matchAll(/href: "/g)].length;
  check("four primary destinations", primaryCount === 4, `${primaryCount}`);
  for (const job of ["/", "/documents", "/actions", "/transmittals"]) {
    check(`primary includes ${job}`, primaryBlock.includes(`href: "${job}"`));
  }

  console.log("\nNavigation is filtered by what the person may do\n");
  check("primary items gate on permissions", primaryBlock.includes("p.canRead") && primaryBlock.includes("p.canTransmit"));
  const moreBlock = nav.slice(nav.indexOf("function moreNav"), nav.indexOf("function isActive"));
  check("control-only views gate on canControl", moreBlock.includes("p.canControl"));
  check("assurance is not in the primary list", !primaryBlock.includes("/conformance"));
  check("settings requires CONFIGURE", nav.includes("perms.canConfigure"));

  console.log("\nIt survives a narrow window\n");
  // 268px, the sidebar's width, as Tailwind names it: 67 steps of 4px.
  check("sidebar hides below lg", nav.includes("hidden w-67") && nav.includes("lg:flex"));
  check("a drawer replaces it", nav.includes("MobileNav"));
  const layout = readFileSync(`${APP}/layout.tsx`, "utf-8");
  // The content is padded by the sidebar's own width, collapsed or not, and by
  // nothing else: a fixed width beside it once won and left a gap on every page.
  check("content padding follows the sidebar", layout.includes("lg:pl-(--sidebar-w)") && !/lg:pl-(\d|\[\d)/.test(layout));
  check("header padding is responsive", /px-4[^"]*lg:px-\d/.test(layout));
  const css = readFileSync("src/app/globals.css", "utf-8");
  // A fixed page width once made every screen scroll sideways on a phone and
  // hid the mobile drawer's purpose; the layout must be allowed to shrink.
  check("no forced minimum page width", !/html\s*\{[^}]*min-width/.test(css));
  // The exact step does not matter; that it is smaller on a phone does.
  check("content padding shrinks on phones", /<main className="[^"]*px-4[^"]*lg:px-\d/.test(layout));

  console.log("\nSettings is generated, not hand-listed\n");
  const adminPage = readFileSync(`${APP}/admin/page.tsx`, "utf-8");
  check("the hub renders SETUP_PAGES", adminPage.includes("SETUP_PAGES.filter"));
  const setupCount = [...setup.matchAll(/href: "/g)].length;
  check("every admin route is declared", setupCount >= all.filter((r) => r.startsWith("/admin")).length - 1,
    `${setupCount} declared`);

  console.log(failures === 0 ? "\nAll shell checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
