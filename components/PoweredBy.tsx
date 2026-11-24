import Link from "next/link";
import { School } from "lucide-react";

/** "Powered By cbtdev.vercel.app": small badge + name, linking to the public landing page. */
export default function PoweredBy({ className = "" }: { className?: string }) {
  return (
    <Link href="/welcome" className={`inline-flex items-center gap-2 text-[13px] text-ink/80 dark:text-white/80 ${className}`}>
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-crimson-600 to-amber-500 text-white">
        <School size={15} strokeWidth={2.25} />
      </span>
      <span>
        Powered By <strong className="font-bold text-ink underline dark:text-white">cbtdev.vercel.app</strong>
      </span>
    </Link>
  );
}
