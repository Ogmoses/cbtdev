"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Bell, ChevronDown, ChevronRight, LogOut, Loader2, User as UserIcon } from "lucide-react";
import { useActionItems } from "@/lib/useActionItems";
import { AnimatePresence, motion } from "framer-motion";

interface NavbarProps {
  role: "platform_owner" | "super_admin" | "teacher" | "student";
  title: string;
  userName: string;
  userPhotoUrl?: string | null;
  onMenuClick: () => void;
  onViewProfile: () => void;
  onLogout: () => void;
}

export default function Navbar({
  role,
  title,
  userName,
  userPhotoUrl,
  onMenuClick,
  onViewProfile,
  onLogout,
}: NavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const router = useRouter();
  const { items, loading, refresh, total } = useActionItems(role);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-black/5 bg-white/90 px-4 backdrop-blur dark:border-white/10 dark:bg-[#16181C]/90 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          aria-label="Open menu"
          className="rounded-md p-2 text-ink/60 transition-colors duration-200 hover:bg-background-muted dark:text-white/60 dark:hover:bg-white/5 lg:hidden"
        >
          <Menu size={20} />
        </button>
        <h1 className="font-display text-[15px] font-semibold text-ink dark:text-white sm:text-[17px]">{title}</h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <div className="relative">
          <button
            aria-label={total > 0 ? `Notifications: ${total} need attention` : "Notifications"}
            onClick={() => {
              setBellOpen((v) => !v);
              setMenuOpen(false);
              if (!bellOpen) refresh();
            }}
            className="relative rounded-md p-2 text-ink/60 transition-colors duration-200 hover:bg-background-muted dark:text-white/60 dark:hover:bg-white/5"
          >
            <Bell size={19} />
            {total > 0 && <span className="absolute right-1.5 top-1.5 flex h-2 w-2 rounded-full bg-crimson-600" />}
          </button>

          <AnimatePresence>
            {bellOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setBellOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="fixed right-3 top-[68px] z-40 w-[calc(100vw-1.5rem)] max-w-sm overflow-hidden rounded-lg bg-white shadow-card-hover dark:bg-[#1A1C20] sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-80"
                >
                  <p className="border-b border-black/5 px-4 py-3 font-display text-[13.5px] font-semibold text-ink dark:border-white/10 dark:text-white">Needs your attention</p>
                  {loading ? (
                    <div className="flex justify-center py-6 text-ink/40 dark:text-white/40">
                      <Loader2 size={18} className="animate-spin" />
                    </div>
                  ) : items.length === 0 ? (
                    <p className="px-4 py-6 text-center text-[13px] text-ink/50 dark:text-white/50">You're all caught up.</p>
                  ) : (
                    <ul>
                      {items.map((item) => (
                        <li key={item.key}>
                          <button
                            onClick={() => {
                              setBellOpen(false);
                              const [path, hash] = item.href.split("#");
                              if (hash && path === window.location.pathname) {
                                // already on this page: scroll to the section ourselves, once the dropdown has closed
                                setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
                              } else {
                                router.push(item.href);
                              }
                            }}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13px] text-ink transition-colors hover:bg-background-muted dark:text-white dark:hover:bg-white/5"
                          >
                            <span>{item.label}</span>
                            <ChevronRight size={15} className="shrink-0 text-ink/30 dark:text-white/30" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        <div className="relative">
          <button
            onClick={() => {
              setMenuOpen((v) => !v);
              setBellOpen(false);
            }}
            className="flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 transition-colors duration-200 hover:bg-background-muted dark:hover:bg-white/5"
          >
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-crimson-100 text-crimson-700">
              {userPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={userPhotoUrl} alt={userName} className="h-full w-full object-cover" />
              ) : (
                <UserIcon size={16} />
              )}
            </div>
            <span className="hidden max-w-[120px] truncate text-[13px] font-medium text-ink dark:text-white sm:inline">
              {userName}
            </span>
            <ChevronDown size={15} className="hidden text-ink/40 dark:text-white/40 sm:inline" />
          </button>

          <AnimatePresence>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 z-40 mt-2 w-44 overflow-hidden rounded-lg border border-black/5 bg-white shadow-card-hover dark:border-white/10 dark:bg-[#1A1C20]"
                >
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onViewProfile();
                    }}
                    className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] font-medium text-ink/70 transition-colors duration-200 hover:bg-background-muted dark:text-white/70 dark:hover:bg-white/5"
                  >
                    <UserIcon size={15} />
                    Profile
                  </button>
                  <button
                    onClick={onLogout}
                    className="flex w-full items-center gap-2 border-t border-black/5 px-3.5 py-2.5 text-left text-[13px] font-medium text-crimson-700 transition-colors duration-200 hover:bg-crimson-50 dark:border-white/10 dark:hover:bg-crimson-600/10"
                  >
                    <LogOut size={15} />
                    Log out
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
