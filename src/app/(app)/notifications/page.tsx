import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, EmptyState } from "@/components/ui";
import { timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { user, db } = await requireScope();
  const list = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 60 });
  await db.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } });

  return (
    <div className="space-y-4">
      <PageHeader title="Notifications" subtitle="Updates that involve you, including submissions, decisions, supersessions and transmittals." />
      {list.length === 0 ? (
        <EmptyState title="Nothing yet" body="You will be notified when reviews, approvals, issues and obsolescence involve you." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          {list.map((n) => (
            <li key={n.id} className={`px-5 py-4 transition hover:bg-slate-50 ${n.read ? "" : "bg-sky-50/50"}`}>
              <Link href={n.link ?? "#"} className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                  {n.body ? <p className="mt-1 text-xs leading-5 text-slate-500">{n.body}</p> : null}
                </div>
                <span className="whitespace-nowrap text-xs text-slate-400">{timeAgo(n.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
