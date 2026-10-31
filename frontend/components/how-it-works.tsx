import Link from "next/link";

/**
 * The organization's defaults for new projects are answered on their own page (`/organization/defaults`), each answer a
 * `Choice` as in the Control room; this is the way to them from a project's settings, for its administrators.
 */
export function DefaultsLink() {
  return <Link href="/organization/defaults" className="font-semibold text-link hover:underline">defaults for new projects</Link>;
}
