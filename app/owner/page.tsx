"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layout/DashboardLayout";
import PageLoading from "@/components/layout/PageLoading";
import OwnerSchools from "@/components/owner/OwnerSchools";
import OwnerTelemetry from "@/components/owner/OwnerTelemetry";
import OwnerBilling from "@/components/owner/OwnerBilling";
import { useAuthUser, signOutAndRedirect } from "@/lib/useAuthUser";
import { roleHome } from "@/lib/roleHome";

/** Platform-owner console. Everyone else is sent to their own home (the data behind it is owner-only in the database anyway). */
export default function OwnerPage() {
  const router = useRouter();
  const authUser = useAuthUser();

  useEffect(() => {
    if (authUser && authUser.role !== "platform_owner") router.replace(roleHome(authUser.role));
  }, [authUser, router]);

  // Arriving with #billing / #schools (from the bell on another page): the sections only exist once this page has
  // loaded, so scroll to the one asked for after it appears.
  const ready = !!authUser && authUser.role === "platform_owner";
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    const id = window.location.hash.slice(1);
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!authUser || authUser.role !== "platform_owner") return <PageLoading />;

  return (
    <DashboardLayout role="platform_owner" pageTitle="Command Center" userName={authUser.fullName} onLogout={() => signOutAndRedirect(router)}>
      <OwnerTelemetry />
      <div id="billing" className="scroll-mt-24">
        <OwnerBilling />
      </div>
      <div id="schools" className="scroll-mt-24">
        <OwnerSchools />
      </div>
    </DashboardLayout>
  );
}
