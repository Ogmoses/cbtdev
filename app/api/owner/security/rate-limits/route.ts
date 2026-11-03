import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/owner/requireOwner";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/owner/audit";

/**
 * The allowances the app enforces, by key prefix. These mirror the numbers in
 * /api/schools/register, /api/schools/resend-verification and /api/auth/resolve-student-email.
 * If one of those changes, update it here too — this table only decides the "Blocked" label.
 */
const RULES: Record<string, { max: number; windowSeconds: number; label: string }> = {
  register: { max: 5, windowSeconds: 3600, label: "School sign-ups (per connection)" },
  resend: { max: 5, windowSeconds: 3600, label: "Verification resends (per connection)" },
  "resend-email": { max: 3, windowSeconds: 3600, label: "Verification resends (per email)" },
  support: { max: 5, windowSeconds: 3600, label: "Support tickets (per user)" },
  "lookup-miss": { max: 100, windowSeconds: 600, label: "Student ID lookups that missed (per connection)" },
};

function prefixOf(key: string) {
  const i = key.indexOf(":");
  return i === -1 ? key : key.slice(0, i);
}

/** GET — rate-limit counters, busiest first. Optional ?prefix=register */
export async function GET(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const prefix = req.nextUrl.searchParams.get("prefix")?.trim();
  const admin = createAdminClient();
  // "login-event:" keys are internal bookkeeping for the live feed (one per person), not security blocks: keep them out of this list.
  let q = admin.from("rate_limits").select("key, window_start, hits").not("key", "like", "login-event:%").order("hits", { ascending: false }).limit(200);
  if (prefix) q = q.like("key", `${prefix.replace(/[%_]/g, "")}:%`);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: "Couldn't load the rate limits." }, { status: 500 });

  const now = Date.now();
  const rows = (data ?? []).map((r) => {
    const rule = RULES[prefixOf(r.key as string)];
    const windowEnds = rule ? new Date(r.window_start as string).getTime() + rule.windowSeconds * 1000 : null;
    const active = windowEnds === null ? null : windowEnds > now;
    return {
      key: r.key as string,
      hits: r.hits as number,
      windowStart: r.window_start as string,
      rule: rule ? { max: rule.max, windowSeconds: rule.windowSeconds, label: rule.label } : null,
      windowActive: active,
      blocked: rule && active ? (r.hits as number) > rule.max : false,
      resetsAt: windowEnds && active ? new Date(windowEnds).toISOString() : null,
    };
  });
  return NextResponse.json({ rows, prefixes: Object.entries(RULES).map(([p, r]) => ({ prefix: p, label: r.label })) });
}

/** DELETE — { key }: clears one counter, which immediately un-blocks that connection / email. */
export async function DELETE(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { key } = await req.json().catch(() => ({}));
  if (typeof key !== "string" || !key) return NextResponse.json({ error: "key is required." }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin.from("rate_limits").select("key, hits").eq("key", key).maybeSingle();
  if (!row) return NextResponse.json({ error: "That entry no longer exists." }, { status: 404 });

  const ok = await logAudit(admin, {
    actorId: guard.userId,
    actorEmail: guard.email,
    action: "security.rate_limit_cleared",
    targetType: "rate_limit",
    targetId: prefixOf(key), // the kind of limit only: the full key can hold someone's IP or email
    details: { kind: prefixOf(key), hits_cleared: row.hits },
  });
  if (!ok) return NextResponse.json({ error: "Couldn't write the audit record, so nothing was changed. Try again." }, { status: 500 });

  const { error } = await admin.from("rate_limits").delete().eq("key", key);
  if (error) return NextResponse.json({ error: "Couldn't clear that entry." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
