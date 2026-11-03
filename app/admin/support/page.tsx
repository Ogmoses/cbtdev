"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import PageLoading from "@/components/layout/PageLoading";
import SupportDesk from "@/components/support/SupportDesk";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";
import { roleHome } from "@/lib/roleHome";

export default function AdminSupportPage() {
  const router = useRouter();
  const authUser = useAuthUser();

  useEffect(() => {
    if (authUser && authUser.role !== "super_admin") router.replace(roleHome(authUser.role));
  }, [authUser, router]);

  if (!authUser || authUser.role !== "super_admin") return <PageLoading />;

  return (
    <DashboardLayout role="super_admin" pageTitle="Help & Support" userName={authUser.fullName} onLogout={() => signOutAndRedirect(router)}>
      <SupportDesk role="super_admin" />
    </DashboardLayout>
  );
}
