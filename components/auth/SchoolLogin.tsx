"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { createClient } from "@/lib/supabase/client";
import { deriveStudentPassword } from "@/lib/studentCredential";
import { roleHome } from "@/lib/roleHome";
import { useSchool } from "@/components/SchoolProvider";
import { fetchOwnSchool } from "@/lib/schoolBranding";

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

  /** A pending or suspended school can't be used — sign straight back out with a clear reason. (The platform owner has no school and passes.) */
  const assertSchoolActive = async () => {
    const own = await fetchOwnSchool(supabase);
    if (own && own.status !== "active") {
      await supabase.auth.signOut();
      throw new Error(own.status === "pending" ? "Your school is still waiting for approval. We'll email you when it's ready." : "This school's access is currently paused. Please contact your administrator.");
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

  const handleStaffLogin = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error("Incorrect email or password.");

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
