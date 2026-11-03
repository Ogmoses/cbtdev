"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import PageLoading from "@/components/layout/PageLoading";
import SupportInbox from "@/components/owner/SupportInbox";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";
import { roleHome } from "@/lib/roleHome";

export default function OwnerSupportPage() {
  const router = useRouter();
  const authUser = useAuthUser();

  useEffect(() => {
    if (authUser && authUser.role !== "platform_owner") router.replace(roleHome(authUser.role));
  }, [authUser, router]);

  if (!authUser || authUser.role !== "platform_owner") return <PageLoading />;

  return (
    <DashboardLayout role="platform_owner" pageTitle="Support" userName={authUser.fullName} onLogout={() => signOutAndRedirect(router)}>
      <SupportInbox />
    </DashboardLayout>
  );
}
