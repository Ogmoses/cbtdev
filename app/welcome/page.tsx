import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import {
  School,
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
import { getCurrentSchoolServer } from "@/lib/schoolServer";
import { brandingCssVars, fetchBrandingByCode, DEFAULT_SECONDARY_COLOR } from "@/lib/schoolBranding";
import { createClient } from "@/lib/supabase/server";
import { Reveal, Float, CountUp } from "@/components/landing/Motion";
import PoweredBy from "@/components/PoweredBy";

const GRAD = "bg-gradient-to-r from-crimson-600 to-crimson-800 bg-clip-text text-transparent dark:from-crimson-300 dark:to-crimson-500";
const TINT = "from-crimson-400 to-crimson-600 text-on-crimson";
// Visitors (not signed in to a school) see a vivid yellow; a signed-in admin or teacher sees their school's own colour.
const VISITOR_COLOR = "#FFC400";

export const metadata: Metadata = {
  title: "CBTDEV — computer-based exams and school management",
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
  { q: "What is CBTDEV?", a: "A web app for running computer-based tests and managing the day-to-day of a school: students, teachers, subjects, terms, exams, results and report cards." },
  { q: "Who can use it?", a: "Schools. Each school gets its own space with school admins, teachers and students, and each person signs in to see only what their role allows." },
  { q: "Can it carry my school's name and colours?", a: "Yes. Your school's name, logo and colours are used throughout, and your school has its own sign-in link to share." },
  { q: "Does it work on phones?", a: "Yes. It runs in the browser on computers and phones, so students can sit exams in a lab or on their own device, depending on how your school schedules them." },
  { q: "How do I get started?", a: "Register your school. After your email is confirmed and your school is approved, you can sign in and begin adding teachers and students." },
];

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl bg-white p-6 text-left shadow-card dark:bg-[#1A1C20]">
      <p className="font-display text-[34px] font-extrabold sm:text-[44px] bg-gradient-to-r from-crimson-600 to-crimson-800 bg-clip-text text-transparent dark:from-crimson-300 dark:to-crimson-500"><CountUp value={value} /></p>
      <p className="mt-1 text-[15px] text-ink/60 dark:text-white/60">{label}</p>
    </div>
  );
}

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s: rawCode } = await searchParams;
  const code = typeof rawCode === "string" && /^[a-z0-9-]{1,64}$/i.test(rawCode) ? rawCode.toLowerCase() : null;
  const [stats, school] = await Promise.all([getPublicStats(), getCurrentSchoolServer()]);
  // Colours: a signed-in school keeps its own theme (already applied app-wide). Someone who arrived from a school's
  // sign-in page (/welcome?s=<code>) sees that school's colour. Everyone else gets the vivid yellow default.
  const linked = !school && code ? await fetchBrandingByCode(await createClient(), code) : null;
  const visitorStyle = school
    ? undefined
    : (brandingCssVars({ themeColor: linked?.themeColor ?? VISITOR_COLOR, secondaryColor: linked?.secondaryColor ?? DEFAULT_SECONDARY_COLOR }) as CSSProperties);
  const signInHref = linked ? `/s/${code}` : "/login";
  const tiles = stats
    ? [
        { value: stats.schools, label: stats.schools === 1 ? "School on the platform" : "Schools on the platform" },
        { value: stats.students, label: stats.students === 1 ? "Student registered" : "Students registered" },
        { value: stats.exams, label: stats.exams === 1 ? "Exam created" : "Exams created" },
        { value: stats.examsTaken, label: stats.examsTaken === 1 ? "Exam submitted" : "Exams submitted" },
      ].filter((t) => t.value > 0)
    : [];

  return (
    <div style={visitorStyle} className="min-h-screen bg-white font-sans text-ink dark:bg-[#101114] dark:text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-black/5 bg-white/90 backdrop-blur dark:border-white/10 dark:bg-[#101114]/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/welcome" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-crimson-500 to-crimson-700 text-on-crimson shadow-md">
              <School size={17} strokeWidth={2.25} />
            </span>
            <span className="font-display text-[19px] font-bold">CBTDEV</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link href={signInHref} className="rounded-lg px-3 py-2 text-[15px] font-medium text-ink/70 hover:text-crimson-600 dark:text-white/70">
              Sign in
            </Link>
            <Link href="/register-school" className="rounded-lg bg-crimson-600 px-4 py-2.5 text-[15px] font-semibold text-on-crimson hover:bg-crimson-700">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0d0d10] via-crimson-900 to-crimson-700 text-white">
        <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 animate-pulse rounded-full bg-crimson-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 animate-pulse rounded-full bg-crimson-300/20 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2">
          <Reveal>
            <span className="inline-block rounded-full bg-white/10 px-4 py-1.5 text-[13.5px] font-semibold tracking-wide text-crimson-300">Computer-based testing for schools</span>
            <h1 className="mt-5 font-display text-[48px] font-extrabold leading-[1.04] tracking-tight sm:text-[68px]">
              Exams made <span className="bg-gradient-to-r from-crimson-300 to-crimson-500 bg-clip-text text-transparent">simple</span>, results made <span className="bg-gradient-to-r from-crimson-200 to-crimson-400 bg-clip-text text-transparent">instant</span>
            </h1>
            <p className="mt-6 max-w-lg text-[19px] leading-relaxed text-white/75">
              Schedule exams, let students sit them on a computer, mark and publish results, and keep your whole school organised, without the paperwork.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/register-school" className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-crimson-500 to-crimson-400 px-8 py-4 text-[17px] font-bold text-on-crimson shadow-lg shadow-crimson-500/30 transition hover:scale-[1.03]">
                Get started <ArrowRight size={17} />
              </Link>
              <Link href={signInHref} className="rounded-xl border border-white/30 px-8 py-4 text-center text-[17px] font-semibold text-white transition hover:bg-white/10">
                Sign in
              </Link>
            </div>
          </Reveal>
          <div className="relative mx-auto h-[360px] w-full max-w-sm">
            <Float className="absolute left-0 top-2 w-60 rounded-2xl bg-white p-4 text-ink shadow-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink/40">Exam in progress</p>
              <p className="mt-1 font-display text-[28px] font-extrabold text-crimson-700">24:10</p>
              <div className="mt-2 h-2 rounded-full bg-black/10"><div className="h-2 w-2/3 rounded-full bg-gradient-to-r from-crimson-500 to-crimson-700" /></div>
              <p className="mt-2 text-[12px] text-ink/60">Question 14 of 20</p>
            </Float>
            <Float delay={1.2} className="absolute right-0 top-28 w-52 rounded-2xl bg-gradient-to-br from-crimson-400 to-crimson-600 p-4 text-on-crimson shadow-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-wider opacity-70">Result published</p>
              <p className="mt-1 font-display text-[34px] font-extrabold">19/20</p>
              <p className="text-[12px] font-medium">Submitted today, school time</p>
            </Float>
            <Float delay={2.4} className="absolute bottom-0 left-8 w-56 rounded-2xl bg-crimson-800 p-4 text-white shadow-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Sitting</p>
              <p className="mt-1 text-[15px] font-bold">Batch B is open</p>
              <p className="text-[12px] text-white/75">Closes when you say so</p>
            </Float>
          </div>
        </div>
      </section>

      {/* Why */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="max-w-3xl text-left">
          <p className="text-[20px] font-extrabold uppercase tracking-[0.1em] text-crimson-700 sm:text-[22px]">Why CBTDEV</p>
          <h2 className="mt-2 font-display text-[42px] font-extrabold leading-[1.08] tracking-tight sm:text-[56px]">Everything an <span className={GRAD}>exam day</span> needs</h2>
          <p className="mt-4 text-[18px] leading-relaxed text-ink/60 dark:text-white/60">
            From the first question written to the report card printed, one tool covers it, so staff spend their time teaching, not chasing papers.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={(i % 4) * 0.08}>
            <div className="h-full rounded-2xl bg-background-muted p-6 transition hover:-translate-y-1 hover:shadow-card-hover dark:bg-white/5">
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${TINT} shadow-md`}>
                <Icon size={20} />
              </span>
              <h3 className="mt-4 font-display text-[21px] font-bold">{title}</h3>
              <p className="mt-2 text-[16px] leading-relaxed text-ink/60 dark:text-white/60">{text}</p>
            </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Numbers (live) */}
      {tiles.length > 0 && (
        <section className="bg-gradient-to-r from-crimson-50 to-crimson-100 dark:from-white/[0.03] dark:to-white/[0.03]">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="text-left font-display text-[38px] font-extrabold leading-[1.1] sm:text-[50px]">The platform <span className={GRAD}>in numbers</span></h2>
            <div className={`mt-8 grid grid-cols-2 gap-4 ${tiles.length >= 4 ? "lg:grid-cols-4" : tiles.length === 3 ? "lg:grid-cols-3" : ""}`}>
              {tiles.map((t) => (
                <Stat key={t.label} value={t.value} label={t.label} />
              ))}
            </div>
            <p className="mt-4 text-left text-[13px] text-ink/45 dark:text-white/40">Live totals, refreshed every few minutes.</p>
          </div>
        </section>
      )}

      {/* Audiences */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="max-w-3xl text-left">
          <p className="text-[20px] font-extrabold uppercase tracking-[0.1em] text-crimson-700 sm:text-[22px]">Who it is for</p>
          <h2 className="mt-2 font-display text-[42px] font-extrabold leading-[1.08] tracking-tight sm:text-[56px]">One platform, <span className={GRAD}>three roles</span></h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {AUDIENCES.map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={i * 0.12}>
            <div className="h-full rounded-2xl border border-black/5 bg-white p-6 shadow-card transition hover:-translate-y-1.5 hover:shadow-card-hover dark:border-white/10 dark:bg-[#1A1C20]">
              <span className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${TINT} shadow-md`}>
                <Icon size={21} />
              </span>
              <h3 className="mt-4 font-display text-[22px] font-bold">{title}</h3>
              <p className="mt-2 text-[16px] leading-relaxed text-ink/60 dark:text-white/60">{text}</p>
            </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Screenshots (only when some have been added) */}
      {SCREENSHOTS.length > 0 && (
        <section className="bg-background-muted dark:bg-white/[0.03]">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="text-left font-display text-[24px] font-bold sm:text-[30px]">See it in action</h2>
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
        <div className="max-w-3xl text-left">
          <p className="text-[20px] font-extrabold uppercase tracking-[0.1em] text-crimson-700 sm:text-[22px]">How it works</p>
          <h2 className="mt-2 font-display text-[42px] font-extrabold leading-[1.08] tracking-tight sm:text-[56px]">Up and running in <span className={GRAD}>three steps</span></h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.12}>
            <div className="h-full rounded-2xl bg-background-muted p-6 dark:bg-white/5">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-crimson-500 to-crimson-700 font-display text-[18px] font-extrabold text-on-crimson shadow-md">{s.n}</span>
              <h3 className="mt-3 font-display text-[22px] font-bold">{s.title}</h3>
              <p className="mt-2 text-[16px] leading-relaxed text-ink/60 dark:text-white/60">{s.text}</p>
            </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 pb-14 sm:px-6 sm:pb-20">
        <h2 className="text-left font-display text-[42px] font-extrabold leading-[1.08] tracking-tight sm:text-[56px]">Frequently asked <span className={GRAD}>questions</span></h2>
        <div className="mt-8 space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="group rounded-lg border border-black/5 bg-white p-4 shadow-card dark:border-white/10 dark:bg-[#1A1C20] [&[open]_svg]:rotate-180">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[18px] font-bold [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDown size={17} className="shrink-0 text-ink/40 transition-transform dark:text-white/40" />
              </summary>
              <p className="mt-3 text-[16px] leading-relaxed text-ink/60 dark:text-white/60">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final call to action */}
      <section className="bg-gradient-to-r from-crimson-600 to-crimson-400">
        <div className="mx-auto max-w-3xl px-4 py-14 text-left sm:px-6">
          <h2 className="font-display text-[42px] font-extrabold leading-[1.08] text-on-crimson sm:text-[56px]">Ready to bring your school online?</h2>
          <p className="mt-4 max-w-xl text-[18px] leading-relaxed text-on-crimson/85">Register your school today and start setting up your first exam.</p>
          <Link href="/register-school" className="mt-7 inline-flex items-center gap-2 rounded-lg bg-ink px-8 py-4 text-[17px] font-bold text-white hover:bg-ink/90">
            Get started <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-black/5 dark:border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-[14px] text-ink/50 dark:text-white/50 sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} CBTDEV. All rights reserved.</p>
          <PoweredBy schoolCode={linked ? (code ?? undefined) : undefined} />
        </div>
      </footer>
    </div>
  );
}
