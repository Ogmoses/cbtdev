"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import PageLoading from "@/components/layout/PageLoading";
import BroadcastsManager from "@/components/owner/BroadcastsManager";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";
import { roleHome } from "@/lib/roleHome";

/** Platform-owner broadcast composer. Everyone else is sent home (the APIs behind it are owner-only anyway). */
export default function OwnerBroadcastsPage() {
  const router = useRouter();
  const authUser = useAuthUser();

  useEffect(() => {
    if (authUser && authUser.role !== "platform_owner") router.replace(roleHome(authUser.role));
  }, [authUser, router]);

  if (!authUser || authUser.role !== "platform_owner") return <PageLoading />;

  return (
    <DashboardLayout role="platform_owner" pageTitle="Broadcasts" userName={authUser.fullName} onLogout={() => signOutAndRedirect(router)}>
      <BroadcastsManager />
    </DashboardLayout>
  );
}
