import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Gate for every platform-owner API route: signed in AND role = platform_owner. */
export async function requireOwner() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false as const, status: 401, error: "Not signed in." };
  const admin = createAdminClient();
  const { data: row } = await admin.from("users").select("role, email").eq("id", auth.user.id).maybeSingle();
  if (row?.role !== "platform_owner") return { ok: false as const, status: 403, error: "Only the platform owner can do this." };
  return { ok: true as const, userId: auth.user.id, email: (row.email as string | null) ?? auth.user.email ?? null };
}
