"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import PageLoading from "@/components/layout/PageLoading";
import AuditLogs from "@/components/owner/AuditLogs";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";
import { roleHome } from "@/lib/roleHome";

/** Platform-owner audit trail. Everyone else is sent home (the rows are owner-only in the database anyway). */
export default function OwnerAuditLogsPage() {
  const router = useRouter();
  const authUser = useAuthUser();

  useEffect(() => {
    if (authUser && authUser.role !== "platform_owner") router.replace(roleHome(authUser.role));
  }, [authUser, router]);

  if (!authUser || authUser.role !== "platform_owner") return <PageLoading />;

  return (
    <DashboardLayout role="platform_owner" pageTitle="Audit Logs" userName={authUser.fullName} onLogout={() => signOutAndRedirect(router)}>
      <AuditLogs />
    </DashboardLayout>
  );
}
