import { heldVerbs } from "@/lib/permissions";
/**
 * Every configuration screen, in one list.
 *
 * Three pages once existed, worked, and were unreachable because nobody had
 * added them to the sidebar — so as far as anyone using the app was concerned,
 * the features did not exist. This list is the single place a setup screen is
 * declared; the Settings hub renders all of it, so a page cannot be built and
 * then quietly orphaned.
 */
export type SetupPage = {
  href: string;
  title: string;
  text: string;
  group: "Organization" | "Classification" | "How work flows" | "Access" | "Change & evidence";
  /** The verb that opens this page. Configure (administrators) unless stated. */
  verb?: "MATRIX" | "ROUTES";
  /**
   * Also open to the control function. Document Control runs the register day
   * to day, so the lists it works from are its own: who the parties are, who
   * has access, how numbers are built, which routes exist. What decides the
   * organization itself — projects, scope, the classification sets — and the
   * audit trail stay with administrators.
   */
  control?: true;
};

/** Does this person reach this setup page? */
export function maySetup(user: { verbs?: string[]; role?: string } | null, page: SetupPage): boolean {
  if (!user) return false;
  const held = heldVerbs(user);
  const holds = (verb: string) => held.includes(verb);
  if (holds(page.verb ?? "CONFIGURE")) return true;
  return page.control === true && holds("CONTROL");
}

export const SETUP_PAGES: SetupPage[] = [
  {
    href: "/settings/projects",
    title: "Projects",
    text: "Open, archive and switch between the projects your organization runs.",
    group: "Organization",
  },
  {
    href: "/settings/parties",
    title: "Organizations",
    text: "Your own organization and the others you exchange information with.",
    group: "Organization",
    control: true,
  },
  {
    href: "/settings/dmp",
    title: "Scope & readiness",
    text: "What is set up, what is still missing, the scope statement and agreed exceptions.",
    group: "Organization",
  },

  {
    href: "/settings/config",
    title: "Disciplines, types & sets",
    text: "The published value sets every classification is drawn from.",
    group: "Classification",
  },
  {
    href: "/settings/families",
    title: "Document families",
    text: "The ten families every document type falls in, and when each one needs an outside stamp.",
    group: "Classification",
  },
  {
    href: "/settings/fields",
    title: "Forms & fields",
    text: "What each form asks for, and what it insists on — for documents, transmittals, reviews and activities.",
    group: "Classification",
  },
  {
    href: "/settings/numbering",
    title: "Numbering",
    text: "How document numbers are built, and which deliverable type uses which scheme.",
    group: "Classification",
    control: true,
  },

  {
    href: "/settings/flow",
    title: "Control room",
    text: "The whole flow on one page: each step a document goes through, who carries it out, what the project has settled, and the sets each step uses.",
    group: "How work flows",
  },
  {
    href: "/settings/workflow-templates",
    title: "Review routes",
    text: "Reviewer sequences — parallel, serial, consolidated.",
    group: "How work flows",
    verb: "ROUTES",
    control: true,
  },

  {
    href: "/settings/functions",
    title: "Functions & permissions",
    text: "What each function may do. An administrator’s own function can only be changed by an administrator.",
    group: "Access",
    control: true,
  },
  {
    href: "/settings/users",
    title: "People & access",
    text: "Who is on which project, and in what function. Invite outsiders or create visitors.",
    group: "Access",
    control: true,
  },

  {
    href: "/settings/controlled",
    title: "Uploaded lists to decide",
    text: "The schedule, the departments per activity and the document requirements are uploaded from Schedule & actions. Approve or reject them here; every past version is kept.",
    group: "Change & evidence",
  },
  {
    href: "/settings/audit",
    title: "Audit trail",
    text: "Every state transition, metadata change and access event.",
    group: "Change & evidence",
  },
];

export const SETUP_GROUPS: SetupPage["group"][] = [
  "Organization",
  "Classification",
  "How work flows",
  "Access",
  "Change & evidence",
];
