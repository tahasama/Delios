import { heldVerbs } from "@/lib/core/permissions";
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
   * Also open to the control function. The control function runs the register day
   * to day, so the lists it works from are its own: who the parties are, who
   * has access, how numbers are built, which routes exist. What decides the
   * organization itself — projects, scope, the classification sets — and the
   * audit trail stay with administrators.
   */
  control?: true;
  /** Also open to whoever holds Manage, where everyone on the project adds people. */
  manage?: true;
  /**
   * Read by everyone of ours on the project (the Control room: how the project works, and what makes it work that
   * way); changed only by an administrator or the control function.
   */
  read?: true;
};

/** Does this person reach this setup page? */
export function maySetup(user: { verbs?: string[]; role?: string; isInternal?: boolean } | null, page: SetupPage, managementAddsPeople = false): boolean {
  if (!user) return false;
  const held = heldVerbs(user);
  const holds = (verb: string) => held.includes(verb);
  if (holds(page.verb ?? "CONFIGURE")) return true;
  if (page.read === true && user.isInternal !== false) return true;
  // Where everyone on the project adds people (PROJECT_PEOPLE), whoever holds Manage reaches People & access.
  return (page.control === true && holds("CONTROL")) || (page.manage === true && managementAddsPeople && holds("MANAGE"));
}

export const SETUP_PAGES: SetupPage[] = [
  {
    href: "/settings/projects",
    title: "This project",
    text: "What it is: its name, code, type, our role, dates and scope. Every project is on the organization's page.",
    group: "Organization",
  },
  {
    href: "/settings/parties",
    title: "Organizations",
    text: "Which organizations work on this project: their role, their contract with us, who of theirs answers for them.",
    group: "Organization",
    control: true,
  },

  {
    href: "/settings/config",
    title: "Types & sets",
    text: "The lists every document is described with: disciplines, document types, statuses, reasons and more.",
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
    text: "What each form asks, and what it insists on: documents, revisions, transmittals, reviews, packages, tags.",
    group: "Classification",
    control: true,
    read: true,
  },
  {
    href: "/settings/numbering",
    title: "Numbering",
    text: "How document numbers are built, and which deliverable type uses which scheme.",
    group: "Classification",
    control: true,
  },
  {
    href: "/settings/revisions",
    title: "Revisions",
    text: "How revisions are named (A, B, C then 0, 1, 2, or your own), and which deliverable type follows which scheme.",
    group: "Classification",
    control: true,
  },

  {
    href: "/settings/flow",
    title: "Control room",
    text: "How the project works, and what makes it work that way: the whole way a document goes, who carries each act out, and what the project has settled.",
    group: "How work flows",
    read: true,
  },
  {
    href: "/settings/workflow-templates",
    title: "Review routes",
    text: "Who reviews, and in which order: side by side, one after another, or gathered by a lead.",
    group: "How work flows",
    verb: "ROUTES",
    control: true,
  },

  {
    href: "/settings/functions",
    title: "Functions & permissions",
    text: "What each function may do. Only an administrator changes an administrator's own function.",
    group: "Access",
    control: true,
  },
  {
    href: "/settings/security",
    title: "Sign-in & security",
    text: "Whether everyone signs in with a second step, who has it on, and turning it off for someone who lost their phone.",
    group: "Access",
  },
  {
    href: "/settings/users",
    title: "People & access",
    text: "Who is on which project, in which function. Add our people, or someone from another organization.",
    group: "Access",
    control: true,
    manage: true,
  },

  {
    href: "/settings/audit",
    title: "Audit trail",
    text: "Every change, with who made it and when.",
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

/** Who changes what the Control room settles: an administrator, or the control function of the project. */
export function mayChangeControlRoom(user: { verbs?: string[]; role?: string } | null): boolean {
  if (!user) return false;
  const held = heldVerbs(user);
  return held.includes("CONFIGURE") || held.includes("CONTROL");
}

/** The Control room stands above every other Settings page: it is not one card among them. */
export const CONTROL_ROOM = "/settings/flow";
