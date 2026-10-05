import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { stateNames, stateName } from "@/lib/state-names";
import { getActiveSet } from "@/lib/config";
import { PageHeader, Card, DataTable, Th, Td, Chip } from "@/components/ui";
import { ADVICE_CODES, ADVICE_LABEL, ADVICE_MEANING, DOC_STATES, DOC_STATE_LABEL, DOC_STATE_COLOR, DOC_MEANING, REV_STATES, REV_STATE_COLOR, REV_MEANING, EMPTY_TITLE_WORDS, type DocState, type RevState } from "@/lib/standard";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { VERDICT_EFFECT, verdictEffect } from "@/lib/verdict-effect";

export const dynamic = "force-dynamic";
export const metadata = { title: "States and codes" };

/**
 * Four different things get called "status". This page keeps them apart:
 * what each describes, who decides it, what moves it, and whether the list is
 * fixed by the Standard or published by the organization.
 */

const CONSEQUENCE = Object.fromEntries(VERDICT_EFFECT.map((e) => [e.value, e.label]));

export default async function CodesPage() {
  const ctx = await requireScope();
  const names = await stateNames(ctx);
  const [statuses, outcomes, advice, commentClasses, criticalities, confidentialities] = await Promise.all([
    getActiveSet("STATUSES"), getActiveSet("REVIEW_OUTCOMES"), getActiveSet("REVIEW_ADVICE"), getActiveSet("COMMENT_CLASSES"),
    getActiveSet("CRITICALITY"), getActiveSet("CONFIDENTIALITY"),
  ]);
  const canEdit = ctx.can("CONFIGURE");
  const text = (v: unknown) => (typeof v === "string" && v !== "—" ? v : null);

  return (
    <div className="space-y-5">
      <Link href="/guide" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" /> Help & orientation</Link>
      <PageHeader
        title="States and codes"
        subtitle="Four different things are often all called “status”. Each answers a different question, and only one of them is a decision: the review verdict."
      />

      {/* The four, side by side */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Layer n="1" href="#document" title="Document state" about="the document number as a whole" examples="Planned · Active · Withdrawn" who="The system, and Document Control to end it" list="Fixed by the Standard" />
        <Layer n="2" href="#revision" title="Revision state" about="one revision — A, B, C…" examples="In preparation · In review · Released" who="Moves as the work moves: author, then Document Control" list="Fixed by the Standard" />
        <Layer n="3" href="#outcome" title="Review verdict" about="the decision on a revision in review" examples="C1 · C2 · C3 · C4" who="The route's last step — someone who may approve" list="Your organization's list" />
        <Layer n="4" href="#status" title="Released for" about="what a released revision may be used for" examples="IFC · AFC · IFI · AB" who="Document Control, when releasing" list="Your organization's list" />
      </div>

      {/* How they connect */}
      <Card title="How one leads to the next" description="The usual path of a document, with the layer each step changes.">
        <ol className="grid grid-cols-1 gap-2 lg:grid-cols-6">
          <FlowStep n="1" title="Create" who="Author" body="Number reserved." chips={[["1", "Planned"]]} />
          <FlowStep n="2" title="Write rev A" who="Author" body="Content being prepared." chips={[["2", "In preparation"]]} />
          <FlowStep n="3" title="Send down a route" who="Author or Document Control" body="The route names who advises and who decides." chips={[["2", "In review"]]} />
          <FlowStep n="4" title="Advise" who="Reviewers" body="Comments and a suggested verdict." chips={[]} />
          <FlowStep n="5" title="Decide" who="Last step · an approver" body="The binding verdict, and what it may be used for." chips={[["3", "C1 / C2 / C3 / C4"], ["4", "IFC"]]} />
          <FlowStep n="6" title="Release" who="Document Control" body="Checks, then releases at the status decided — “to be” drops." chips={[["2", "Released"], ["4", "IFC"], ["1", "Active"]]} last />
        </ol>
        <div className="mt-4 grid grid-cols-1 gap-3 text-xs leading-5 text-slate-600 md:grid-cols-3">
          <p className="rounded-xl bg-tint-soft p-3"><strong className="text-slate-800">Releasing is not sending.</strong> Release is internal: it makes that revision the current one and fixes what it may be used for. Issuing is a transmittal: telling a named party, for a stated reason. A revision can be released and issued to nobody, or issued many times after one release.</p>
          <p className="rounded-xl bg-tint-soft p-3"><strong className="text-slate-800">One decision.</strong> Only the route&apos;s last step decides, and only people the distribution matrix lets approve the document can be on it. There is no separate approval to agree or disagree with it.</p>
          <p className="rounded-xl bg-tint-soft p-3"><strong className="text-slate-800">If the verdict is C3 or C4</strong>, rev A is never released. The author prepares rev B — the verdict itself authorizes it — and it goes down the route again.</p>
          <p className="rounded-xl bg-tint-soft p-3"><strong className="text-slate-800">When rev B is released</strong>, rev A becomes Superseded on its own, and everyone who received rev A must be sent rev B.</p>
        </div>
      </Card>

      <Card id="document" title="1 · Document state — the document number as a whole" description="Fixed — the same in every organization, and not something a project changes.">
        <DataTable id="codes-doc-states" toolbar={false} head={<tr><Th>State</Th><Th>Means</Th><Th>How it gets there</Th></tr>}>
          {DOC_STATES.map((s) => (
            <tr key={s}>
              <Td className="whitespace-nowrap"><Chip className={DOC_STATE_COLOR[s]}>{DOC_STATE_LABEL[s]}</Chip></Td>
              <Td className="text-xs">{DOC_MEANING[s].means}</Td>
              <Td className="text-xs">{DOC_MEANING[s].how}</Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card id="revision" title="2 · Revision state — one revision of the content" description="Fixed — your organization may rename them, never change what they do. States only move forward. The register shows “No revision yet” for a document that has no revision at all.">
        <DataTable id="codes-rev-states" toolbar={false} head={<tr><Th>State</Th><Th>Means</Th><Th>How it gets there</Th></tr>}>
          {REV_STATES.map((s) => (
            <tr key={s}>
              <Td className="whitespace-nowrap"><Chip className={REV_STATE_COLOR[s]}>{stateName(names, s)}</Chip></Td>
              <Td className="text-xs">{REV_MEANING[s].means}</Td>
              <Td className="text-xs">{REV_MEANING[s].how}</Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card id="outcome" title="3 · Review verdict — the one decision" description="Given at the last step of a review route by someone who may approve the document. A verdict that proceeds is the release approval. Only that step gives a verdict; the steps before it give advice, from the list below. Some projects write them as A / B / C / D or Code 1–4.">
        <DataTable id="codes-outcomes" toolbar={false} head={<tr><Th>Code</Th><Th>Meaning</Th><Th>What happens next</Th></tr>}>
          {outcomes.map((o) => (
            <tr key={o.code}>
              <Td className="font-mono text-sm font-bold text-slate-900">{o.code}</Td>
              <Td className="whitespace-nowrap font-medium text-slate-800">{o.label}</Td>
              <Td className="text-xs">{CONSEQUENCE[verdictEffect(o.props)]}</Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card id="titles" title="Titles the register refuses" description="A title that only repeats the document type says nothing: the type field already holds it, and nobody can find the document by it. These words, on their own, are refused — write what it shows, and of what.">
        <p className="flex flex-wrap gap-1.5">
          {EMPTY_TITLE_WORDS.map((w) => <span key={w} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{w}</span>)}
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Refused: <span className="line-through">Drawing</span> · <span className="line-through">Report</span>.
          Accepted: <strong>Feed pump P-101 general arrangement</strong> · <strong>Cable schedule, substation B</strong>.
        </p>
      </Card>

      <Card id="advice" title="3b · Review advice — what an earlier step says" description="Every step of a route except the last gives advice, and an adviser is never asked to choose it: it is read off the comments they wrote. No comment means nothing to say; a comment marked as stopping the release means that must be settled first. The decider reads it and is not bound by it — except that a blocking comment still stops the release until it is settled.">
        <DataTable id="codes-advice" toolbar={false} head={<tr><Th>Advice</Th><Th>What the adviser did</Th></tr>}>
          {(advice.length ? advice.map((a) => ({ code: a.code, label: a.label, meaning: typeof a.props.meaning === "string" ? a.props.meaning : ADVICE_MEANING[a.code] ?? "—" }))
            : ADVICE_CODES.map((code) => ({ code, label: ADVICE_LABEL[code], meaning: ADVICE_MEANING[code] }))).map((a) => (
            <tr key={a.code}>
              <Td className="whitespace-nowrap font-medium text-slate-800">{a.label}</Td>
              <Td className="text-xs">{a.meaning}</Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card id="comments" title="3c · Comment classes — which comments stop release" description="Every comment is one of two things. This is a separate list from verdicts and advice: a comment says what is wrong, a verdict says what happens to the revision. If they disagree, the comment wins — a revision with an open blocking comment cannot be released, so the decider either settles it, with a reason, or sends the revision back.">
        <DataTable id="codes-comment-classes" toolbar={false} head={<tr><Th>Class</Th><Th>What it means</Th></tr>}>
          {commentClasses.map((c) => (
            <tr key={c.code}>
              <Td className="whitespace-nowrap font-medium text-slate-800">{c.label}</Td>
              <Td className="text-xs">{typeof c.props.meaning === "string" ? c.props.meaning : c.props.progressionPreventing === true ? "Must be settled before release." : "Recorded, and answered in the next revision."}</Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card
        id="status"
        title="4 · Released for — what a released revision may be used for"
        description="What the revision is issued for. Every step of a review route sets it or confirms it, and the last step’s answer stands. It is in force only once Document Control releases the revision: until then the revision reads Not released. It is printed on the document and on the transmittal, and a transmittal sent for execution only accepts codes that allow work."
      >
        <DataTable id="codes-statuses" toolbar={false} head={<tr><Th>Code</Th><Th>Meaning</Th><Th>Allows work</Th><Th>You may</Th><Th>You may not</Th></tr>}>
          {statuses.map((s) => (
            <tr key={s.code}>
              <Td className="font-mono text-sm font-bold text-slate-900">{s.code}</Td>
              <Td className="whitespace-nowrap font-medium text-slate-800">{s.label}</Td>
              <Td>{s.props.executionFlag ? <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">yes</Chip> : <Chip className="bg-slate-100 text-slate-500 ring-slate-200">no</Chip>}</Td>
              <Td className="text-xs">{text(s.props.may) ?? <span className="text-slate-300">—</span>}</Td>
              <Td className="text-xs">{text(s.props.mayNot) ?? <span className="text-slate-300">—</span>}</Td>
            </tr>
          ))}
        </DataTable>
        <div className="mt-4 rounded-xl bg-tint-soft p-4 text-xs leading-5 text-slate-600">
          <p className="font-semibold text-slate-800">IFC or AFC?</p>
          <p className="mt-1">
            Both let people build. <strong>IFC — Issued for construction</strong> is released by the author&apos;s side for building.{" "}
            <strong>AFC — Approved for construction</strong> says the client or engineer has also approved it, typically after a C1 or C2 verdict.
            Which one a project uses is a contract decision; many use only one of them.
          </p>
        </div>
      </Card>

      <Card id="criticality" title="5 · Criticality — how serious an error would be" description="Set when the document is created. It decides who must approve it, how long it is kept, and the format it is kept in — so it is not a label, it is a consequence.">
        <DataTable id="codes-criticality" toolbar={false} head={<tr><Th>Level</Th><Th>Approved by</Th><Th>Kept for</Th><Th>Format</Th></tr>}>
          {criticalities.map((item) => (
            <tr key={item.code}>
              <Td className="whitespace-nowrap font-medium text-slate-800">{item.label}</Td>
              <Td className="text-xs">{typeof item.props.approval === "string" ? String(item.props.approval).toLowerCase() : "\u2014"}</Td>
              <Td className="text-xs">{typeof item.props.retention === "string" ? String(item.props.retention).replaceAll("_", " ").toLowerCase() : "\u2014"}</Td>
              <Td className="text-xs">{typeof item.props.format === "string" ? item.props.format : "\u2014"}</Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card id="confidentiality" title="6 \u00b7 Confidentiality — who may see it" description="Not a warning label. Up to the open levels it is the ordinary register, read by everybody on the project. Above them the document is read by the people named on it — its author, whoever uploaded it, whoever they name, and an administrator — and to everybody else it does not exist: not in the register, not in a count, not in a search.">
        <DataTable id="codes-confidentiality" toolbar={false} head={<tr><Th>Level</Th><Th>Who sees it</Th></tr>}>
          {confidentialities.map((item) => (
            <tr key={item.code}>
              <Td className="whitespace-nowrap font-medium text-slate-800">{item.label}</Td>
              <Td className="text-xs">{item.props.default === true ? "The level a new document takes unless someone chooses another." : "Everybody on the project, up to this level; above it, the people named on the document."}</Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card title="Who decides these lists">
        <div className="space-y-2 text-sm leading-6 text-slate-600">
          <p>
            <strong className="text-slate-800">Document and revision states are fixed.</strong> They are the rules of control — a released revision can only move forward, and a document that was released can be withdrawn but never cancelled. No organization changes them.
          </p>
          <p>
            <strong className="text-slate-800">The verdict and released-for lists are yours.</strong> There is no single international list. IFI, IFR, IFC, AFC and As-built are common industry practice, but every client and contract words them differently —
            and some use other schemes altogether, such as the S1–S4 / A1–A3 suitability codes of ISO 19650. Your organization publishes its own lists, started from a profile at set-up; every project uses them, and a change goes through the same review and approval as any other controlled setting.
          </p>
          {canEdit ? (
            <p className="flex flex-wrap gap-3 pt-1 text-xs font-semibold">
              <Link href="/settings/config?set=STATUSES" className="text-link hover:underline">Edit status codes →</Link>
              <Link href="/settings/config?set=REVIEW_OUTCOMES" className="text-link hover:underline">Edit review outcomes →</Link>
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function Layer({ n, href, title, about, examples, who, list }: { n: string; href: string; title: string; about: string; examples: string; who: string; list: string }) {
  const fixed = list.startsWith("Fixed");
  return (
    <a href={href} className="group rounded-2xl border border-line bg-surface p-4 shadow-sm transition hover:border-brand-line/40">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Badge n={n} />{title}</p>
      <p className="mt-1 text-xs text-slate-500">of {about}</p>
      <p className="mt-3 font-mono text-[11px] text-slate-700">{examples}</p>
      <dl className="mt-3 space-y-1 text-[11px]">
        <div className="flex gap-1.5"><dt className="w-16 shrink-0 text-slate-400">Decided by</dt><dd className="text-slate-700">{who}</dd></div>
        <div className="flex gap-1.5"><dt className="w-16 shrink-0 text-slate-400">List</dt><dd className={fixed ? "text-slate-700" : "font-semibold text-brand-ink"}>{list}</dd></div>
      </dl>
    </a>
  );
}

function Badge({ n }: { n: string }) {
  return <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-tint text-[10px] font-bold text-brand-ink">{n}</span>;
}

function FlowStep({ n, title, who, body, chips, last }: { n: string; title: string; who: string; body: string; chips: [string, string][]; last?: boolean }) {
  return (
    <li className="relative rounded-xl border border-line bg-slate-50 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Step {n}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{title}</p>
      <p className="text-[11px] font-medium text-brand-ink">{who}</p>
      <p className="mt-1 text-[11px] leading-4 text-slate-500">{body}</p>
      {chips.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.map(([layer, label]) => (
            <span key={label} className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200"><Badge n={layer} />{label}</span>
          ))}
        </div>
      ) : null}
      {!last ? <ArrowRight className="absolute -right-2.5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-slate-300 lg:block" /> : null}
    </li>
  );
}
