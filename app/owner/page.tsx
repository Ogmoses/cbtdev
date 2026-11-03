"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import PageLoading from "@/components/layout/PageLoading";
import OwnerSchools from "@/components/owner/OwnerSchools";
import OwnerTelemetry from "@/components/owner/OwnerTelemetry";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";
import { roleHome } from "@/lib/roleHome";

/** Platform-owner console. Everyone else is sent to their own home (the data behind it is owner-only in the database anyway). */
export default function OwnerPage() {
  const router = useRouter();
  const authUser = useAuthUser();

  useEffect(() => {
    if (authUser && authUser.role !== "platform_owner") router.replace(roleHome(authUser.role));
  }, [authUser, router]);

  if (!authUser || authUser.role !== "platform_owner") return <PageLoading />;

  return (
    <DashboardLayout role="platform_owner" pageTitle="Command Center" userName={authUser.fullName} onLogout={() => signOutAndRedirect(router)}>
      <OwnerTelemetry />
      <OwnerSchools />
    </DashboardLayout>
  );
}
