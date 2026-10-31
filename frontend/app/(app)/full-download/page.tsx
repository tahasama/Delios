import { Download } from "lucide-react";
import { requireScope } from "@/lib/core/scope";
import { isAdmin, isController } from "@/lib/core/auth";
import { DataTable, Th, Td, ToneChip } from "@/components/ui";
import { fmtDate } from "@/lib/core/utils";
import { fullDownloads, LEVELS, type FullDownloadRow } from "@/lib/documents/full-download";
import { FullDownloadForm } from "./full-download-form";
import { StillMaking } from "./waiting";

export const dynamic = "force-dynamic";
export const metadata = { title: "Full download" };

const STATE: Record<FullDownloadRow["status"], { word: string; tone: "done" | "waiting" | "refused" | "idle" | "moving" }> = {
  QUEUED: { word: "Waiting its turn", tone: "moving" },
  RUNNING: { word: "Being made", tone: "moving" },
  DONE: { word: "Ready", tone: "done" },
  FAILED: { word: "Could not be made", tone: "refused" },
  REPLACED: { word: "Replaced by a newer one", tone: "idle" },
};

function size(bytes: number | null) {
  if (!bytes) return "";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function folders(row: FullDownloadRow) {
  if (row.layout === "FLAT") return "flat";
  if (row.layout === "TREE") return "the package tree";
  return row.levels.map((code) => LEVELS.find((one) => one.code === code)?.label.toLowerCase() ?? code).join(" / ");
}

/**
 * The full download (owner: "the ultimate package that an org may download, having all their files"): every document
 * of a project, or of the organization, at its newest released revision, in one zip filed as the person chooses, with
 * the register, the reviews, the transmittals and the audit trail beside it if wanted. Made in the background; the
 * person is told when it is ready, and only they open it.
 */
export default async function FullDownloadPage() {
  const ctx = await requireScope();
  const admin = isAdmin(ctx.user);
  const may = admin || (ctx.user.isInternal && isController(ctx.user));
  const mine = may ? await fullDownloads() : [];
  const making = mine.some((one) => one.status === "QUEUED" || one.status === "RUNNING");

  return (
    <div className="space-y-4">
      <section className="register register-sheet">
        <div className="px-5 pt-5 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Full download</h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            Every document at its newest released revision, in one zip, filed as you choose: to keep, to hand over at the end of
            a contract, or to read away from DELIOS. Only what you may read goes in it. It is made in the background; you are
            told when it is ready.
          </p>
        </div>
      </section>

      {may ? (
        <section className="register register-sheet register-sheet-open">
          <div className="border-b border-line px-5 py-3 sm:px-6"><p className="text-[13px] font-semibold text-slate-800">What goes in it</p></div>
          <div className="px-5 py-4 sm:px-6">
            <FullDownloadForm project={`${ctx.project.code} · ${ctx.project.name}`} mayTakeOrganization={admin} />
          </div>
        </section>
      ) : (
        <p className="register register-sheet px-5 py-4 text-sm text-slate-600 sm:px-6">
          The control function takes this project&apos;s full download, and an administrator the whole organization&apos;s.
        </p>
      )}

      {mine.length ? (
        <section className="register register-sheet">
          {making ? <StillMaking /> : null}
          <DataTable className="rounded-none border-0 shadow-none" head={<tr><Th>What it takes</Th><Th>Asked</Th><Th>Folders</Th><Th>Where it stands</Th><Th>Size</Th><Th className="w-10"><span className="sr-only">Download</span></Th></tr>}>
            {mine.map((row) => (
              <tr key={row.id}>
                <Td>
                  <span className="font-medium text-slate-800">{row.scope}</span>
                  <span className="block text-[11px] text-slate-500">
                    {row.documents} documents
                    {[row.withRegister && "register", row.withReviews && "reviews", row.withTransmittals && "transmittals", row.withAudit && "audit trail"].filter(Boolean).length
                      ? ` · with ${[row.withRegister && "the register", row.withReviews && "reviews", row.withTransmittals && "transmittals", row.withAudit && "the audit trail"].filter(Boolean).join(", ")}`
                      : ""}
                  </span>
                  {row.leftOut.length ? <span className="block text-[11px] text-amber-800">Left out: {row.leftOut.join("; ")}</span> : null}
                </Td>
                <Td>{fmtDate(row.requestedAt)}</Td>
                <Td>{folders(row)}</Td>
                <Td>
                  <ToneChip tone={STATE[row.status].tone}>{STATE[row.status].word}</ToneChip>
                  {row.status === "FAILED" && row.error ? <span className="mt-0.5 block text-[11px] text-slate-500">Nothing was lost; ask for it again.</span> : null}
                </Td>
                <Td>{row.status === "DONE" ? `${size(row.size)} · ${row.fileCount} files` : ""}</Td>
                <Td className="w-10">
                  {row.status === "DONE" ? (
                    <a href={`/api/full-downloads/${row.id}`} title="Download the zip" aria-label="Download the zip" className="text-slate-500 hover:text-brand-ink">
                      <Download className="h-4 w-4" aria-hidden />
                    </a>
                  ) : null}
                </Td>
              </tr>
            ))}
          </DataTable>
        </section>
      ) : null}
    </div>
  );
}
