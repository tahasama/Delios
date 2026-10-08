import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { scheduleSource } from "@/lib/api/schedule";
import { CalendarRange, ListChecks, Users, ArrowRight } from "lucide-react";

/**
 * The three things the schedule side of the project rests on: the schedule
 * itself, the disciplines each action concerns, and the documents those
 * disciplines listed. Each is changed by uploading a new version, so each is
 * one button — nothing else, because nothing else is a thing to do.
 *
 * The word changes with the state: nothing uploaded yet is an upload, and
 * everything after that is an update.
 */
const KINDS = [
  { kind: "SCHEDULE", noun: "project schedule", icon: CalendarRange },
  { kind: "ACTION_DEPARTMENTS", noun: "disciplines per action", icon: Users },
  { kind: "DOCUMENT_REQUIREMENTS", noun: "action requirements", icon: ListChecks },
];

export async function PlanCards() {
  const ctx = await requireScope();
  // The backend keeps no controlled lists. The schedule is held once the
  // schedule document has been read; departments come with it, and what each
  // action needs is said on the action.
  const { imports } = await scheduleSource(ctx);
  const sets = [{
    kind: "SCHEDULE",
    projectId: ctx.projectId as string | null,
    versions: imports.filter((one) => one.status === "DONE").map(() => ({ state: "APPROVED" })),
  }];

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
      {KINDS.map(({ kind, noun, icon: Icon }) => {
        const versions = sets
          .filter((set) => set.kind === kind && (set.projectId === null || set.projectId === ctx.projectId))
          .flatMap((set) => set.versions);
        const held = versions.some((version) => version.state === "APPROVED");
        return (
          <Link
            key={kind}
            href={`/settings/controlled/${kind}`}
            className="group flex items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-left transition hover:border-brand-line/50 hover:bg-surface"
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-brand-ink" />
            <span className="min-w-0 truncate text-xs font-semibold text-slate-700 group-hover:text-brand-ink">
              {held ? "Update" : "Upload"} {noun}
            </span>
            <ArrowRight className="ml-auto h-3 w-3 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-ink" />
          </Link>
        );
      })}
    </div>
  );
}
