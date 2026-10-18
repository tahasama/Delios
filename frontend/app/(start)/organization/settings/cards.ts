/**
 * The organization's Settings carry the same cards as a project's (owner): each opens the organization's version, with
 * the switch saying whether projects may change it. `slug` is the card's page here; `area` names its switches
 * (`Liberty.Items` area); `elsewhere` is where the organization's version already lives when it is not under Settings;
 * `level` says what the card holds on the organization's side.
 */
export type OrgCard = {
  /** The project's card it mirrors (SETUP_PAGES href). */
  project: string;
  title: string;
  text: string;
  slug?: string;
  area?: string;
  elsewhere?: string;
  /** Still edited in a project's Settings, for the organization, until this card is moved here. */
  notMovedYet?: boolean;
};

export const ORG_CARDS: OrgCard[] = [
  { project: "/settings/projects", title: "Projects", text: "Every project of ours: open one, change it, archive or reopen it.", elsewhere: "/organization/projects" },
  { project: "/settings/parties", title: "Organizations", text: "The organizations we work with, who they are, and how they work with us.", elsewhere: "/organization/organizations" },
  { project: "/settings/config", title: "Types & sets", text: "The lists every document is described with, and which of them a project may change.", slug: "types", area: "Types & sets", notMovedYet: true },
  { project: "/settings/fields", title: "Forms & fields", text: "What each form asks and insists on, for every project.", slug: "fields", area: "Forms & fields", notMovedYet: true },
  { project: "/settings/numbering", title: "Numbering", text: "How every number is built, and which scheme numbers what.", slug: "numbering", area: "Numbering" },
  { project: "/settings/revisions", title: "Revisions", text: "How revisions are named, line by line for each phase.", slug: "revisions", area: "Revisions" },
  { project: "/settings/flow", title: "Control room", text: "How a project works when it opens: who carries each act out, releasing, stamps, planning.", slug: "flow", area: "Control room", elsewhere: "/organization/defaults" },
  { project: "/settings/workflow-templates", title: "Review routes", text: "Who reviews, and in which order.", slug: "routes", area: "Review routes", notMovedYet: true },
  { project: "/settings/functions", title: "Functions & permissions", text: "The organization's jobs, and what each may do.", slug: "functions", area: "Functions & permissions", notMovedYet: true },
  { project: "/settings/users", title: "People & access", text: "Everyone in the organization, the projects each is on, sign-in.", elsewhere: "/organization" },
  { project: "/settings/security", title: "Sign-in & security", text: "The sign-in rules for everyone in the organization.", elsewhere: "/settings/security" },
  { project: "/settings/audit", title: "Audit trail", text: "Every recorded act, across our projects; and what is kept about people's activity.", elsewhere: "/settings/audit" },
];

export const orgCard = (slug: string) => ORG_CARDS.find((card) => card.slug === slug);
