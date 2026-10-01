import { cache } from "react";
import type { Tenant } from "./tenant";
import { hasControlFunction } from "./issue-requests";

/**
 * The acts that are either carried out by Document Control or by the people
 * doing the work themselves.
 *
 * Whether a project has a control function is a fact about the project, not a
 * setting: an organization that puts somebody between the work and the record
 * gives that function to somebody. So every act here follows the project by
 * default. An administrator overrides one act at a time, because exceptions are
 * agreed per project — and the override decides what people see, not only what
 * the server allows.
 */
export type ControlActivity = {
  key: string;
  title: string;
  /** What the act is, in the words of somebody doing it. */
  text: string;
  /** What happens when Document Control carries it out. */
  control: string;
  /** What happens when the people doing the work carry it out. */
  self: string;
  /**
   * Left to the people doing the work unless an administrator says otherwise,
   * whether or not the project has a control function: the recommended default.
   */
  workByDefault?: true;
};

export const CONTROL_ACTIVITIES: ControlActivity[] = [
  {
    key: "REVIEW_ISSUE",
    title: "Sending a review to its reviewers",
    text: "A revision is ready to be looked at, and the reviewers have to be told it is with them.",
    control: "Whoever sent it for review waits; Document Control issues it to the reviewers.",
    self: "Whoever sent it for review issues it to the reviewers themselves.",
  },
  {
    key: "RETURN_OUTCOME",
    title: "Returning the answer to the author",
    text: "The reviewers have answered, and the answer has to reach the person who wrote the document.",
    control: "Document Control returns it, so an answer never passes straight from reviewer to author.",
    self: "The reviewer returns it to the author directly.",
  },
  {
    key: "ISSUE",
    title: "Sending a document out",
    text: "A released revision leaving the project — to a contractor, a supplier, the client.",
    control: "Whoever wants it sent asks, and Document Control raises and sends the transmittal.",
    self: "Whoever wants it sent raises the transmittal and sends it themselves.",
  },
  {
    key: "DELEGATE",
    title: "Handing a review to somebody else",
    text: "A reviewer or a decider who cannot answer in time passes their step to another person the matrix names for it.",
    control: "The reviewer asks, and Document Control puts the delegation in force.",
    self: "The reviewer hands it over themselves, and the record says who did it.",
  },
  {
    key: "AUTHORIZE_REVISION",
    title: "Starting a revision nobody asked for",
    text: "The last revision was accepted as it stands, and somebody wants a new one anyway. One a verdict asked for — refused, or accepted with comments — needs nobody's leave.",
    control: "Document Control opens it, and writes why; the reason stays next to the revision it follows.",
    self: "Whoever works on the document opens it, and writes why; the reason stays next to the revision it follows.",
    workByDefault: true,
  },
  {
    key: "WITHDRAW",
    title: "Taking a document out of use",
    text: "The document should no longer be worked from at all.",
    control: "Document Control withdraws it.",
    self: "Whoever registered the document withdraws it.",
  },
  {
    key: "ACTION_NOTE",
    title: "Writing down that an action went ahead without its documents",
    text: "The day passes and something it needed is still missing. Somebody carries the decision to go ahead anyway, or to stop; somebody owns the delay behind it. The note says both, and stays.",
    control: "Document Control writes it, from what the manager and the late party tell them.",
    self: "The manager the action answers to writes it themselves.",
  },
  {
    key: "VOID",
    title: "Voiding a revision, and recording what came of it",
    text: "A revision released in error, or never reviewed — and the work already done from it.",
    control: "Document Control voids it and records the reassessment.",
    self: "Whoever wrote the revision voids it and records the reassessment.",
  },
];

/**
 * Acts an organization may leave out altogether, and what that means. Only acts
 * whose absence leaves the record whole are here: nobody ever skips a release,
 * a void, a withdrawal, the answer reaching its author, or a hold.
 *
 * Skipping is kept apart from who carries an act out, under its own key, so
 * that turning an act back on finds it carried out as it was before.
 */
export const SKIPPABLE: Record<string, { off: string }> = {
  DELEGATE: {
    off: "Nobody hands a review over: each step is answered by the person it was given to. Hand-overs already in force run to their end date.",
  },
  ACTION_NOTE: {
    off: "No note is written when an action goes ahead without its documents, or is stopped for want of them: the shortfall stays on the action as it is, and an action whose day has passed is taken to have happened. Notes already written stay on the record.",
  },
};

export const SKIP_KEY = (key: string) => `SKIP:${key}`;

/** Has the organization left this act out? */
export async function actIsOff(t: Tenant, key: string): Promise<boolean> {
  if (!SKIPPABLE[key]) return false;
  return (await answers(t)).get(SKIP_KEY(key)) === "OFF";
}

/**
 * Acts that stay where they are, and why — so the screen does not pretend
 * everything is a choice.
 */
export const NOT_SWITCHABLE = [
  "Accepting something that arrived is the recipient's act already, checked against the acceptance conditions.",
  "Refusing to publish a decided revision only exists where somebody stands between the decision and the register — that is the control function itself.",
  "Accepting a check finding has its own authority on the Scope & readiness screen.",
  "Disposal of a record is never delegated.",
];

/** Who carries one act out. */
export type ControlMode = "FOLLOW" | "CONTROL" | "SELF";

export const MODE_LABEL: Record<ControlMode, string> = {
  FOLLOW: "As the project is set up",
  CONTROL: "Document Control",
  SELF: "The people doing the work",
};

/**
 * How the project answers the question for all of its acts.
 *
 * CONTROL and SELF answer it once, for everything. CUSTOM says the answer is
 * per act, and then the list below decides each one. An organization that has
 * never opened the screen is on neither: the answer is read from the project —
 * does anybody hold the control function — which is what CONTROL or SELF would
 * have said anyway.
 */
export type ProjectMode = "CONTROL" | "SELF" | "CUSTOM";

/** The reserved key the whole-project answer is stored under. */
export const PROJECT_KEY = "__ALL__";

export const PROJECT_MODE_LABEL: Record<ProjectMode, string> = {
  CONTROL: "Document Control does all of it",
  SELF: "The people doing the work do all of it",
  CUSTOM: "It depends on the act — set them one by one",
};

/**
 * Who carries out this act on this project: `true` means Document Control.
 *
 * FOLLOW reads the project — does anybody hold the control function — so
 * nothing is configured twice.
 */
/**
 * Every answer this project has given, read once however many times a page asks.
 * A screen asks about half a dozen of these; one query answers all of them.
 */
const answers = cache(async (t: Tenant): Promise<Map<string, string>> => {
  const rows = await t.db.controlSetting.findMany({ select: { key: true, mode: true } });
  return new Map(rows.map((one) => [one.key, one.mode]));
});

export async function controlDoes(t: Tenant, key: string): Promise<boolean> {
  const rows = [...(await answers(t))].map(([k, mode]) => ({ key: k, mode }));
  const all = rows.find((one) => one.key === PROJECT_KEY)?.mode;
  if (all === "CONTROL") return true;
  if (all === "SELF") return false;
  if (all === "CUSTOM") {
    const own = rows.find((one) => one.key === key)?.mode;
    if (own === "CONTROL") return true;
    if (own === "SELF") return false;
  }
  if (CONTROL_ACTIVITIES.find((one) => one.key === key)?.workByDefault) return false;
  return hasControlFunction(t);
}

/**
 * May this person carry this act out?
 *
 * Where Document Control carries it out, they do — and an administrator, who
 * stands in for them. Where the people doing the work carry it out, whoever has
 * standing does, and Document Control may as well: they never lose an act, they
 * only stop being the only ones who hold it.
 */
export async function carrierRefusal(
  t: Tenant,
  key: string,
  { control, standing }: { control: boolean; standing: boolean },
): Promise<string | null> {
  const doesIt = await controlDoes(t, key);
  if (control) return null;
  if (!doesIt && standing) return null;
  const activity = CONTROL_ACTIVITIES.find((one) => one.key === key);
  const title = activity ? activity.title.toLowerCase() : "this";
  if (doesIt) return `On this project, ${title} is Document Control's act. Ask them — the reason goes on the record.`;
  return activity ? activity.self : "Somebody else carries this out.";
}

/**
 * What an organization has decided about how it works, as against who does
 * what. Each is a genuine choice between two honest ways of running a project:
 * the app holds an opinion — the first option — and never more than that.
 */
export type Policy = {
  key: string;
  title: string;
  text: string;
  options: { value: string; label: string; text: string }[];
};

export const POLICIES: Policy[] = [
  {
    key: "POLICY_RELEASE",
    title: "What releasing a revision means",
    text: "The moment a revision becomes the one people work from — and whether sending it out is part of that moment.",
    options: [
      {
        value: "TOGETHER",
        label: "Released and issued, in one act — recommended",
        text: "It is not released until somebody has said who receives it, and releasing it sends it: the review route is not finished until that is said. Nothing is ever published to nobody, and nothing is sent that was not published.",
      },
      {
        value: "SEPARATE",
        label: "Released, then issued — two acts",
        text: "Releasing puts it in force in the register and it reads Released; sending it is a separate act, done later or not at all, and then it reads Issued. Saying who receives it is optional on the review route. For an organization that runs the pipeline and leaves distribution outside it.",
      },
    ],
  },
  {
    key: "POLICY_PDF_STAMP",
    title: "Stamping the PDF",
    text: "Whether a binding review verdict — and a hold — is stamped on the PDF copy people open, or kept in the record only. The file as submitted is kept either way.",
    options: [
      {
        value: "ON",
        label: "Stamp it on the document",
        text: "The verdict, who gave it, when and why, in the top right of the first page; a revision on hold says so across every page. Whoever opens the file reads where it stands without the app.",
      },
      {
        value: "OFF",
        label: "Keep it in the record only",
        text: "The PDF people open stays as it was submitted, apart from the release title block. Where it stands is read in the app.",
      },
    ],
  },
  {
    key: "POLICY_READY",
    title: "When an action has what it needs",
    text: "What makes a document on an action's list count as delivered.",
    options: [
      {
        value: "ISSUED",
        label: "Released and issued at the status the action needs",
        text: "The document went through its route, was published, and reached the people who were named. The strictest reading, and the one the schedule was built on.",
      },
      {
        value: "STATUS",
        label: "Carrying the status the action needs",
        text: "Whatever the newest revision carries counts, however it got there. For an organization that treats an approved status as enough to work from.",
      },
    ],
  },
  {
    key: "POLICY_NO_ISSUE",
    title: "Released with nobody to send it to yet",
    text: "Whether whoever decides a revision may say no issue is required for now, besides naming who receives it or leaving that to its author.",
    options: [
      {
        value: "ALLOWED",
        label: "Allowed — \u201cno issue required for now\u201d is offered",
        text: "The revision is released and nobody is told; the document says it was not issued, and anybody with standing on it can ask for it to be sent later.",
      },
      {
        value: "NEVER",
        label: "Not allowed",
        text: "Whoever decides either names who receives it or leaves that to its author. Nothing is released without somebody being responsible for sending it.",
      },
    ],
  },
  {
    key: "POLICY_MATRIX",
    title: "Who may be put on a review",
    text: "Whether the distribution matrix decides who can be put on a review step or handed one, or only recommends.",
    options: [
      {
        value: "GUIDE",
        label: "The matrix recommends — recommended",
        text: "It proposes the people and is the reference, but anyone on the project can be named. Somebody it does not name for that act is flagged, and the record says who chose them. Projects move without renewing the matrix for every exception.",
      },
      {
        value: "STRICT",
        label: "The matrix is the only rule",
        text: "Only people the matrix names for the act, on that kind of document, can be put on a review step or handed one. Anybody else needs the matrix changed first.",
      },
    ],
  },
];

/** The matrix is the only rule for who reviews, decides or is handed a step. */
export async function matrixBinds(t: Tenant): Promise<boolean> {
  return (await policy(t, "POLICY_MATRIX")) === "STRICT";
}

/** What this project answered, or the app's opinion where it has not. */
export async function policy(t: Tenant, key: string): Promise<string> {
  const chosen = (await answers(t)).get(key);
  const declared = POLICIES.find((one) => one.key === key);
  const allowed = declared?.options.map((one) => one.value) ?? [];
  if (chosen && allowed.includes(chosen)) return chosen;
  return allowed[0] ?? "";
}

/** Every policy at once, for the screen that shows them. */
export async function policies(t: Tenant): Promise<{ policy: Policy; value: string; set: boolean }[]> {
  const chosen = await answers(t);
  return POLICIES.map((one) => {
    const value = chosen.get(one.key);
    const allowed = one.options.map((option) => option.value);
    return {
      policy: one,
      value: value && allowed.includes(value) ? value : allowed[0],
      set: !!value && allowed.includes(value),
    };
  });
}

/** Every answer at once, for the screen that shows them. */
export async function controlSettings(t: Tenant): Promise<{
  /** The project has a control function, which is the answer until one is set. */
  follows: boolean;
  /** What the project answers for all of its acts, and whether that was set. */
  projectMode: ProjectMode;
  set: boolean;
  rows: { activity: ControlActivity; mode: ControlMode; controlDoes: boolean; off: boolean }[];
}> {
  const [byKey, follows] = await Promise.all([answers(t), hasControlFunction(t)]);
  const all = byKey.get(PROJECT_KEY);
  const set = all === "CONTROL" || all === "SELF" || all === "CUSTOM";
  const projectMode: ProjectMode = set ? (all as ProjectMode) : follows ? "CONTROL" : "SELF";
  return {
    follows,
    projectMode,
    set,
    rows: CONTROL_ACTIVITIES.map((activity) => {
      const own = (byKey.get(activity.key) ?? "FOLLOW") as ControlMode;
      const mine = own === "CONTROL" ? true : own === "SELF" ? false : activity.workByDefault ? false : follows;
      return {
        activity,
        mode: own,
        // Until the project answers for everything, each act reads its own
        // default — which for most is the project's control function.
        controlDoes: !set ? mine : projectMode === "CONTROL" ? true : projectMode === "SELF" ? false : mine,
        off: !!SKIPPABLE[activity.key] && byKey.get(SKIP_KEY(activity.key)) === "OFF",
      };
    }),
  };
}
