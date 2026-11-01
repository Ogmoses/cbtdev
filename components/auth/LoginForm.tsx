"use client";

/**
 * Login
 *
 * Students authenticate with just their full name and student ID — no
 * separate password to remember or lose (fast entry on shared lab
 * computers, and nothing for a young student to forget). Teachers/Admins
 * authenticate with Email + Password via Supabase Auth. Wire
 * `onStudentLogin` / `onStaffLogin` to your auth calls — this component
 * only owns form state and validation.
 */

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Waves, Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { useSchoolProfile, schoolAcronym, schoolSlug } from "@/lib/useSchoolProfile";

type Mode = "student" | "staff";

interface LoginFormProps {
  onStudentLogin: (fullName: string, studentId: string) => Promise<void>;
  onStaffLogin: (email: string, password: string) => Promise<void>;
  /** Branding to show instead of the default school's — used by each school's own /s/<code> page. */
  school?: { name: string; motto: string | null; logoUrl: string | null };
  /** Show a "Register your school" link (only on the generic, school-less login). */
  showRegisterSchool?: boolean;
}

export default function LoginForm({ onStudentLogin, onStaffLogin, school: schoolOverride, showRegisterSchool }: LoginFormProps) {
  const defaultSchool = useSchoolProfile();
  const school = schoolOverride ?? defaultSchool;
  const [mode, setMode] = useState<Mode>("student");
  const [studentName, setStudentName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "student") {
        if (!studentName.trim() || !studentId.trim()) {
          setError("Enter your full name and student ID.");
          return;
        }
        await onStudentLogin(studentName.trim(), studentId.trim());
      } else {
        if (!email.trim() || !password.trim()) {
          setError("Enter your email and password.");
          return;
        }
        await onStaffLogin(email.trim(), password.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in. Check your details and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-100 dark:bg-[#101114] px-4 font-sans">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-sm rounded-lg bg-white dark:bg-[#1A1C20] p-7 shadow-card-hover sm:p-8"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          {school.logoUrl ? (
            <img src={school.logoUrl} alt="" className="mb-3 h-11 w-11 rounded-lg object-cover" />
          ) : (
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-crimson-600 text-on-crimson">
              <Waves size={22} strokeWidth={2.25} />
            </div>
          )}
          <h1 className="font-display text-[17px] font-semibold text-ink dark:text-white">{school.name}</h1>
          <p className="text-[12.5px] text-ink/50 dark:text-white/50">{school.motto ? school.motto : "CBT Portal"}</p>
        </div>

        {/* Mode toggle */}
        <div className="mb-5 grid grid-cols-2 rounded-lg bg-background-muted dark:bg-white/5 p-1">
          {(["student", "staff"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`rounded-md py-2 text-[12.5px] font-semibold capitalize transition-colors duration-200 ${
                mode === m ? "bg-white dark:bg-[#1A1C20] text-crimson-700 dark:text-crimson-500 shadow-card" : "text-ink/50 dark:text-white/50"
              }`}
            >
              {m === "student" ? "Student" : "Teacher / Admin"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === "student" ? (
            <>
              <Field label="Full name" value={studentName} onChange={setStudentName} placeholder="e.g. Chidinma Okafor" autoFocus />
              <Field label="Student ID" value={studentId} onChange={setStudentId} placeholder={`e.g. ${schoolAcronym(school.name)}/${new Date().getFullYear()}/0142`} />
            </>
          ) : (
            <>
              <Field label="Email" value={email} onChange={setEmail} placeholder={`you@${schoolSlug(school.name)}.edu`} type="email" autoFocus />
              <Field
                label="Password"
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                type={showSecret ? "text" : "password"}
                trailingIcon={
                  <button type="button" onClick={() => setShowSecret((v) => !v)} className="text-ink/40 dark:text-white/40 hover:text-ink/60 dark:hover:text-white/60">
                    {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                }
              />
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-crimson-50 dark:bg-crimson-600/15 px-3 py-2.5 text-[12.5px] text-crimson-700 dark:text-crimson-500">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-crimson-600 py-3 text-[13.5px] font-semibold text-on-crimson transition-colors duration-200 hover:bg-crimson-700 disabled:opacity-70"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {mode === "student" && (
          <p className="mt-4 text-center text-[11.5px] text-ink/45 dark:text-white/45">
            Not sure of your student ID? Ask your class teacher.
          </p>
        )}
        {showRegisterSchool && (
          <p className="mt-3 text-center text-[11.5px] text-ink/45 dark:text-white/45">
            Running a school?{" "}
            <Link href="/register-school" className="font-medium text-crimson-600 hover:underline">
              Register it here
            </Link>
          </p>
        )}
      </motion.div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
  inputMode,
  trailingIcon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
  inputMode?: "text" | "numeric";
  trailingIcon?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink/60 dark:text-white/60">{label}</span>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          inputMode={inputMode}
          className="w-full rounded-lg border border-black/10 bg-white text-ink placeholder:text-ink/35 dark:border-white/15 dark:bg-white/5 dark:text-white dark:placeholder:text-white/35 px-3.5 py-2.5 text-[13.5px] outline-none transition-shadow duration-200 focus:border-crimson-500 focus:shadow-focus"
        />
        {trailingIcon && <div className="absolute right-3 top-1/2 -translate-y-1/2">{trailingIcon}</div>}
      </div>
    </label>
  );
}
