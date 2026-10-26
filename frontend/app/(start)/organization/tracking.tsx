import { ActionForm } from "@/components/form";
import { setTrackingAction } from "@/lib/organization/forms";

/**
 * What is kept about people's activity, the organization's choice (a privacy policy is the organization's): one
 * sheet, the new-document form's way — band, the two questions, then the strip with the act. Acts on documents are
 * always kept and say so; reading and sign-ins are the two switches.
 */
export function TrackingSheet({ reading, signIns }: { reading: boolean; signIns: boolean }) {
  return (
    <section id="tracking" className="register register-sheet register-sheet-open scroll-mt-24" aria-labelledby="tracking-head">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span id="tracking-head" className="stencil mr-1 text-slate-500">What is kept about people&rsquo;s activity</span>
        <span className="text-[11px] text-slate-500">read on each person&rsquo;s page in People &amp; access, by an administrator or the control function</span>
      </div>
      <ActionForm id="tracking-form" action={setTrackingAction} hideSubmit className="asking space-y-5 px-5 py-5 sm:px-6">
        <p className="text-xs leading-5 text-slate-600">
          <span className="font-semibold text-slate-800">Always kept:</span> what people do to documents (registered, reviewed, released, sent, returned), and every file
          downloaded. It is the register&rsquo;s own record, and the app&rsquo;s rules rest on it; downloads protect the files: the
          administrators are told when one person downloads more than 200 files in an hour.
        </p>
        <fieldset className="space-y-2">
          <legend className="stencil mb-1.5 text-slate-500">Keep who opened a document?</legend>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-slate-700">
            <label className="flex items-center gap-1.5"><input type="radio" name="reading" value="ON" defaultChecked={reading} required /> Keep it: who saw which revision, and when</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="reading" value="OFF" defaultChecked={!reading} required /> Do not keep it</label>
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="stencil mb-1.5 text-slate-500">Show sign-ins on a person&rsquo;s activity?</legend>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-slate-700">
            <label className="flex items-center gap-1.5"><input type="radio" name="signIns" value="ON" defaultChecked={signIns} required /> Show them, for our IT and security</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="signIns" value="OFF" defaultChecked={!signIns} required /> Keep them for security only, not shown</label>
          </div>
          <p className="text-[11px] leading-4 text-slate-500">Sign-ins, failed ones and locked accounts are always kept, to protect every account.</p>
        </fieldset>
      </ActionForm>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
        <span className="text-[11px] text-slate-500">Tell your people what is kept, in your privacy notice. It applies to every project, from now on.</span>
        <button type="submit" form="tracking-form" data-on="true" className="ask">Save</button>
      </div>
    </section>
  );
}
