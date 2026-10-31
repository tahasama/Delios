import Link from "next/link";
import { api, projectPath } from "@/lib/client";
import type { Scope } from "@/lib/core/scope";
import type { ActivityRow } from "@/lib/types";
import { ACTIVITY, NEWS, ALIAS, read, lastWorkingDay, weekday, when } from "./home-parts";

/**
 * Home's journal beside the board: what the project did since the last working day (or lately, on a quiet day). It
 * reads on its own (`Part`): the board is drawn at once, and the journal failing leaves Home standing.
 */
export async function HomeJournal({ scope, controller, style }: { scope: Scope; controller: boolean; style?: React.CSSProperties }) {
  const session = scope;
  const acts = (rows: ActivityRow[]) => rows.map((e) => ({ id: e.id, ts: new Date(e.at), action: ALIAS[e.action] ?? e.action, actorName: e.actorName, entityType: e.entityType, entityLabel: e.entityLabel, detail: e.detail }));
  // The backend's names for the acts each kind of the journal covers.
  const backendNames = (kinds: string[]) => Object.keys(ALIAS).filter((name) => kinds.includes(ALIAS[name])).concat(kinds).join(",");
  // Project-wide, for everybody. A release, a rejection or a transmittal is a
  // fact about the project, not about the person reading it; scoping the
  // record by department is how people stop trusting it, because each of them
  // ends up looking at a different project. What a reader may not see is
  // already settled by the backend, not by this page.
  const since = lastWorkingDay();
  const news = acts(await api<ActivityRow[]>(projectPath(session, "/activity"), { keep: { areas: ["docs", "reviews", "transmittals", "packages", "plan", "checks"] }, query: { actions: backendNames(NEWS), since: since.toISOString(), take: 4 } }));
  // A quiet day should not leave the panel empty or showing one lonely line:
  // when the last working day produced almost nothing, the journal reaches
  // further back and says so instead.
  const older = news.length < 4
    ? acts(await api<ActivityRow[]>(projectPath(session, "/activity"), { keep: { areas: ["docs", "reviews", "transmittals", "packages", "plan", "checks"] }, query: { actions: backendNames(NEWS), before: since.toISOString(), take: 4 - news.length } }))
    : [];
  const journal = [...news, ...older];
  // An audit label reads "P1001-60-CI-SPC-00001 rev B — route name", and a
  // supplier's number runs half as long again. The panel measures its own
  // entries: the widest number sets the column the revisions line up in, and
  // when that number is long the kind is dropped rather than squeezed.
  const widest = Math.max(20, ...journal.map((e) => read(e.entityLabel)?.number.length ?? 0));
  const room = widest <= 26;
  if (!journal.length) return null;

  return (
    <section className="home-rise register register-sheet register-sheet-open px-4 py-3" style={style}>
      <h2 className="mb-2.5 text-[11px] font-semibold tracking-[0.09em] text-slate-400 uppercase">{older.length ? "Lately" : `Since ${weekday(since)}`}</h2>
      <ul>
        {journal.map((e, i) => {
          const kind = ACTIVITY[e.action];
          const shape = read(e.entityLabel);
          if (!kind || !shape) return null;
          return (
            <li key={e.id} className="relative min-w-0 pb-2.5 pl-4.5 last:pb-0">
              <span className={`absolute top-1.25 left-0 h-1.75 w-1.75 rounded-full border-2 bg-surface ${kind.mark}`} />
              {i < journal.length - 1 ? <span className="absolute top-3.5 -bottom-px left-0.75 w-px bg-line" /> : null}
              {/* The lines are held to the width of the longest number in
                  the panel, so every revision lands in the same column
                  instead of drifting out to the panel's edge. */}
              <span className="block min-w-0" style={{ maxWidth: `${widest}ch` }}>
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate font-mono text-[12.5px] font-semibold text-link">{shape.number}</span>
                  {room ? <span className="ml-auto shrink-0 text-[11px] text-slate-400">{kind.kind}</span> : null}
                </span>
                <span className="flex items-baseline gap-2 text-[12.5px] text-slate-600">
                  <span className="min-w-0 truncate">{kind.said}</span>
                  {shape.rev ? <span className="ml-auto shrink-0 font-mono text-[11.5px] text-slate-400">rev {shape.rev}</span> : null}
                </span>
                <span className="block truncate text-[11px] text-slate-400">{e.actorName} · {when(e.ts)}</span>
              </span>
            </li>
          );
        })}
      </ul>
                    {controller ? <Link href="/?view=log" scroll={false} className="mt-2.5 inline-block text-xs font-semibold text-link hover:underline">Everything that happened →</Link> : null}
    </section>
  );
}
