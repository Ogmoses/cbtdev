"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import PageLoading from "@/components/layout/PageLoading";
import SupportDesk from "@/components/support/SupportDesk";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";
import { roleHome } from "@/lib/roleHome";

export default function TeacherSupportPage() {
  const router = useRouter();
  const authUser = useAuthUser();

  useEffect(() => {
    if (authUser && authUser.role !== "teacher") router.replace(roleHome(authUser.role));
  }, [authUser, router]);

  if (!authUser || authUser.role !== "teacher") return <PageLoading />;

  return (
    <DashboardLayout role="teacher" pageTitle="Help & Support" userName={authUser.fullName} onLogout={() => signOutAndRedirect(router)}>
      <SupportDesk role="teacher" />
    </DashboardLayout>
  );
}
