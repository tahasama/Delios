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
  group: "Organization" | "Classification" | "Access" | "Change & evidence";
};

export const SETUP_PAGES: SetupPage[] = [
  {
    href: "/admin/projects",
    title: "Projects",
    text: "Open, archive and switch between the projects your organization runs.",
    group: "Organization",
  },
  {
    href: "/admin/parties",
    title: "Parties",
    text: "Your own organization and the external ones you exchange information with.",
    group: "Organization",
  },
  {
    href: "/admin/dmp",
    title: "Scope & readiness",
    text: "What is set up, what is still missing, the scope statement and agreed exceptions.",
    group: "Organization",
  },

  {
    href: "/admin/config",
    title: "Disciplines, types & sets",
    text: "The published value sets every classification is drawn from.",
    group: "Classification",
  },
  {
    href: "/admin/numbering",
    title: "Numbering",
    text: "How document numbers are built, and which deliverable type uses which scheme.",
    group: "Classification",
  },
  {
    href: "/admin/assets",
    title: "Assets & tags",
    text: "The asset breakdown documents are associated with.",
    group: "Classification",
  },

  {
    href: "/admin/functions",
    title: "Functions & permissions",
    text: "What each function may do, and the clearance it carries.",
    group: "Access",
  },
  {
    href: "/admin/users",
    title: "People & access",
    text: "Who is on which project, and in what function. Invite outsiders or create visitors.",
    group: "Access",
  },
  {
    href: "/admin/distribution",
    title: "Distribution matrix",
    text: "Who receives which information, settled before any transmittal.",
    group: "Access",
  },
  {
    href: "/admin/authority",
    title: "Approval authority",
    text: "Which authority a document class needs before it can be approved.",
    group: "Access",
  },

  {
    href: "/admin/controlled",
    title: "Controlled changes",
    text: "Configuration that arrives as a file: uploaded, compared, approved.",
    group: "Change & evidence",
  },
  {
    href: "/admin/workflow-templates",
    title: "Review routes",
    text: "Reviewer sequences — parallel, serial, consolidated.",
    group: "Change & evidence",
  },
  {
    href: "/admin/audit",
    title: "Audit trail",
    text: "Every state transition, metadata change and access event.",
    group: "Change & evidence",
  },
];

export const SETUP_GROUPS: SetupPage["group"][] = [
  "Organization",
  "Classification",
  "Access",
  "Change & evidence",
];
