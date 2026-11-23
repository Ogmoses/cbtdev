import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedPhotoUrl } from "@/lib/studentPhotos";

/**
 * GET /api/account/photo -> { url } : a link (good for an hour) to the signed-in person's OWN passport photo, or null.
 * The photo lives in a private bucket, so the browser can't read it directly. The person comes from their login,
 * never from the request, so nobody can ask for anyone else's photo here.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return NextResponse.json({ url: null }, { headers });

    const admin = createAdminClient();
    const { data: me } = await admin.from("users").select("photo_url").eq("id", auth.user.id).maybeSingle();
    const url = await signedPhotoUrl(admin, (me?.photo_url as string | null) ?? null);
    return NextResponse.json({ url }, { headers });
  } catch {
    // a missing picture must never break a page
    return NextResponse.json({ url: null }, { headers });
  }
}
