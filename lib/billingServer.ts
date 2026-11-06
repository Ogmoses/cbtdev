import type { SupabaseClient } from "@supabase/supabase-js";

export interface BillingContact {
  email: string | null;
  phone: string | null;
  message: string | null;
  currency: string | null;
  timezone: string | null;
}

/** The owner-set contact / currency / time zone (platform_settings, owner-only table: read with the service role). */
export async function getBillingContact(admin: SupabaseClient): Promise<BillingContact> {
  const { data } = await admin.from("platform_settings").select("billing_contact_email, billing_contact_phone, billing_message, billing_currency, billing_timezone").eq("id", true).maybeSingle();
  return {
    email: (data?.billing_contact_email as string | null) ?? null,
    phone: (data?.billing_contact_phone as string | null) ?? null,
    message: (data?.billing_message as string | null) ?? null,
    currency: (data?.billing_currency as string | null) ?? null,
    timezone: (data?.billing_timezone as string | null) ?? null,
  };
}

/** "Monday 15 December 2026", written in the owner's time zone (UTC until they've set one). */
export function formatEndDate(iso: string, timezone: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
  try {
    return new Date(iso).toLocaleDateString("en-GB", { ...opts, timeZone: timezone || "UTC" });
  } catch {
    return new Date(iso).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  }
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
