"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useSchoolProfile } from "@/lib/useSchoolProfile";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  FileQuestion,
  ClipboardList,
  BarChart3,
  CalendarClock,
  Settings,
  FileText,
  X,
  Waves,
  Building2,
  Power,
  ShieldAlert,
  Megaphone,
  LifeBuoy,
  Inbox,
} from "lucide-react";
import { useSupportAttention } from "@/lib/supportAttention";

export type Role = "platform_owner" | "super_admin" | "teacher" | "student";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  platform_owner: [
    { label: "Command Center", href: "/owner", icon: Building2 },
    { label: "Support", href: "/owner/support", icon: Inbox },
    { label: "Broadcasts", href: "/owner/broadcasts", icon: Megaphone },
    { label: "Controls", href: "/owner/controls", icon: Power },
    { label: "Security", href: "/owner/security", icon: ShieldAlert },
    { label: "Audit Logs", href: "/owner/audit-logs", icon: FileText },
    { label: "Settings", href: "/owner/settings", icon: Settings },
  ],
  super_admin: [
    { label: "Overview", href: "/admin", icon: LayoutDashboard },
    { label: "Students & Teachers", href: "/admin/people", icon: Users },
    { label: "Classes & Subjects", href: "/admin/academics", icon: GraduationCap },
    { label: "Lab Batches", href: "/admin/batches", icon: CalendarClock },
    { label: "Results & Analytics", href: "/admin/results", icon: BarChart3 },
    { label: "Report Cards", href: "/admin/report-cards", icon: FileText },
    { label: "Help & Support", href: "/admin/support", icon: LifeBuoy },
    { label: "Settings", href: "/admin/settings", icon: Settings },
  ],
  teacher: [
    { label: "Overview", href: "/teacher", icon: LayoutDashboard },
    { label: "Question Bank", href: "/teacher/questions", icon: FileQuestion },
    { label: "My Exams", href: "/teacher/exams", icon: BookOpen },
    { label: "Grading Queue", href: "/teacher/grading", icon: ClipboardList },
    { label: "Class Analytics", href: "/teacher/analytics", icon: BarChart3 },
    { label: "Help & Support", href: "/teacher/support", icon: LifeBuoy },
  ],
  student: [
    { label: "Exam Launchpad", href: "/student", icon: LayoutDashboard },
    { label: "Upcoming Batches", href: "/student/batches", icon: CalendarClock },
    { label: "Past Results", href: "/student/results", icon: BarChart3 },
  ],
};

interface SidebarProps {
  role: Role;
  userName: string;
  /** Mobile drawer open state — controlled by DashboardLayout */
  open: boolean;
  onClose: () => void;
}

function SidebarContent({ role, userName, onNavigate }: { role: Role; userName: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const items = NAV_BY_ROLE[role];

  // Active tab = whichever item's href is the single longest exact-or-
  // prefix match for the current path. Checking each item independently
  // (pathname === href || pathname.startsWith(href + "/")) meant a root
  // link like "/teacher" matched every one of its own sub-pages too, so
  // Overview stayed lit no matter which page was actually open, on top
  // of whichever page's own item also (correctly) lit up. Picking the
  // single most-specific match up front means exactly one item is ever
  // active.
  const activeHref = items.reduce<string | null>((best, item) => {
    const matches = pathname === item.href || pathname?.startsWith(item.href + "/");
    if (!matches) return best;
    if (best === null || item.href.length > best.length) return item.href;
    return best;
  }, null);

  // Owner: requests still open / in progress. Admin & teacher: updates they haven't read yet. (Students have no support desk.)
  const supportCount = useSupportAttention(role !== "student");

  const schoolProfile = useSchoolProfile();
  // The platform owner belongs to no school, so show the platform instead of a school.
  const school = role === "platform_owner" ? { name: "Platform Console", motto: "All schools", logoUrl: null } : schoolProfile;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#16181C]">
      <div className="flex items-center gap-2.5 px-5 py-5">
        {school.logoUrl ? (
          <img src={school.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-crimson-600 text-on-crimson">
            <Waves size={18} strokeWidth={2.25} />
          </div>
        )}
        <div className="min-w-0 leading-tight">
          <p className="font-display text-[13.5px] font-semibold leading-snug text-ink dark:text-white">{school.name}</p>
          {school.motto && <p className="truncate text-[11px] text-ink/50 dark:text-white/50">{school.motto}</p>}
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {items.map(({ label, href, icon: Icon }) => {
          const active = href === activeHref;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition-colors duration-200 ${
                active
                  ? "bg-crimson-50 text-crimson-700 dark:bg-crimson-600/15 dark:text-crimson-500"
                  : "text-ink/65 hover:bg-background-muted hover:text-ink dark:text-white/60 dark:hover:bg-white/5 dark:hover:text-white"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active-pill"
                  className="absolute left-0 h-5 w-[3px] rounded-full bg-crimson-600"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <Icon size={18} strokeWidth={2} className={active ? "text-crimson-600 dark:text-crimson-500" : "text-ink/40 group-hover:text-ink/70 dark:text-white/40 dark:group-hover:text-white/70"} />
              <span>{label}</span>
              {href.endsWith("/support") && supportCount > 0 && (
                <span
                  className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-crimson-600 px-1.5 text-[10.5px] font-semibold leading-none text-on-crimson"
                  aria-label={`${supportCount} need attention`}
                >
                  {supportCount > 9 ? "9+" : supportCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-black/5 px-5 py-4 dark:border-white/10">
        <p className="text-[11px] uppercase tracking-wide text-ink/40 dark:text-white/40">Signed in as</p>
        <p className="mt-0.5 truncate text-[13px] font-medium text-ink dark:text-white">{userName}</p>
      </div>
    </div>
  );
}

export default function Sidebar({ role, userName, open, onClose }: SidebarProps) {
  return (
    <>
      {/* Desktop: static sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-black/5 dark:border-white/10 lg:block">
        <SidebarContent role={role} userName={userName} />
      </aside>

      {/* Mobile: slide-over drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
              className="fixed inset-0 z-40 bg-ink/40 lg:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
              className="fixed inset-y-0 left-0 z-50 w-72 shadow-card-hover lg:hidden"
            >
              <button
                onClick={onClose}
                aria-label="Close menu"
                className="absolute right-3 top-4 rounded-md p-1.5 text-ink/50 hover:bg-background-muted dark:text-white/50 dark:hover:bg-white/5"
              >
                <X size={18} />
              </button>
              <SidebarContent role={role} userName={userName} onNavigate={onClose} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
