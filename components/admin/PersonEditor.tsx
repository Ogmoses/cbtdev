"use client";

/**
 * PersonEditor — create/edit one student or teacher account.
 * Mount with `key={initial?.id ?? "new"}` so fields reset per person.
 */

import { useState } from "react";
import { X, Loader2, Plus, Trash2 } from "lucide-react";
import type { PersonRole, PersonRow, TeacherAssignment } from "./types";
import { useSchoolProfile, schoolAcronym, schoolSlug } from "@/lib/useSchoolProfile";
import StudentPhotoField from "./StudentPhotoField";

interface PersonEditorProps {
  role: PersonRole;
  initial?: PersonRow | null;
  classOptions: { id: string; name: string }[];
  subjectOptions: { id: string; name: string }[];
  onSave: (person: Omit<PersonRow, "id" | "isActive" | "subjectNames"> & { id?: string }) => Promise<{ credential?: string } | void>;
  onCancel: () => void;
}

export default function PersonEditor({ role, initial, classOptions, subjectOptions, onSave, onCancel }: PersonEditorProps) {
  const school = useSchoolProfile();
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [admissionNumber, setAdmissionNumber] = useState(initial?.admissionNumber ?? "");
  const [staffId, setStaffId] = useState(initial?.staffId ?? "");
  const [classId, setClassId] = useState(initial?.classId ?? classOptions[0]?.id ?? "");
  const [assignments, setAssignments] = useState<TeacherAssignment[]>(initial?.assignments ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const addAssignment = () =>
    setAssignments((prev) => [...prev, { subjectId: subjectOptions[0]?.id ?? "", classId: classOptions[0]?.id ?? "" }]);
  const updateAssignment = (i: number, patch: Partial<TeacherAssignment>) =>
    setAssignments((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  const removeAssignment = (i: number) => setAssignments((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    if (!fullName.trim()) {
      setError("Name is required.");
      return;
    }
    if (role !== "student" && !email.trim()) {
      setError("Email is required.");
      return;
    }
    if (role === "student" && !admissionNumber.trim()) {
      setError("Add a student ID.");
      return;
    }
    if (role === "teacher" && !staffId.trim()) {
      setError("Add a staff ID.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({
        id: initial?.id,
        role,
        fullName: fullName.trim(),
        email: role === "student" ? undefined : email.trim(),
        admissionNumber: role === "student" ? admissionNumber.trim() : undefined,
        staffId: role === "teacher" ? staffId.trim() : undefined,
        classId: role === "student" ? classId : undefined,
        assignments: role === "teacher" ? assignments.filter((a) => a.subjectId && a.classId) : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this account. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white dark:bg-[#1A1C20] shadow-card-hover">
        <div className="flex items-center justify-between border-b border-black/5 dark:border-white/10 px-5 py-4">
          <h2 className="font-display text-[15px] font-semibold text-ink dark:text-white">
            {initial ? "Edit" : "New"} {role === "student" ? "student" : "teacher"}
          </h2>
          <button onClick={onCancel} className="rounded-md p-1.5 text-ink/40 dark:text-white/40 hover:bg-background-muted dark:hover:bg-white/5">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          <Field label="Full name" value={fullName} onChange={setFullName} placeholder="e.g. Chidinma Okafor" />
          {role !== "student" && (
            <Field label="Email" value={email} onChange={setEmail} placeholder={`name@${schoolSlug(school.name)}.edu`} type="email" />
          )}

          {role === "student" ? (
            <>
              <Field label="Student ID" value={admissionNumber} onChange={setAdmissionNumber} placeholder={`e.g. ${schoolAcronym(school.name)}/${new Date().getFullYear()}/0142`} />
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">Class</span>
                <select
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  className="w-full rounded-lg border border-black/10 dark:border-white/15 px-3 py-2.5 text-[13px] outline-none focus:border-crimson-500"
                >
                  {classOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <StudentPhotoField studentId={initial?.id} />
            </>
          ) : (
            <>
              <Field label="Staff ID" value={staffId} onChange={setStaffId} placeholder={`e.g. ${schoolAcronym(school.name)}-T-014`} />
              <div>
                <span className="mb-1.5 block text-[12px] font-medium text-ink/60 dark:text-white/60">Teaches — subject &amp; class</span>
                <div className="space-y-2">
                  {assignments.map((a, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        value={a.subjectId}
                        onChange={(e) => updateAssignment(i, { subjectId: e.target.value })}
                        className="min-w-0 flex-1 rounded-lg border border-black/10 dark:border-white/15 px-2.5 py-2 text-[12.5px] outline-none focus:border-crimson-500"
                      >
                        {subjectOptions.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <select
                        value={a.classId}
                        onChange={(e) => updateAssignment(i, { classId: e.target.value })}
                        className="min-w-0 flex-1 rounded-lg border border-black/10 dark:border-white/15 px-2.5 py-2 text-[12.5px] outline-none focus:border-crimson-500"
                      >
                        {classOptions.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <button onClick={() => removeAssignment(i)} className="shrink-0 rounded-md p-2 text-ink/30 dark:text-white/30 hover:bg-crimson-50 dark:hover:bg-crimson-600/15 hover:text-crimson-700 dark:hover:text-crimson-500">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addAssignment}
                  disabled={subjectOptions.length === 0 || classOptions.length === 0}
                  className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-crimson-700 dark:text-crimson-500 hover:text-crimson-800 disabled:opacity-40"
                >
                  <Plus size={13} /> Add subject &amp; class
                </button>
              </div>
            </>
          )}

          {error && <p className="rounded-md bg-crimson-50 dark:bg-crimson-600/15 px-3 py-2 text-[12.5px] text-crimson-700 dark:text-crimson-500">{error}</p>}
        </div>

        <div className="flex gap-2.5 border-t border-black/5 dark:border-white/10 px-5 py-4">
          <button
            onClick={onCancel}
            disabled={saving}
            className="flex-1 rounded-lg border border-black/10 dark:border-white/15 py-2.5 text-[13px] font-medium text-ink/70 dark:text-white/70 hover:bg-background-muted dark:hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-crimson-600 py-2.5 text-[13px] font-semibold text-on-crimson hover:bg-crimson-700 disabled:opacity-70"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Saving…" : "Save account"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-black/10 dark:border-white/15 px-3.5 py-2.5 text-[13px] outline-none focus:border-crimson-500"
      />
    </label>
  );
}
