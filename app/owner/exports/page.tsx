"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import PageLoading from "@/components/layout/PageLoading";
import SchoolExports from "@/components/exports/SchoolExports";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";
import { roleHome } from "@/lib/roleHome";

/** Every data export, including those of schools that have since been deleted. Start a new one from a school's card. */
export default function OwnerExportsPage() {
  const router = useRouter();
  const authUser = useAuthUser();

  useEffect(() => {
    if (authUser && authUser.role !== "platform_owner") router.replace(roleHome(authUser.role));
  }, [authUser, router]);

  if (!authUser || authUser.role !== "platform_owner") return <PageLoading />;

  return (
    <DashboardLayout role="platform_owner" pageTitle="Data Exports" userName={authUser.fullName} onLogout={() => signOutAndRedirect(router)}>
      <div className="space-y-4">
        <p className="text-[13px] text-ink/55 dark:text-white/55">
          Copies of schools' data, kept for 30 days. They stay here even after a school is deleted. To make a new one, use <strong>Export</strong> on the school's card.
        </p>
        <SchoolExports mode="owner" />
      </div>
    </DashboardLayout>
  );
}
