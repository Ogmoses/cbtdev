import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SchoolProvider } from "@/components/SchoolProvider";
import { getBrandingByCodeServer } from "@/lib/schoolServer";
import { brandingStyleText } from "@/lib/schoolBranding";

type Params = Promise<{ schoolCode: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { schoolCode } = await params;
  const school = await getBrandingByCodeServer(schoolCode);
  return { title: school?.name ? `${school.name} CBT` : "CBT Platform" };
}

/**
 * Every school's entry URL is /s/<code> (e.g. /s/soaring-fountain). This
 * layout looks the school up from that code, paints its colors server-side,
 * and hands its branding to everything underneath. An unknown code is a 404.
 * A school that isn't active yet (pending approval) or is suspended shows a
 * notice instead of its login — the database independently blocks its data.
 */
export default async function SchoolLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  const { schoolCode } = await params;
  const school = await getBrandingByCodeServer(schoolCode);
  if (!school) notFound();

  if (school.status !== "active") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 text-center">
        <div className="max-w-sm">
          <h1 className="font-display text-xl font-semibold text-ink dark:text-white">
            {school.status === "pending" ? "This school isn't active yet" : "This school's access is paused"}
          </h1>
          <p className="mt-2 text-[14px] text-ink/60 dark:text-white/60">
            {school.status === "pending"
              ? "It's still waiting for approval. You'll be sent your link once it's ready."
              : "Please contact your school administrator."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: brandingStyleText(school) }} />
      <SchoolProvider initialSchool={school}>{children}</SchoolProvider>
    </>
  );
}
