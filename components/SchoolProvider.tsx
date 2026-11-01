"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { applyBrandingVars, fetchOwnSchool, type SchoolBranding } from "@/lib/schoolBranding";

interface SchoolContextValue {
  /** The current school's branding, or null while unknown (signed out with no school in the URL, or the platform owner). */
  school: SchoolBranding | null;
  loading: boolean;
  /** Re-reads the signed-in user's school — call after saving school settings so the new logo/colors show instantly. */
  refresh: () => Promise<void>;
}

/** Pages that require a signed-in user. */
const PORTAL_PATH = /^\/(admin|teacher|student|owner|profile)(\/|$)/;

const SchoolContext = createContext<SchoolContextValue>({ school: null, loading: false, refresh: async () => {} });

/**
 * Holds the current tenant's branding and keeps the page's CSS variables in
 * sync with it, so switching school (or saving new colors) restyles the app
 * instantly with no reload.
 *
 * Where the school comes from:
 *  - `initialSchool` from the server: the school in the URL (/s/<code>) on
 *    login pages, or the signed-in user's school in the portals. Rendered
 *    server-side, so there is no flash of default colors.
 *  - once someone is signed in, their own school (RLS guarantees they can
 *    only read their own) — this wins over the URL.
 *  - when they sign out, it falls back to `initialSchool` again.
 */
export function SchoolProvider({ initialSchool = null, children }: { initialSchool?: SchoolBranding | null; children: ReactNode }) {
  const [school, setSchool] = useState<SchoolBranding | null>(initialSchool);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const own = await fetchOwnSchool(createClient());
      setSchool(own ?? initialSchool);
    } finally {
      setLoading(false);
    }
  }, [initialSchool]);

  // The school's login page, for sending people there when they're signed out.
  const schoolRef = useRef(school);
  schoolRef.current = school;

  useEffect(() => {
    const supabase = createClient();
    // Covers a sign-in/out that happens without a full page load.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") void refresh();
      // Signed out while on a signed-in page (their sign-in was ended, e.g. the school was suspended):
      // go to the school's own page instead of leaving a broken screen.
      if (event === "SIGNED_OUT" && PORTAL_PATH.test(window.location.pathname)) {
        const code = schoolRef.current?.code;
        window.location.assign(code ? `/s/${code}` : "/login");
      }
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  // Watch for the school being suspended while someone has a page open. Checks on load, every
  // ~30 seconds while the page is showing, and the moment the tab/app is brought back to the
  // front. On a suspension: sign out and land on the school's page, which says access is paused.
  useEffect(() => {
    const supabase = createClient();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      const { data } = await supabase.auth.getSession();
      if (!data.session) return; // nobody signed in on this page
      const own = await fetchOwnSchool(supabase); // null for the platform owner (no school)
      if (own && own.status !== "active") {
        stopped = true;
        await supabase.auth.signOut();
        window.location.assign(`/s/${own.code}`);
      }
    };
    const schedule = () => {
      timer = setTimeout(async () => {
        await check();
        if (!stopped) schedule();
      }, 30_000 + Math.random() * 5_000); // jitter, so a whole school doesn't ask at the same second
    };
    const onBackInView = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    schedule();
    document.addEventListener("visibilitychange", onBackInView);
    window.addEventListener("focus", onBackInView);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onBackInView);
      window.removeEventListener("focus", onBackInView);
    };
  }, []);

  useEffect(() => {
    if (school) applyBrandingVars(school);
  }, [school]);

  const value = useMemo(() => ({ school, loading, refresh }), [school, loading, refresh]);
  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
}

/** `const { school } = useSchool();` then `school?.name`, `school?.logoUrl`, … */
export function useSchool(): SchoolContextValue {
  return useContext(SchoolContext);
}
