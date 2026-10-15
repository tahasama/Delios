/**
 * A day (YYYY-MM-DD) said from today, the way a person would: "Today", "Yesterday", "3 days ago", "In 5 days".
 * Past two months, the day itself. Null when the text is not a day.
 */
export function fromToday(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const then = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((then - today) / 86_400_000);
  const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  if (days === 1) return "Tomorrow";
  if (Math.abs(days) > 60) return new Date(then).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return days < 0 ? `${plural(-days)} ago` : `In ${plural(days)}`;
}
