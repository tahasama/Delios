import { cache } from "react";
import type { Tenant } from "@/lib/core/tenant";
import { projectSettings, holders } from "@/lib/settings/api";
import { ESCALATE_AFTER_KEY, DEFAULT_ESCALATE_AFTER } from "@/lib/actions/escalation";

/** Somebody on the project holds the control function. */
async function hasControlFunction(t: Tenant): Promise<boolean> {
  return (await holders(t.projectId, "CONTROL")).length > 0;
}

/**
 * The acts that are either carried out by the control function or by the people
 * doing the work themselves.
 *
 * Whether a project has a control function is a fact about the project, not a
 * setting: an organization that puts somebody between the work and the record
 * gives that function to somebody. So every act here follows the project by
 * default. An administrator overrides one act at a time, because exceptions are
 * agreed per project — and the override decides what people see, not only what
 * the server allows.
 */
type ControlActivity = {
  key: string;
  title: string;
  /** What the act is, in the words of somebody doing it. */
  text: string;
  /** What happens when the control function carries it out. */
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
    control: "Whoever sent it for review waits; the control function issues it to the reviewers.",
    self: "Whoever sent it for review issues it to the reviewers themselves.",
    workByDefault: true,
  },
  {
    key: "RETURN_OUTCOME",
    title: "Returning the answer to the author",
    text: "The reviewers have answered, and the answer has to reach the person who wrote the document.",
    control: "The control function returns it, so an answer never passes straight from reviewer to author.",
    self: "The reviewer returns it to the author directly.",
  },
  {
    key: "ISSUE",
    title: "Sending a document out",
    text: "A released revision leaving the project — to a contractor, a supplier, the client.",
    control: "Whoever wants it sent asks, and the control function raises and sends the transmittal.",
    self: "Whoever wants it sent raises the transmittal and sends it themselves.",
    workByDefault: true,
  },
  {
    key: "DELEGATE",
    title: "Handing a review to somebody else",
    text: "A reviewer or a decider who cannot answer in time passes their step to another person the matrix names for it.",
    control: "The reviewer asks, and the control function lets the hand-over start.",
    self: "The reviewer hands it over themselves, and the record says who did it.",
  },
  {
    key: "AUTHORIZE_REVISION",
    title: "Starting a revision nobody asked for",
    text: "The last revision was accepted as it stands, and somebody wants a new one anyway. One a verdict asked for — refused, or accepted with comments — needs nobody's leave.",
    control: "The control function opens it, and writes why; the reason stays next to the revision it follows.",
    self: "Whoever works on the document opens it, and writes why; the reason stays next to the revision it follows.",
    workByDefault: true,
  },
  {
    key: "WITHDRAW",
    title: "Taking a document out of use",
    text: "The document should no longer be worked from at all.",
    control: "The control function withdraws it.",
    self: "Whoever registered the document withdraws it.",
  },
  {
    key: "ACTION_NOTE",
    title: "Writing down that an action went ahead without its documents",
    text: "The day passes and something it needed is still missing. Somebody carries the decision to go ahead anyway, or to stop; somebody owns the delay behind it. The note says both, and stays.",
    control: "The control function writes it, from what whoever runs the action and the late party tell them.",
    self: "Whoever the action answers to writes it themselves.",
  },
  {
    key: "ACTION_LINKS",
    title: "Adding a document or a discipline to an action",
    text: "Somebody finds an action is missing a document it needs, or a discipline it concerns.",
    control: "Whoever needs it asks, and the control function adds it. Asking is taking responsibility for it: the request keeps their name.",
    self: "The people of the discipline add it themselves, for their own discipline only; whoever plans the project is told.",
  },
  {
    key: "PROJECT_PEOPLE",
    title: "Adding people to the project",
    text: "Somebody joins the project, with a function and a department. Anyone of ours may always ask for someone new, from the project directory.",
    control: "Only the control function adds them (People & access).",
    self: "Everyone on the project adds them, from the project directory.",
  },
  {
    key: "VOID",
    title: "Voiding a revision, and recording what came of it",
    text: "A revision released in error, or never reviewed — and the work already done from it.",
    control: "The control function voids it and records the reassessment.",
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
    off: "Nobody hands a review over: each step is answered by the person it was given to. Hand-overs already started run to their end date.",
  },
  ACTION_NOTE: {
    off: "No note is written when an action goes ahead without its documents, or is stopped for want of them: the shortfall stays on the action as it is, and an action whose day has passed is taken to have happened. Notes already written stay on the record.",
  },
};

export const SKIP_KEY = (key: string) => `SKIP:${key}`;

/**
 * Acts whose requests may need confirming by whoever holds Manage when the control function
 * carries them out: the control function checks, whoever holds Manage confirms or refuses, and
 * what was asked is then applied by itself. Without a control function nothing is
 * confirmed.
 */
export const CONFIRMABLE: Record<string, string> = {
  ACTION_LINKS: "The control function checks the request, then whoever holds Manage confirms or refuses it; once confirmed it is applied by itself.",
  PROJECT_PEOPLE: "Whoever holds Manage confirms or refuses each addition; until confirmed they are not on the project.",
};

export const CONFIRM_KEY = (key: string) => `CONFIRM:${key}`;

/** Who adds people to the project, in the project's words: only the control function, or everyone on the project. */
export const PEOPLE_KEY = "PROJECT_PEOPLE";
/** The two answers of that switch, in the project's words. */
export const PEOPLE_MODE_LABEL: Record<ControlMode, string> = {
  CONTROL: "Only the control function",
  SELF: "Everyone on the project",
  FOLLOW: "Only the control function",
};

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
  "Accepting a check finding as it is has its own reason and a date to look again, on Assurance.",
  "Disposal of a record is never delegated.",
];

/** Who carries one act out. */
export type ControlMode = "FOLLOW" | "CONTROL" | "SELF";

export const MODE_LABEL: Record<ControlMode, string> = {
  FOLLOW: "As the project is set up",
  CONTROL: "The control function",
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
  CONTROL: "The control function does all of it",
  SELF: "The people doing the work do all of it",
  CUSTOM: "It depends on the act — set them one by one",
};

/**
 * Who carries out this act on this project: `true` means the control function.
 *
 * FOLLOW reads the project — does anybody hold the control function — so
 * nothing is configured twice.
 */
/**
 * Every answer this project has given, read once however many times a page asks.
 * A screen asks about half a dozen of these; one query answers all of them.
 */
const answers = cache(async (t: Tenant): Promise<Map<string, string>> => projectSettings(t.projectId));

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
 * Where the control function carries it out, they do — and an administrator, who
 * stands in for them. Where the people doing the work carry it out, whoever has
 * standing does, and the control function may as well: they never lose an act, they
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
  if (doesIt) return `On this project, ${title} is the control function's act. Ask them — the reason goes on the record.`;
  return activity ? activity.self : "Somebody else carries this out.";
}

/**
 * What an organization has decided about how it works, as against who does
 * what. Each is a genuine choice between two honest ways of running a project:
 * the app holds an opinion — the first option — and never more than that.
 */
type Policy = {
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
        label: "Releasing sends it — released & issued in one act (recommended)",
        text: "Whoever decides says who receives it. Releasing makes it the revision people work from and sends it to them, so there is always a record of who received what. Nothing is published to nobody.",
      },
      {
        value: "SEPARATE",
        label: "Releasing means go ahead",
        text: "Nobody is asked who receives it. Releasing makes it the revision people work from; they find it in the register and work from it; a transmittal can still be sent, but nothing requires one. For a team that works inside the app and needs no formal distribution.",
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
  {
    key: "POLICY_MATRIX_DETAIL",
    title: "How fine the distribution matrix is cut",
    text: "Whether one answer covers a whole discipline, or each kind of document in it is answered separately.",
    options: [
      {
        value: "DISCIPLINE",
        label: "One row per discipline — recommended",
        text: "Whoever reviews the electrical documents reviews all of them. The matrix stays short enough that people read it, and a document type needing a different answer is still a rule of its own.",
      },
      {
        value: "FAMILY",
        label: "One row per discipline and document family",
        text: "Electrical drawings, electrical calculations and electrical quality records are answered separately. Ten times the rows, for an organization whose contracts genuinely distribute them differently.",
      },
    ],
  },
];

/** How fine the distribution matrix is cut. */
export async function matrixDetail(t: Tenant): Promise<"DISCIPLINE" | "FAMILY"> {
  return (await policy(t, "POLICY_MATRIX_DETAIL")) === "FAMILY" ? "FAMILY" : "DISCIPLINE";
}

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
  return policiesFrom(await answers(t));
}

/** Every policy, read from a set of answers: a project's, or the organization's defaults for new projects. */
export function policiesFrom(chosen: Map<string, string>): { policy: Policy; value: string; set: boolean }[] {
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

/** Who carries out each act, as the screen shows it. */
export type ControlReading = {
  /** The project has a control function, which is the answer until one is set. */
  follows: boolean;
  /** What the project answers for all of its acts, and whether that was set. */
  projectMode: ProjectMode;
  set: boolean;
  rows: { activity: ControlActivity; mode: ControlMode; controlDoes: boolean; off: boolean; confirm: boolean }[];
};

/** Every answer at once, for the screen that shows them. */
export async function controlSettings(t: Tenant): Promise<ControlReading> {
  const [byKey, follows] = await Promise.all([answers(t), hasControlFunction(t)]);
  return controlFrom(byKey, follows);
}

/**
 * Who carries out each act, read from a set of answers: a project's, or the organization's defaults for new projects
 * (read as for a project with a control function, the usual case).
 */
export function controlFrom(byKey: Map<string, string>, follows: boolean): ControlReading {
  const all = byKey.get(PROJECT_KEY);
  const set = all === "CONTROL" || all === "SELF" || all === "CUSTOM";
  const asSet: ProjectMode = set ? (all as ProjectMode) : follows ? "CONTROL" : "SELF";
  const rows = CONTROL_ACTIVITIES.map((activity) => {
      const own = (byKey.get(activity.key) ?? "FOLLOW") as ControlMode;
      const mine = own === "CONTROL" ? true : own === "SELF" ? false : activity.workByDefault ? false : follows;
      return {
        activity,
        mode: own,
        // Until the project answers for everything, each act reads its own
        // default — which for most is the project's control function.
        controlDoes: !set ? mine : asSet === "CONTROL" ? true : asSet === "SELF" ? false : mine,
        off: !!SKIPPABLE[activity.key] && byKey.get(SKIP_KEY(activity.key)) === "OFF",
        confirm: !!CONFIRMABLE[activity.key] && effectiveAnswer(CONFIRM_KEY(activity.key), byKey.get(CONFIRM_KEY(activity.key))) === "ON",
      };
    });
  // Not answered yet, some acts stay with the people doing the work whatever the project has (workByDefault): the
  // project then reads as "it depends on the act", which is what it does.
  const mixed = rows.some((row) => row.controlDoes) && rows.some((row) => !row.controlDoes);
  return { follows, projectMode: !set && mixed ? "CUSTOM" : asSet, set, rows };
}

/**
 * What one stored answer amounts to, the app's own default standing in for no answer: so a project's answer and the
 * defaults it is compared with read the same when they mean the same.
 */
import { STAMP_KEYS, stampDefault } from "@/lib/settings/stamp";

export function effectiveAnswer(key: string, value: string | null | undefined): string {
  if (value) return value;
  if (STAMP_KEYS.includes(key)) return stampDefault(key);
  const declared = POLICIES.find((one) => one.key === key);
  if (declared) return declared.options[0].value;
  if (key === ESCALATE_AFTER_KEY) return String(DEFAULT_ESCALATE_AFTER);
  // Joining a project is a request whoever holds Manage confirms unless the project unticks it (backend DefaultConfirm).
  if (key === "CONFIRM:PROJECT_PEOPLE") return "ON";
  if (key.startsWith("CONFIRM:")) return "OFF";
  if (key.startsWith("SKIP:")) return "ON";
  return "FOLLOW";
}

/** The acts of "who carries each act out", one setting each (as the backend, `Liberty.RoomItemOf`). */
const ACT_KEYS = new Set(["REVIEW_ISSUE", "RETURN_OUTCOME", "ISSUE", "DELEGATE", "AUTHORIZE_REVISION", "WITHDRAW", "ACTION_NOTE", "ACTION_LINKS", "PROJECT_PEOPLE", "VOID", "__ALL__"]);

/**
 * The Control room answer (its switch, `LIBERTY:<key>`) a project's setting belongs to, as the backend reads it
 * (`Liberty.RoomItemOf`, which refuses a fixed one: ROOM_FIXED); none for a setting no switch covers.
 */
export function roomItemOf(key: string): string | null {
  if (ACT_KEYS.has(key) || key.startsWith("SKIP:") || key.startsWith("CONFIRM:")) return "WHO_DOES_WHAT";
  if (["POLICY_RELEASE", "POLICY_READY", "POLICY_MATRIX", "POLICY_MATRIX_DETAIL", "ESCALATE_AFTER_DAYS"].includes(key)) return key;
  if (key === "POLICY_PDF_STAMP" || key === "STAMP_COMMENTS" || key === "STAMP_PLACE" || key.startsWith("STAMP:") || key.startsWith("STAMP_SHOW:")) return "POLICY_PDF_STAMP";
  return null;
}
