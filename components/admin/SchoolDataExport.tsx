"use client";

import { Download } from "lucide-react";
import SchoolExports from "@/components/exports/SchoolExports";

/** Settings section: a school admin downloads a copy of their own school's data. */
export default function SchoolDataExport() {
  return (
    <section className="rounded-lg bg-white p-4 shadow-card dark:bg-[#1A1C20]">
      <p className="mb-1 flex items-center gap-2 font-display text-[14.5px] font-semibold text-ink dark:text-white">
        <Download size={16} /> Export your school's data
      </p>
      <p className="mb-3 text-[12.5px] text-ink/55 dark:text-white/55">
        Keep your own copy of your students, staff, exams and results. The file contains personal information, so store it safely.
      </p>
      <SchoolExports mode="admin" compact />
    </section>
  );
}
