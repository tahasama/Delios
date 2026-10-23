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
  /** Its group on the hub when it is not one of a project's cards. */
  group?: "Organization" | "Classification" | "How work flows" | "Access" | "Change & evidence";
};

export const ORG_CARDS: OrgCard[] = [
  { project: "identity", title: "Who we are on DELIOS", text: "Our code and name everywhere, our identifier and email domain; claims and merges asked of us.", slug: "identity", group: "Organization" },
  { project: "defaults", title: "Defaults for new projects", text: "What a project of ours starts with: who carries each act out, and how it works. Copied when it opens.", elsewhere: "/organization/defaults", group: "Organization" },
  { project: "may-change", title: "What projects may change", text: "Every setting in one list: fixed, the same on every project, or free, a project may take its own copy.", slug: "may-change", group: "Organization" },
  { project: "/settings/config", title: "Types & sets", text: "The lists every document is described with, and which of them a project may change.", slug: "types", area: "Types & sets" },
  { project: "/settings/fields", title: "Forms & fields", text: "What each form asks and insists on, for every project.", slug: "fields", area: "Forms & fields" },
  { project: "/settings/numbering", title: "Numbering", text: "How every number is built, and which scheme numbers what.", slug: "numbering", area: "Numbering" },
  { project: "/settings/revisions", title: "Revisions", text: "How revisions are named, line by line for each phase.", slug: "revisions", area: "Revisions" },
  { project: "/settings/flow", title: "Control room", text: "How a project works when it opens: who carries each act out, releasing, stamps, planning.", slug: "flow", area: "Control room" },
  { project: "/settings/stamp", title: "The stamp", text: "What a review's decision puts on the PDF, on every project.", slug: "stamp", area: "The stamp" },
  { project: "/settings/calendar", title: "Calendar", text: "The public holidays by country, how dates read, and where a new project's site starts.", slug: "calendar", area: "Calendar" },
  { project: "states", title: "What the states are called", text: "The organization's words for each state of a revision, on every project.", slug: "states", group: "How work flows" },
  { project: "/settings/workflow-templates", title: "Review routes", text: "Who reviews, and in which order.", slug: "routes", area: "Review routes" },
  { project: "/settings/functions", title: "Functions & permissions", text: "The organization's jobs, and what each may do.", slug: "functions", area: "Functions & permissions" },
  { project: "/settings/security", title: "Security & privacy", text: "The sign-in rules for everyone in the organization, and what is kept about people's activity.", slug: "security", group: "Access" },
  { project: "/settings/audit", title: "Audit trail", text: "Every recorded act, across our projects.", elsewhere: "/settings/audit" },
];

export const orgCard = (slug: string) => ORG_CARDS.find((card) => card.slug === slug);
