"use client";

/**
 * BulkImportModal — upload a CSV of students or teachers, see per-row
 * validation before anything is written, then import only the valid rows.
 *
 * Expected columns (header row, any order):
 *   students → full_name, student_id, class   (admission_number also accepted; no email needed — students log in with name + student ID)
 *   teachers → full_name, email, staff_id, subjects   (subjects: "Math;English")
 */

import { useMemo, useState } from "react";
import { Upload, Download, CheckCircle2, XCircle, Loader2, X } from "lucide-react";
import { parseCSVToObjects } from "./csv";
import type { PersonRole } from "./types";
import { useSchoolProfile, schoolAcronym } from "@/lib/useSchoolProfile";

export interface ImportRow {
  fullName: string;
  email?: string;
  admissionNumber?: string;
  staffId?: string;
  classId?: string;
  subjectNames?: string[];
}

/** Per-row result of one import attempt, in the same order as the rows that were sent. */
export interface BulkImportOutcome {
  results: { ok: boolean; error?: string }[];
}

interface FailedRow {
  row: ImportRow;
  label: string; // who it was — name plus ID/email
  reason: string;
}

/** Turns raw auth/database errors into something an admin can act on. */
function friendlyImportError(raw: string | undefined, role: PersonRole): string {
  const msg = (raw ?? "").toLowerCase();
  if (msg.includes("already") || msg.includes("duplicate") || msg.includes("exists") || msg.includes("unique")) {
    return role === "student" ? "That student ID already exists." : "That email or staff ID already exists.";
  }
  if (msg.includes("smtp") || msg.includes("mail") || msg.includes("invite")) return `Couldn't send the invite email (${raw}).`;
  return raw || "Unknown error.";
}

interface ParsedRow {
  raw: Record<string, string>;
  data: ImportRow | null;
  error: string | null;
}

interface BulkImportModalProps {
  role: PersonRole;
  classOptions: { id: string; name: string }[];
  subjectOptions: string[];
  onImport: (rows: ImportRow[]) => Promise<BulkImportOutcome | void>;
  onClose: () => void;
}

export default function BulkImportModal({ role, classOptions, subjectOptions, onImport, onClose }: BulkImportModalProps) {
  const school = useSchoolProfile();
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once an import attempt has run and some rows were rejected by the
  // server. Rows that went through are never resent — retry only targets
  // `failed`, so nobody gets duplicated or double-invited.
  const [failed, setFailed] = useState<FailedRow[] | null>(null);
  const [importedTotal, setImportedTotal] = useState(0);

  const validRows = useMemo(() => (parsed ?? []).filter((r) => r.data).map((r) => r.data!), [parsed]);
  const invalidCount = (parsed?.length ?? 0) - validRows.length;

  const validateRow = (raw: Record<string, string>): ParsedRow => {
    const fullName = raw["full_name"] ?? raw["name"] ?? "";
    const email = raw["email"] ?? "";
    if (!fullName.trim()) return { raw, data: null, error: "Missing full_name" };

    if (role === "student") {
      const admissionNumber = raw["student_id"] ?? raw["student id"] ?? raw["admission_number"] ?? raw["admission number"] ?? "";
      const className = raw["class"] ?? "";
      if (!admissionNumber.trim()) return { raw, data: null, error: "Missing student_id" };
      const matchedClass = classOptions.find((c) => c.name.toLowerCase() === className.trim().toLowerCase());
      if (!matchedClass) return { raw, data: null, error: `Unrecognized class "${className}"` };
      return { raw, data: { fullName, admissionNumber, classId: matchedClass.id }, error: null };
    }

    if (!email.trim() || !email.includes("@")) return { raw, data: null, error: "Missing or invalid email" };
    const staffId = raw["staff_id"] ?? raw["staff id"] ?? "";
    if (!staffId.trim()) return { raw, data: null, error: "Missing staff_id" };
    const subjectNames = (raw["subjects"] ?? "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    const unknown = subjectNames.filter((s) => !subjectOptions.some((o) => o.toLowerCase() === s.toLowerCase()));
    if (unknown.length > 0) return { raw, data: null, error: `Unrecognized subject(s): ${unknown.join(", ")}` };
    return { raw, data: { fullName, email, staffId, subjectNames }, error: null };
  };

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const objects = parseCSVToObjects(text);
      if (objects.length === 0) {
        setError("That file has no data rows.");
        return;
      }
      setParsed(objects.map(validateRow));
    } catch {
      setError("Couldn't read that file. Make sure it's a plain .csv export.");
    }
  };

  const downloadTemplate = () => {
    const header = role === "student" ? "full_name,student_id,class" : "full_name,email,staff_id,subjects";
    const example =
      role === "student"
        ? `Chidinma Okafor,${schoolAcronym(school.name)}/${new Date().getFullYear()}/0201,JSS1`
        : `Mrs. Adeyemi,adeyemi@example.com,${schoolAcronym(school.name)}-T-014,Mathematics;Further Mathematics`;
    const blob = new Blob([`${header}\n${example}\n`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${role}_import_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rowLabel = (row: ImportRow) => {
    const id = role === "student" ? row.admissionNumber : row.email;
    return id ? `${row.fullName} (${id})` : row.fullName;
  };

  const runImport = async (rows: ImportRow[]) => {
    setImporting(true);
    setError(null);
    try {
      const outcome = await onImport(rows);
      const results = outcome?.results;
      if (!results) {
        onClose();
        return;
      }
      const stillFailed: FailedRow[] = [];
      let okCount = 0;
      rows.forEach((row, i) => {
        const r = results[i];
        if (r?.ok) okCount += 1;
        else stillFailed.push({ row, label: rowLabel(row), reason: friendlyImportError(r?.error, role) });
      });
      setImportedTotal((n) => n + okCount);
      if (stillFailed.length === 0) {
        onClose();
        return;
      }
      setFailed(stillFailed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed partway through. Check for duplicates and try again.");
    } finally {
      setImporting(false);
    }
  };

  const handleConfirm = () => runImport(failed ? failed.map((f) => f.row) : validRows);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-white dark:bg-[#1A1C20] shadow-card-hover">
        <div className="flex items-center justify-between border-b border-black/5 dark:border-white/10 px-5 py-4">
          <h2 className="font-display text-[15px] font-semibold text-ink dark:text-white">Bulk import {role === "student" ? "students" : "teachers"}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-ink/40 dark:text-white/40 hover:bg-background-muted dark:hover:bg-white/5">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {failed ? (
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-success">
                <CheckCircle2 size={15} /> {importedTotal} imported
              </p>
              <p className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-crimson-600">
                <XCircle size={15} /> {failed.length} didn't go through
              </p>
              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {failed.map((f, i) => (
                  <div key={i} className="rounded-md bg-crimson-50 px-3 py-2 text-[12.5px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">
                    <p className="font-medium">{f.label}</p>
                    <p className="text-[11.5px] opacity-80">{f.reason}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[12px] text-ink/50 dark:text-white/50">
                Fix the cause (or fix the CSV and re-upload just these rows), then retry. Rows that already imported won't be sent again.
              </p>
              {error && <p className="mt-3 rounded-md bg-crimson-50 px-3 py-2 text-[12.5px] text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500">{error}</p>}
            </div>
          ) : !parsed ? (
            <div className="space-y-3.5">
              <p className="text-[13px] text-ink/60 dark:text-white/60">
                Upload a CSV with columns {role === "student" ? "full_name, student_id, class" : "full_name, email, staff_id, subjects"}.
              </p>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-black/15 dark:border-white/20 px-4 py-8 text-center hover:border-black/25">
                <Upload size={22} className="text-ink/35 dark:text-white/35" />
                <span className="text-[13px] font-medium text-ink/60 dark:text-white/60">Choose a .csv file</span>
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              </label>
              <button onClick={downloadTemplate} className="flex items-center gap-1.5 text-[12.5px] font-medium text-crimson-700 dark:text-crimson-500 hover:text-crimson-800">
                <Download size={13} /> Download a template
              </button>
              {error && <p className="rounded-md bg-crimson-50 dark:bg-crimson-600/15 px-3 py-2 text-[12.5px] text-crimson-700 dark:text-crimson-500">{error}</p>}
            </div>
          ) : (
            <div>
              <div className="mb-3 flex items-center gap-4 text-[13px]">
                <span className="flex items-center gap-1.5 font-medium text-success">
                  <CheckCircle2 size={15} /> {validRows.length} ready to import
                </span>
                {invalidCount > 0 && (
                  <span className="flex items-center gap-1.5 font-medium text-crimson-600">
                    <XCircle size={15} /> {invalidCount} with errors
                  </span>
                )}
              </div>
              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {parsed.map((row, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[12.5px] ${
                      row.data ? "bg-background-muted dark:bg-white/5 text-ink/70 dark:text-white/70" : "bg-crimson-50 dark:bg-crimson-600/15 text-crimson-700 dark:text-crimson-500"
                    }`}
                  >
                    {row.data ? <CheckCircle2 size={14} className="shrink-0" /> : <XCircle size={14} className="shrink-0" />}
                    <span className="flex-1 truncate">{row.raw["full_name"] || row.raw["name"] || `Row ${i + 1}`}</span>
                    <span className="shrink-0 text-[11.5px] opacity-80">{row.error ?? "OK"}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setParsed(null)} className="mt-3 text-[12.5px] font-medium text-ink/50 dark:text-white/50 hover:text-ink/70 dark:hover:text-white/70">
                Choose a different file
              </button>
              {error && <p className="mt-3 rounded-md bg-crimson-50 dark:bg-crimson-600/15 px-3 py-2 text-[12.5px] text-crimson-700 dark:text-crimson-500">{error}</p>}
            </div>
          )}
        </div>

        <div className="flex gap-2.5 border-t border-black/5 dark:border-white/10 px-5 py-4">
          <button onClick={onClose} disabled={importing} className="flex-1 rounded-lg border border-black/10 dark:border-white/15 py-2.5 text-[13px] font-medium text-ink/70 dark:text-white/70 hover:bg-background-muted dark:hover:bg-white/5 disabled:opacity-50">
            {failed ? "Done" : "Cancel"}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!parsed || (!failed && validRows.length === 0) || importing}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-crimson-600 py-2.5 text-[13px] font-semibold text-on-crimson hover:bg-crimson-700 disabled:opacity-50"
          >
            {importing && <Loader2 size={14} className="animate-spin" />}
            {importing
              ? "Importing…"
              : failed
                ? `Retry ${failed.length} failed`
                : `Import ${validRows.length || ""} ${role === "student" ? "student" : "teacher"}${validRows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
