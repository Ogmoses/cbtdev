"use client";

/**
 * ReportCardPrintView — an on-screen preview of the same report card,
 * styled for the browser's native print/"Save as PDF" flow via
 * `@media print`. Use this when a teacher just wants to print one card
 * right now; use ReportCardDocument (react-pdf) + the API route when you
 * need an actual downloadable PDF file (emailing, archiving, batch export).
 */

import { Printer, Download } from "lucide-react";
import type { ReportCardData } from "./types";
import { formatScore } from "@/lib/scoreFormat";

interface ReportCardPrintViewProps {
  data: ReportCardData;
  /** Link to the PDF API route, e.g. /api/report-cards/{studentId}/{termId} */
  pdfUrl?: string;
}

export default function ReportCardPrintView({ data, pdfUrl }: ReportCardPrintViewProps) {
  return (
    <div className="min-h-screen bg-background-muted py-8 print:bg-white print:py-0">
      {/* Print-only page rules — @page can't be expressed as a Tailwind
          utility, so it's the one bit of raw CSS on this page. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      {/* Toolbar — hidden when printing */}
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-end gap-2 px-4 print:hidden">
        {pdfUrl && (
          <a href={pdfUrl} download className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3.5 py-2 text-[13px] font-medium text-ink/70 hover:bg-background-muted">
            <Download size={15} /> Download PDF
          </a>
        )}
        <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-crimson-600 px-3.5 py-2 text-[13px] font-semibold text-on-crimson hover:bg-crimson-700">
          <Printer size={15} /> Print
        </button>
      </div>

      {/* The card itself */}
      <div className="mx-auto max-w-3xl rounded-lg bg-white p-8 text-ink shadow-card print:rounded-none print:p-0 print:shadow-none">
        {/* Letterhead */}
        <div className="flex items-center gap-3 border-b-2 border-crimson-600 pb-4">
          {data.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.logoUrl} alt="School logo" className="h-12 w-12 object-contain" />
          ) : (
            <div className="h-12 w-12 rounded bg-cream-100" />
          )}
          <div>
            <p className="font-display text-[17px] font-bold text-crimson-600">{data.schoolName}</p>
            {data.schoolMotto && <p className="text-[11px] text-ink/50">{data.schoolMotto}</p>}
            {data.schoolAddress && <p className="text-[10px] text-ink/40">{data.schoolAddress}</p>}
          </div>
        </div>

        <div className="mt-4 text-center">
          <p className="text-[13px] font-bold tracking-wide text-ink">TERMINAL REPORT CARD</p>
          <p className="mt-0.5 text-[12px] text-ink/50">{data.termName} · {data.sessionName}</p>
        </div>

        {/* Student info + photo */}
        <div className="mt-5 flex items-start justify-between gap-4">
          <dl className="space-y-1.5 text-[12.5px]">
            <InfoRow label="Student name" value={data.studentName} />
            <InfoRow label="Student ID" value={data.admissionNumber} />
            <InfoRow label="Class" value={data.className} />
            <InfoRow label="Position in class" value={`${data.positionInClass} of ${data.classSize}`} />
          </dl>
          {data.studentPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.studentPhotoUrl} alt={data.studentName} className="h-20 w-16 rounded border border-black/10 object-cover" />
          ) : (
            <div className="flex h-20 w-16 items-center justify-center rounded border border-dashed border-black/15 text-[9px] text-ink/40">Photo</div>
          )}
        </div>

        {/* Subject breakdown */}
        <table className="mt-5 w-full border-collapse overflow-hidden rounded-lg border border-black/10 text-[11.5px]">
          <thead>
            <tr className="bg-cream-100 text-[10px] uppercase tracking-wide text-ink/50">
              <th className="px-3 py-2 text-left font-semibold">Subject</th>
              <th className="px-3 py-2 text-center font-semibold">CA/CBT</th>
              <th className="px-3 py-2 text-center font-semibold">Terminal</th>
              <th className="px-3 py-2 text-center font-semibold">Total</th>
              <th className="px-3 py-2 text-center font-semibold">Grade</th>
              <th className="px-3 py-2 text-left font-semibold">Remark</th>
            </tr>
          </thead>
          <tbody>
            {data.subjects.map((s, i) => (
              <tr key={i} className="border-t border-black/5">
                <td className="px-3 py-2 font-medium text-ink">{s.subjectName}</td>
                <td className="px-3 py-2 text-center tabular-nums text-ink">{formatScore(s.caScore)}</td>
                <td className="px-3 py-2 text-center tabular-nums text-ink">{formatScore(s.terminalScore)}</td>
                <td className="px-3 py-2 text-center tabular-nums font-medium text-ink">{formatScore(s.totalScore)}/{s.maxScore}</td>
                <td className="px-3 py-2 text-center font-bold text-crimson-700">{s.gradeLetter ?? "—"}</td>
                <td className="px-3 py-2 text-ink/50">{s.remark ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Summary */}
        <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg bg-cream-100 p-3.5 text-center">
          <SummaryStat value={`${data.overallTotal.toFixed(1)}/${data.overallMaxTotal}`} label="Overall score" />
          <SummaryStat value={data.overallGradeLetter ?? "—"} label="Overall grade" />
          <SummaryStat value={`${data.positionInClass}/${data.classSize}`} label="Class position" />
        </div>

        {/* Teacher comment */}
        <div className="mt-4 rounded-lg border border-black/10 p-3.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink/40">Class teacher's comment</p>
          <p className="min-h-[2.5em] text-[12.5px] text-ink">{data.teacherComment}</p>
        </div>

        {/* Signatures */}
        <div className="mt-8 flex justify-between">
          <div className="w-[42%] border-t border-ink pt-1.5 text-center text-[11px] text-ink/50">Class Teacher</div>
          <div className="w-[42%] text-center">
            <div className="mx-auto mb-1.5 h-10 w-16 rounded border border-dashed border-black/15" />
            <div className="border-t border-ink pt-1.5 text-[11px] text-ink/50">{data.principalName ? `${data.principalName} — Principal` : "Principal"}</div>
          </div>
        </div>

        <p className="mt-6 text-center text-[9px] text-ink/35">
          Generated by the {data.schoolName} CBT Platform · {new Date().toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-ink/45">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

function SummaryStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-display text-[16px] font-bold text-crimson-700">{value}</p>
      <p className="text-[9px] text-ink/45">{label}</p>
    </div>
  );
}
