"use client";

import { Download, X } from "lucide-react";
import SchoolExports from "@/components/exports/SchoolExports";

/** The owner's "Export data" window for one school. */
export default function SchoolExportModal({ school, onClose }: { school: { school_id: string; name: string }; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-card-hover dark:bg-[#1A1C20] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background-muted text-ink/70 dark:bg-white/10 dark:text-white/70">
              <Download size={18} />
            </span>
            <h3 className="font-display text-[16px] font-semibold text-ink dark:text-white">Export {school.name}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink/40 hover:text-ink dark:text-white/40">
            <X size={18} />
          </button>
        </div>
        <SchoolExports mode="owner" schoolId={school.school_id} />
      </div>
    </div>
  );
}
