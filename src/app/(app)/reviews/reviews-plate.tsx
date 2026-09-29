/**
 * The reviews register's masthead: the same plate the document register and the
 * dispatch log carry, because they are three registers of one project and ought
 * to look like it. The project is named in the header of every page, so it is
 * not repeated here.
 */
export function ReviewsPlate() {
  return (
    <div className="border-b border-line px-5 pt-6 pb-3 sm:px-6">
      <h1 className="plate-title min-w-0 text-slate-950">Reviews</h1>
      <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-500">
        Every review ever made — a document appears once for each time it was reviewed. A decision releases the
        revision or sends it back; advice is input to that decision; a client review happens after we released it,
        and is answered by a new revision.
      </p>
    </div>
  );
}
