import Link from "next/link";
import { School } from "lucide-react";

/** "Powered By cbtdev.vercel.app": small badge + name, linking to the public landing page (in the school's colours when a school code is given). */
export default function PoweredBy({ className = "", schoolCode }: { className?: string; schoolCode?: string }) {
  return (
    <Link href={schoolCode ? `/welcome?s=${encodeURIComponent(schoolCode)}` : "/welcome"} className={`inline-flex items-center gap-2 text-[13px] text-ink/80 dark:text-white/80 ${className}`}>
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-crimson-500 to-crimson-700 text-on-crimson">
        <School size={15} strokeWidth={2.25} />
      </span>
      <span>
        Powered By <strong className="font-bold text-ink underline dark:text-white">cbtdev.vercel.app</strong>
      </span>
    </Link>
  );
}
