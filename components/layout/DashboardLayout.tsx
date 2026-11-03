"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Sidebar, { type Role } from "./Sidebar";
import Navbar from "./Navbar";
import ConnectionBanner from "./ConnectionBanner";
import AnnouncementBanner from "./AnnouncementBanner";

interface DashboardLayoutProps {
  role: Role;
  pageTitle: string;
  userName: string;
  userPhotoUrl?: string | null;
  onLogout: () => void;
  children: ReactNode;
}

export default function DashboardLayout({
  role,
  pageTitle,
  userName,
  userPhotoUrl,
  onLogout,
  children,
}: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="flex min-h-screen bg-background-muted dark:bg-[#101114]">
      <Sidebar role={role} userName={userName} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-h-screen flex-1 flex-col">
        <ConnectionBanner />
        <Navbar
          role={role}
          title={pageTitle}
          userName={userName}
          userPhotoUrl={userPhotoUrl}
          onMenuClick={() => setSidebarOpen(true)}
          onViewProfile={() => router.push("/profile")}
          onLogout={onLogout}
        />

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {/* Desktop: dashboards get room for multi-column grids.
              Mobile: children should stack as single-column cards. */}
          <div className="mx-auto w-full max-w-7xl animate-fade-in">
            <AnnouncementBanner role={role} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
