"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import SettingsManager from "@/components/admin/SettingsManager";
import SchoolDataExport from "@/components/admin/SchoolDataExport";
import { createClient } from "@/lib/supabase/client";
import { orThrow } from "@/lib/supabaseErrors";
import { fetchOwnSchool } from "@/lib/schoolBranding";
import { useSchool } from "@/components/SchoolProvider";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";
import type { GradeBand, SchoolProfile } from "@/components/admin/types";
import { DEFAULT_THEME_COLOR } from "@/lib/themes";
import PageLoading from "@/components/layout/PageLoading";

const EMPTY_PROFILE: SchoolProfile = { schoolName: "", motto: "", address: "", logoUrl: null, themeColor: DEFAULT_THEME_COLOR };

export default function AdminSettingsPage() {
  const router = useRouter();
  const authUser = useAuthUser();
  const supabase = createClient();

  const { refresh: refreshSchool } = useSchool();
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [profile, setProfile] = useState<SchoolProfile>(EMPTY_PROFILE);
  const [scale, setScale] = useState<GradeBand[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    const [own, { data: scaleRows }] = await Promise.all([
      fetchOwnSchool(supabase),
      supabase.from("grading_scale").select("id, min_score, max_score, grade_letter, remark").order("min_score", { ascending: false }),
    ]);

    if (own) {
      setSchoolId(own.id);
      setProfile({
        schoolName: own.name,
        motto: own.motto ?? "",
        address: own.address ?? "",
        logoUrl: own.logoUrl,
        themeColor: own.themeColor || DEFAULT_THEME_COLOR,
        secondaryColor: own.secondaryColor,
      });
    }
    setScale((scaleRows ?? []).map((r) => ({ id: r.id, minScore: r.min_score, maxScore: r.max_score, gradeLetter: r.grade_letter, remark: r.remark ?? "" })));
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveProfile = async (p: SchoolProfile) => {
    await updateSchool({ name: p.schoolName, motto: p.motto || null, address: p.address || null, logo_url: p.logoUrl });
  };

  /** Saves branding on THIS admin's own school row (the database only allows these columns, on their own school), then refreshes the sidebar/headers. */
  const updateSchool = async (patch: Record<string, unknown>) => {
    if (!schoolId) throw new Error("Couldn't tell which school this is. Reload and try again.");
    const { data, error } = await supabase.from("schools").update(patch).eq("id", schoolId).select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("Couldn't save — you may not have permission, or the school isn't active.");
    await loadAll();
    await refreshSchool();
  };

  const handleSaveTheme = async (themeColor: string) => {
    await updateSchool({ theme_color: themeColor });
  };

  const handleSaveSurface = async (secondaryColor: string) => {
    await updateSchool({ secondary_color: secondaryColor });
  };

  const handleSaveGradingScale = async (bands: GradeBand[]) => {
    // Small table, rewritten wholesale each save — simpler and safer than
    // diffing client-generated temp ids against real DB rows.
    await orThrow(supabase.from("grading_scale").delete().gte("min_score", -999999));
    if (bands.length > 0) {
      await orThrow(supabase.from("grading_scale").insert(bands.map((b) => ({ min_score: b.minScore, max_score: b.maxScore, grade_letter: b.gradeLetter, remark: b.remark || null }))));
    }
    await loadAll();
  };

  return (
    <DashboardLayout role="super_admin" pageTitle="Settings" userName={authUser?.fullName ?? ""} onLogout={() => signOutAndRedirect(router)}>
      {loading ? <PageLoading /> : (
        <>
          <SettingsManager profile={profile} gradingScale={scale} onSaveProfile={handleSaveProfile} onSaveGradingScale={handleSaveGradingScale} onSaveTheme={handleSaveTheme}
          onSaveSurface={handleSaveSurface} />
          <div className="mt-6">
            <SchoolDataExport />
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
