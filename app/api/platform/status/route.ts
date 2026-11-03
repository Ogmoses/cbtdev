import { NextResponse } from "next/server";
import { getPlatformFlags } from "@/lib/platformFlags";

/**
 * GET /api/platform/status — PUBLIC. Just enough for the maintenance screen and the
 * school sign-up page to know what to show. Contains nothing private.
 */
export async function GET() {
  const flags = await getPlatformFlags();
  return NextResponse.json(
    { maintenance: flags.maintenanceMode, message: flags.maintenanceMode ? flags.maintenanceMessage : null, signupsOpen: flags.signupsOpen },
    { headers: { "Cache-Control": "no-store" } }
  );
}
