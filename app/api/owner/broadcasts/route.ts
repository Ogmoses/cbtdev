import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireOwner } from "@/lib/owner/requireOwner";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/owner/audit";

const SEVERITIES = ["info", "warning", "critical"] as const;
const AUDIENCES = ["all_staff", "admins", "teachers"] as const;

/** GET — every broadcast (newest first) with who it targets and how many people closed it, plus the school list for the composer. */
export async function GET() {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("announcements")
    .select("id, title, body, severity, audience, all_schools, starts_at, ends_at, ended_at, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: "Couldn't load broadcasts." }, { status: 500 });

  const ids = (rows ?? []).map((r) => r.id as string);
  const [{ data: targets }, { data: dismissals }, { data: schools }] = await Promise.all([
    ids.length ? admin.from("announcement_schools").select("announcement_id, school_id").in("announcement_id", ids) : Promise.resolve({ data: [] as { announcement_id: string; school_id: string }[] }),
    ids.length ? admin.from("announcement_dismissals").select("announcement_id").in("announcement_id", ids) : Promise.resolve({ data: [] as { announcement_id: string }[] }),
    admin.from("schools").select("id, name, status").order("name"),
  ]);

  const schoolName = new Map((schools ?? []).map((s) => [s.id as string, s.name as string]));
  const targetNames = new Map<string, string[]>();
  for (const t of targets ?? []) {
    const list = targetNames.get(t.announcement_id) ?? [];
    list.push(schoolName.get(t.school_id) ?? "(deleted school)");
    targetNames.set(t.announcement_id, list);
  }
  const dismissedCount = new Map<string, number>();
  for (const d of dismissals ?? []) dismissedCount.set(d.announcement_id, (dismissedCount.get(d.announcement_id) ?? 0) + 1);

  const now = Date.now();
  const broadcasts = (rows ?? []).map((r) => {
    const startsAt = new Date(r.starts_at as string).getTime();
    const endsAt = r.ends_at ? new Date(r.ends_at as string).getTime() : null;
    const status = r.ended_at || (endsAt !== null && endsAt <= now) ? "ended" : startsAt > now ? "scheduled" : "live";
    return {
      id: r.id as string,
      title: r.title as string,
      body: r.body as string,
      severity: r.severity as string,
      audience: r.audience as string,
      allSchools: r.all_schools as boolean,
      schoolNames: targetNames.get(r.id as string) ?? [],
      startsAt: r.starts_at as string,
      endsAt: (r.ends_at as string | null) ?? null,
      endedAt: (r.ended_at as string | null) ?? null,
      status,
      dismissed: dismissedCount.get(r.id as string) ?? 0,
    };
  });

  return NextResponse.json({ broadcasts, schools: (schools ?? []).map((s) => ({ id: s.id, name: s.name, status: s.status })) });
}

/** POST — send a broadcast. The audit record is written first; if it can't be, nothing is sent. */
export async function POST(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const b = await req.json().catch(() => ({}));
  const title = String(b.title ?? "").trim();
  const body = String(b.body ?? "").trim();
  const severity = String(b.severity ?? "info");
  const audience = String(b.audience ?? "all_staff");
  const allSchools = b.allSchools !== false;
  const schoolIds: string[] = Array.isArray(b.schoolIds) ? Array.from(new Set(b.schoolIds.map(String))) : [];

  if (!title || title.length > 120) return NextResponse.json({ error: "Give the broadcast a title (up to 120 characters)." }, { status: 400 });
  if (!body || body.length > 1000) return NextResponse.json({ error: "Write the message (up to 1000 characters)." }, { status: 400 });
  if (!(SEVERITIES as readonly string[]).includes(severity)) return NextResponse.json({ error: "Pick a valid importance level." }, { status: 400 });
  if (!(AUDIENCES as readonly string[]).includes(audience)) return NextResponse.json({ error: "Pick who it is for." }, { status: 400 });
  if (!allSchools && (schoolIds.length === 0 || schoolIds.length > 200)) return NextResponse.json({ error: "Choose at least one school, or send it to all schools." }, { status: 400 });

  const now = Date.now();
  const startsAt = b.startsAt ? new Date(b.startsAt) : new Date(now);
  const endsAt = b.endsAt ? new Date(b.endsAt) : null;
  if (Number.isNaN(startsAt.getTime())) return NextResponse.json({ error: "The start time isn't valid." }, { status: 400 });
  if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime() || endsAt.getTime() <= now)) {
    return NextResponse.json({ error: "The end time must be in the future and after the start." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!allSchools) {
    const { data: found } = await admin.from("schools").select("id").in("id", schoolIds);
    if ((found ?? []).length !== schoolIds.length) return NextResponse.json({ error: "One of the chosen schools no longer exists. Refresh and try again." }, { status: 409 });
  }

  const id = crypto.randomUUID();
  const auditBase = { actorId: guard.userId, actorEmail: guard.email, targetType: "broadcast", targetId: id };
  const details = { title, severity, audience, all_schools: allSchools, school_count: allSchools ? null : schoolIds.length, starts_at: startsAt.toISOString(), ends_at: endsAt?.toISOString() ?? null };
  if (!(await logAudit(admin, { ...auditBase, action: "broadcast.create", details }))) {
    return NextResponse.json({ error: "Couldn't write the audit record, so nothing was sent. Try again." }, { status: 500 });
  }

  const { error: insertError } = await admin.from("announcements").insert({
    id,
    title,
    body,
    severity,
    audience,
    all_schools: allSchools,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt?.toISOString() ?? null,
    created_by: guard.userId,
  });
  if (insertError) {
    await logAudit(admin, { ...auditBase, action: "broadcast.create_failed", details: { error: insertError.message } });
    return NextResponse.json({ error: "Couldn't send the broadcast. Nothing was sent." }, { status: 500 });
  }

  if (!allSchools) {
    const { error: linkError } = await admin.from("announcement_schools").insert(schoolIds.map((school_id) => ({ announcement_id: id, school_id })));
    if (linkError) {
      await admin.from("announcements").delete().eq("id", id); // links cascade; a half-made broadcast never lingers
      await logAudit(admin, { ...auditBase, action: "broadcast.create_failed", details: { error: linkError.message } });
      return NextResponse.json({ error: "Couldn't send the broadcast. Nothing was sent." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, id });
}

/** PATCH — { id, action: "end" }: stops a live broadcast now, or cancels a scheduled one. The record is kept. */
export async function PATCH(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const { id, action } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || action !== "end") return NextResponse.json({ error: "id and action \"end\" are required." }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin.from("announcements").select("id, title, ended_at, ends_at").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Broadcast not found." }, { status: 404 });
  if (row.ended_at || (row.ends_at && new Date(row.ends_at as string).getTime() <= Date.now())) {
    return NextResponse.json({ error: "That broadcast has already ended." }, { status: 409 });
  }

  if (!(await logAudit(admin, { actorId: guard.userId, actorEmail: guard.email, action: "broadcast.end", targetType: "broadcast", targetId: id, details: { title: row.title } }))) {
    return NextResponse.json({ error: "Couldn't write the audit record, so nothing was changed. Try again." }, { status: 500 });
  }
  const { error } = await admin.from("announcements").update({ ended_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't end the broadcast." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
