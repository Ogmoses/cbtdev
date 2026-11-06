import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLocked } from "@/lib/billing";
import { formatEndDate, getBillingContact } from "@/lib/billingServer";

/**
 * GET /api/billing/notice -> what the renewal screen shows for the signed-in person's school.
 * `locked: false` means the screen should send them back to their dashboard. Only staff get the owner's contact
 * details; a student is told to speak to their school.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("users").select("role, school_id").eq("id", auth.user.id).maybeSingle();
  if (!me?.school_id) return NextResponse.json({ locked: false, role: me?.role ?? null }, { headers: { "Cache-Control": "no-store" } });

  const { data: school } = await admin.from("schools").select("name, subscription_status, term_ends_at").eq("id", me.school_id).maybeSingle();
  if (!school) return NextResponse.json({ locked: false, role: me.role }, { headers: { "Cache-Control": "no-store" } });

  const locked = isLocked(school as { subscription_status: string | null; term_ends_at: string | null });
  const contact = await getBillingContact(admin);
  const staff = me.role === "super_admin" || me.role === "teacher";
  return NextResponse.json(
    {
      locked,
      role: me.role,
      schoolName: school.name,
      endedOn: school.term_ends_at ? formatEndDate(school.term_ends_at as string, contact.timezone) : null,
      contact: staff ? { email: contact.email, phone: contact.phone, message: contact.message } : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
