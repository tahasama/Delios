import ProjectsPage from "./projects/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

/**
 * The organization opens on its projects (owner, the way Autodesk's account admin and GitHub's organization open: no
 * overview to work through, the list used most first). The same page as the Projects tab.
 */
export default function OrganizationPage(props: { searchParams: Promise<{ edit?: string; new?: string }> }) {
  return <ProjectsPage {...props} />;
}
