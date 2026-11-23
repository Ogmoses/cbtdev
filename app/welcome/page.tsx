import type { Metadata } from "next";
import Link from "next/link";
import {
  Waves,
  ArrowRight,
  Laptop,
  CalendarClock,
  ClipboardCheck,
  FileText,
  Palette,
  LifeBuoy,
  Download,
  ShieldCheck,
  Building2,
  GraduationCap,
  Users,
  ChevronDown,
} from "lucide-react";
import { getPublicStats } from "@/lib/publicStats";

export const metadata: Metadata = {
  title: "CBT Platform — computer-based exams and school management",
  description: "Run computer-based exams, mark and publish results, and manage your school from one place.",
};

/**
 * App screenshots shown in the "See it in action" section. Add an entry (and drop the image in /public/landing/)
 * to show one; while this list is empty the whole section stays hidden.
 */
const SCREENSHOTS: { src: string; alt: string; caption: string }[] = [];

const FEATURES = [
  { icon: Laptop, title: "Computer-based exams", text: "Objective, fill-in-the-blank and theory questions, taken on any computer lab or phone, with a clean exam screen for students." },
  { icon: CalendarClock, title: "Batches and lab scheduling", text: "Split a class into batches, give each a start and end time, and assign students — no more everyone-at-once lab rush." },
  { icon: ClipboardCheck, title: "Marking and results", text: "Objective questions are scored for you; teachers mark theory answers. Publish results when you are ready." },
  { icon: FileText, title: "Report cards", text: "Grading scales, terms and term results come together into printable report cards for each student." },
  { icon: Palette, title: "Your school, your look", text: "Your school's name, logo and colours, and its own sign-in link — students and teachers see your school, not ours." },
  { icon: ShieldCheck, title: "Private by design", text: "Each school's data is kept separate from every other school's, and every person only sees what their role allows." },
  { icon: Download, title: "Import and export", text: "Bring in question banks and student lists, and export your school's data when you need it." },
  { icon: LifeBuoy, title: "Built-in help desk", text: "Raise a support request from inside the app and follow the reply without leaving your dashboard." },
];

const AUDIENCES = [
  { icon: Building2, title: "For school owners and admins", text: "Set up your school, add teachers and students, schedule exams, publish results and keep everything in one dashboard." },
  { icon: Users, title: "For teachers", text: "Build exams from a question bank, see who is sitting what today, and mark theory answers in one queue." },
  { icon: GraduationCap, title: "For students", text: "Sign in with your name and student ID, take your exam, and come back to your results, with the date and time you submitted, any time." },
];

const STEPS = [
  { n: "1", title: "Register your school", text: "Fill in a short form with your school's name and the first admin's details, and confirm your email." },
  { n: "2", title: "Get approved", text: "Your school is reviewed and approved, and you receive your school's own sign-in link." },
  { n: "3", title: "Add people, schedule exams", text: "Add teachers and students, set up subjects and terms, create exams and assign batches." },
];

const FAQS = [
  { q: "What is CBT Platform?", a: "A web app for running computer-based tests and managing the day-to-day of a school: students, teachers, subjects, terms, exams, results and report cards." },
  { q: "Who can use it?", a: "Schools. Each school gets its own space with school admins, teachers and students, and each person signs in to see only what their role allows." },
  { q: "Can it carry my school's name and colours?", a: "Yes. Your school's name, logo and colours are used throughout, and your school has its own sign-in link to share." },
  { q: "Does it work on phones?", a: "Yes. It runs in the browser on computers and phones, so students can sit exams in a lab or on their own device, depending on how your school schedules them." },
  { q: "How do I get started?", a: "Register your school. After your email is confirmed and your school is approved, you can sign in and begin adding teachers and students." },
];

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg bg-white p-5 text-center shadow-card dark:bg-[#1A1C20]">
      <p className="font-display text-[28px] font-bold text-crimson-600 sm:text-[34px]">{value.toLocaleString("en-US")}</p>
      <p className="mt-1 text-[12.5px] text-ink/60 dark:text-white/60">{label}</p>
    </div>
  );
}

export default async function WelcomePage() {
  const stats = await getPublicStats();
  const tiles = stats
    ? [
        { value: stats.schools, label: stats.schools === 1 ? "School on the platform" : "Schools on the platform" },
        { value: stats.students, label: stats.students === 1 ? "Student registered" : "Students registered" },
        { value: stats.exams, label: stats.exams === 1 ? "Exam created" : "Exams created" },
        { value: stats.examsTaken, label: stats.examsTaken === 1 ? "Exam submitted" : "Exams submitted" },
      ].filter((t) => t.value > 0)
    : [];

  return (
    <div className="min-h-screen bg-white font-sans text-ink dark:bg-[#101114] dark:text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-black/5 bg-white/90 backdrop-blur dark:border-white/10 dark:bg-[#101114]/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/welcome" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-crimson-600 text-on-crimson">
              <Waves size={17} strokeWidth={2.25} />
            </span>
            <span className="font-display text-[15px] font-semibold">CBT Platform</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/login" className="rounded-lg px-3 py-2 text-[13px] font-medium text-ink/70 hover:text-crimson-600 dark:text-white/70">
              Sign in
            </Link>
            <Link href="/register-school" className="rounded-lg bg-crimson-600 px-3.5 py-2 text-[13px] font-semibold text-on-crimson hover:bg-crimson-700">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-b from-crimson-50 to-white dark:from-crimson-900/20 dark:to-[#101114]">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <h1 className="font-display text-[30px] font-bold leading-tight sm:text-[44px]">
            Computer-based exams and school management, <span className="text-crimson-600">in one place</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-ink/65 dark:text-white/65">
            Schedule exams, let students sit them on a computer, mark and publish results, and keep the whole school organised, without the paperwork.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register-school" className="flex w-full items-center justify-center gap-2 rounded-lg bg-crimson-600 px-6 py-3 text-[14px] font-semibold text-on-crimson hover:bg-crimson-700 sm:w-auto">
              Get started <ArrowRight size={16} />
            </Link>
            <Link href="/login" className="w-full rounded-lg border border-black/10 px-6 py-3 text-[14px] font-semibold text-ink hover:border-crimson-600 hover:text-crimson-600 dark:border-white/20 dark:text-white sm:w-auto">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Why */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-crimson-600">Why CBT Platform</p>
          <h2 className="mt-2 font-display text-[24px] font-bold sm:text-[30px]">Everything an exam day needs</h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-ink/60 dark:text-white/60">
            From the first question written to the report card printed, one tool covers it, so staff spend their time teaching, not chasing papers.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-lg bg-background-muted p-5 dark:bg-white/5">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-crimson-100 text-crimson-700 dark:bg-crimson-600/20 dark:text-crimson-500">
                <Icon size={20} />
              </span>
              <h3 className="mt-3 font-display text-[15px] font-semibold">{title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink/60 dark:text-white/60">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Numbers (live) */}
      {tiles.length > 0 && (
        <section className="bg-background-muted dark:bg-white/[0.03]">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <h2 className="text-center font-display text-[20px] font-bold sm:text-[24px]">The platform in numbers</h2>
            <div className={`mt-8 grid grid-cols-2 gap-4 ${tiles.length >= 4 ? "lg:grid-cols-4" : tiles.length === 3 ? "lg:grid-cols-3" : ""}`}>
              {tiles.map((t) => (
                <Stat key={t.label} value={t.value} label={t.label} />
              ))}
            </div>
            <p className="mt-4 text-center text-[11.5px] text-ink/40 dark:text-white/40">Live totals, refreshed every few minutes.</p>
          </div>
        </section>
      )}

      {/* Audiences */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-crimson-600">Who it is for</p>
          <h2 className="mt-2 font-display text-[24px] font-bold sm:text-[30px]">One platform, three roles</h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {AUDIENCES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-lg border border-black/5 bg-white p-6 shadow-card dark:border-white/10 dark:bg-[#1A1C20]">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-crimson-600 text-on-crimson">
                <Icon size={21} />
              </span>
              <h3 className="mt-4 font-display text-[16px] font-semibold">{title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/60 dark:text-white/60">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Screenshots (only when some have been added) */}
      {SCREENSHOTS.length > 0 && (
        <section className="bg-background-muted dark:bg-white/[0.03]">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="text-center font-display text-[24px] font-bold sm:text-[30px]">See it in action</h2>
            <div className="mt-10 flex gap-5 overflow-x-auto pb-2 sm:justify-center">
              {SCREENSHOTS.map((s) => (
                <figure key={s.src} className="w-[220px] shrink-0 sm:w-[240px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.src} alt={s.alt} loading="lazy" className="w-full rounded-2xl border border-black/10 shadow-card-hover dark:border-white/15" />
                  <figcaption className="mt-2 text-center text-[12px] text-ink/55 dark:text-white/55">{s.caption}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-crimson-600">How it works</p>
          <h2 className="mt-2 font-display text-[24px] font-bold sm:text-[30px]">Up and running in three steps</h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-lg bg-background-muted p-6 dark:bg-white/5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-crimson-600 font-display text-[15px] font-bold text-on-crimson">{s.n}</span>
              <h3 className="mt-3 font-display text-[16px] font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink/60 dark:text-white/60">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 pb-14 sm:px-6 sm:pb-20">
        <h2 className="text-center font-display text-[24px] font-bold sm:text-[30px]">Frequently asked questions</h2>
        <div className="mt-8 space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="group rounded-lg border border-black/5 bg-white p-4 shadow-card dark:border-white/10 dark:bg-[#1A1C20] [&[open]_svg]:rotate-180">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-semibold [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDown size={17} className="shrink-0 text-ink/40 transition-transform dark:text-white/40" />
              </summary>
              <p className="mt-3 text-[13.5px] leading-relaxed text-ink/60 dark:text-white/60">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final call to action */}
      <section className="bg-crimson-600">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6">
          <h2 className="font-display text-[24px] font-bold text-on-crimson sm:text-[30px]">Ready to bring your school online?</h2>
          <p className="mx-auto mt-3 max-w-xl text-[14.5px] leading-relaxed text-on-crimson/80">Register your school today and start setting up your first exam.</p>
          <Link href="/register-school" className="mt-7 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-[14px] font-semibold text-crimson-700 hover:bg-white/90">
            Get started <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-black/5 dark:border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-[12px] text-ink/50 dark:text-white/50 sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} CBT Platform. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hover:text-crimson-600">Sign in</Link>
            <Link href="/register-school" className="hover:text-crimson-600">Register your school</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
