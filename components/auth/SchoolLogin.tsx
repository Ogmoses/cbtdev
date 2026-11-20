"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { createClient } from "@/lib/supabase/client";
import { deriveStudentPassword } from "@/lib/studentCredential";
import { roleHome } from "@/lib/roleHome";
import { useSchool } from "@/components/SchoolProvider";
import { fetchOwnSchool } from "@/lib/schoolBranding";
import { schoolLoginProblem } from "@/lib/schoolLoginCheck";

/**
 * The sign-in screen, used by both /login (the original address, which keeps
 * working) and /s/<code> (each school's own link). With a `schoolCode`, a
 * student's ID is looked up only within that school — so two schools can both
 * have a student "001" — and the page shows that school's branding.
 */
const LAST_SCHOOL_KEY = "cbt-last-school-code";

export default function SchoolLogin({ schoolCode }: { schoolCode?: string }) {
  const router = useRouter();
  const supabase = createClient();
  const { school } = useSchool();

  // Remember which school this device signs in to. The plain /login address
  // (old bookmarks, home-screen shortcuts) then sends the person straight to
  // their school's own page instead of a generic screen.
  useEffect(() => {
    try {
      if (schoolCode) {
        window.localStorage.setItem(LAST_SCHOOL_KEY, schoolCode);
      } else {
        const last = window.localStorage.getItem(LAST_SCHOOL_KEY);
        if (last) router.replace(`/s/${last}`);
      }
    } catch {
      // Storage unavailable (private browsing) — the generic login still works.
    }
  }, [schoolCode, router]);

  /**
   * After the password is accepted: on a school's own link the account must belong to THAT school (a teacher or admin of another
   * school is turned away), and the school must be active (pending / suspended can't be used). Either way we sign straight back out
   * with a clear reason. The platform owner has no school and passes. See lib/schoolLoginCheck.ts.
   */
  const assertSchoolActive = async () => {
    const own = await fetchOwnSchool(supabase);
    const problem = schoolLoginProblem(own, schoolCode);
    if (problem) {
      await supabase.auth.signOut();
      throw new Error(problem);
    }
  };

  /** Tells the owner's live feed that someone signed in (school + role only; never blocks the sign-in). */
  const trackLogin = () => {
    fetch("/api/auth/track-login", { method: "POST", keepalive: true }).catch(() => {});
  };

  const handleStudentLogin = async (fullName: string, studentId: string) => {
    // Student IDs aren't emails, and Supabase Auth signs in by email —
    // resolve it server-side first (there's no session yet to query with).
    const res = await fetch("/api/auth/resolve-student-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, schoolCode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "We couldn't find that student ID.");

    const password = deriveStudentPassword(fullName, studentId);
    const { error } = await supabase.auth.signInWithPassword({ email: data.email, password });
    if (error) throw new Error("Your name and student ID didn't match what's on file. Double-check both and try again.");
    await assertSchoolActive();
    trackLogin();
    router.push("/student");
  };

  const handleStaffLogin = async (identifier: string, password: string) => {
    if (identifier.includes("@")) {
      const { error } = await supabase.auth.signInWithPassword({ email: identifier, password });
      if (error) throw new Error("Incorrect email or password.");
    } else {
      // A Teacher ID. It only means something inside one school, so it works from that school's own link; the server checks
      // the ID and password and hands back the session (the teacher's email never reaches this page). See lib/staffIdLogin.ts.
      if (!schoolCode) throw new Error("Teacher ID sign-in works from your school's own sign-in link. Please use that link, or sign in with your email.");
      const res = await fetch("/api/auth/staff-id-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolCode, staffId: identifier, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Incorrect Teacher ID or password.");
      const { error } = await supabase.auth.setSession({ access_token: data.accessToken, refresh_token: data.refreshToken });
      if (error) throw new Error("We couldn't sign you in. Please try again.");
    }

    await assertSchoolActive();
    trackLogin();
    const { data: auth } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("users").select("role").eq("id", auth.user!.id).single();
    router.push(roleHome(profile?.role));
  };

  return (
    <LoginForm
      onStudentLogin={handleStudentLogin}
      onStaffLogin={handleStaffLogin}
      school={schoolCode && school ? { name: school.name, motto: school.motto, logoUrl: school.logoUrl } : undefined}
      showRegisterSchool={!schoolCode}
    />
  );
}
