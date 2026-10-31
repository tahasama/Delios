/** While the organization's page is read (several reads at once): said plainly, never drawn as empty figures. */
export default function OrganizationLoading() {
  return (
    <section aria-busy="true" className="register register-sheet register-sheet-open px-5 py-5 sm:px-6">
      <p className="plate-meta font-normal">Reading the organization&rsquo;s settings…</p>
    </section>
  );
}
