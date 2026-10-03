import type { Tenant } from "./tenant";

/**
 * Disciplines, and the handful of groups they fall in.
 *
 * The same bargain as the document families: a question answered once per group
 * instead of once per discipline, and a sector that turns up tomorrow adds its
 * disciplines under an existing group rather than inventing structure. A
 * petroleum project adds drilling and reservoir under engineering design, and
 * every screen that reads groups keeps working without knowing they exist.
 */

export type DisciplineGroup = {
  code: string;
  label: string;
  description: string;
};

export type Discipline = {
  code: string;
  label: string;
  group: DisciplineGroup | null;
};

function parse(props: string | null): Record<string, unknown> {
  if (!props) return {};
  try { return JSON.parse(props) as Record<string, unknown>; } catch { return {}; }
}

/** Every group this organization publishes, in the published order. */
export async function disciplineGroups(t: Tenant): Promise<DisciplineGroup[]> {
  const rows = await t.db.configValue.findMany({
    where: { setKey: "DISCIPLINE_GROUPS", status: "ACTIVE" },
    orderBy: [{ sort: "asc" }, { code: "asc" }],
    select: { code: true, label: true, props: true },
  });
  return rows.map((row) => {
    const props = parse(row.props);
    return { code: row.code, label: row.label, description: typeof props.description === "string" ? props.description : "" };
  });
}

/**
 * Every discipline with the group it falls in.
 *
 * A discipline that names no group is not guessed at: it comes back ungrouped
 * and is shown as such, because a wrong group is worse than a visible gap.
 */
export async function disciplines(t: Tenant): Promise<Discipline[]> {
  const [groups, rows] = await Promise.all([
    disciplineGroups(t),
    t.db.configValue.findMany({
      where: { setKey: "DISCIPLINES", status: "ACTIVE" },
      orderBy: [{ sort: "asc" }, { code: "asc" }],
      select: { code: true, label: true, props: true },
    }),
  ]);
  return rows.map((row) => {
    const named = parse(row.props).group;
    const group = typeof named === "string" ? groups.find((g) => g.code === named.trim().toUpperCase()) ?? null : null;
    return { code: row.code, label: row.label, group };
  });
}

/**
 * The same disciplines, in group order, with the ungrouped ones last. This is
 * the order anything that lists disciplines should use — it is how the lists
 * engineers already read are laid out.
 */
export async function byGroup(t: Tenant): Promise<{ group: DisciplineGroup | null; disciplines: Discipline[] }[]> {
  const [groups, all] = await Promise.all([disciplineGroups(t), disciplines(t)]);
  const out: { group: DisciplineGroup | null; disciplines: Discipline[] }[] = groups.map((group) => ({
    group,
    disciplines: all.filter((d) => d.group?.code === group.code),
  }));
  const loose = all.filter((d) => !d.group);
  if (loose.length) out.push({ group: null, disciplines: loose });
  return out.filter((band) => band.disciplines.length > 0);
}
