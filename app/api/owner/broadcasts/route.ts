import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireOwner } from "@/lib/owner/requireOwner";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/owner/audit";

const SEVERITIES = ["info", "warning", "critical"] as const;
const AUDIENCES = ["all_staff", "admins", "teachers"] as const;

type Checked =
  | { ok: false; error: string }
  | { ok: true; title: string; body: string; severity: string; audience: string; allSchools: boolean; schoolIds: string[]; startsAt: Date | null; endsAt: Date | null };

/** The same rules for sending a new broadcast and for editing one. `startsAt` is null when none was given. */
function check(b: Record<string, unknown>): Checked {
  const title = String(b.title ?? "").trim();
  const body = String(b.body ?? "").trim();
  const severity = String(b.severity ?? "info");
  const audience = String(b.audience ?? "all_staff");
  const allSchools = b.allSchools !== false;
  const schoolIds: string[] = Array.isArray(b.schoolIds) ? Array.from(new Set(b.schoolIds.map(String))) : [];

  if (!title || title.length > 120) return { ok: false, error: "Give the broadcast a title (up to 120 characters)." };
  if (!body || body.length > 1000) return { ok: false, error: "Write the message (up to 1000 characters)." };
  if (!(SEVERITIES as readonly string[]).includes(severity)) return { ok: false, error: "Pick a valid importance level." };
  if (!(AUDIENCES as readonly string[]).includes(audience)) return { ok: false, error: "Pick who it is for." };
  if (!allSchools && (schoolIds.length === 0 || schoolIds.length > 200)) return { ok: false, error: "Choose at least one school, or send it to all schools." };

  const startsAt = b.startsAt ? new Date(String(b.startsAt)) : null;
  const endsAt = b.endsAt ? new Date(String(b.endsAt)) : null;
  if (startsAt && Number.isNaN(startsAt.getTime())) return { ok: false, error: "The start time isn't valid." };
  if (endsAt && Number.isNaN(endsAt.getTime())) return { ok: false, error: "The end time isn't valid." };
  return { ok: true, title, body, severity, audience, allSchools, schoolIds, startsAt, endsAt };
}

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
  const targetIds = new Map<string, string[]>();
  for (const t of targets ?? []) {
    const names = targetNames.get(t.announcement_id) ?? [];
    names.push(schoolName.get(t.school_id) ?? "(deleted school)");
    targetNames.set(t.announcement_id, names);
    const idList = targetIds.get(t.announcement_id) ?? [];
    idList.push(t.school_id);
    targetIds.set(t.announcement_id, idList);
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
      schoolIds: targetIds.get(r.id as string) ?? [],
      startsAt: r.starts_at as string,
      endsAt: (r.ends_at as string | null) ?? null,
      endedAt: (r.ended_at as string | null) ?? null,
      status,
      dismissed: dismissedCount.get(r.id as string) ?? 0,
    };
  });

  return NextResponse.json({ broadcasts, schools: (schools ?? []).map((s) => ({ id: s.id, name: s.name, status: s.status })) });
}

/** POST — send a broadcast. The audit record is written first; if it can't be, nothing is sent. `reusedFrom` (optional) notes which earlier broadcast it was copied from. */
export async function POST(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const b = await req.json().catch(() => ({}));
  const c = check(b);
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: 400 });

  const now = Date.now();
  const startsAt = c.startsAt ?? new Date(now);
  const endsAt = c.endsAt;
  if (endsAt && (endsAt.getTime() <= startsAt.getTime() || endsAt.getTime() <= now)) {
    return NextResponse.json({ error: "The end time must be in the future and after the start." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!c.allSchools) {
    const { data: found } = await admin.from("schools").select("id").in("id", c.schoolIds);
    if ((found ?? []).length !== c.schoolIds.length) return NextResponse.json({ error: "One of the chosen schools no longer exists. Refresh and try again." }, { status: 409 });
  }

  const id = crypto.randomUUID();
  const reusedFrom = typeof b.reusedFrom === "string" && b.reusedFrom.length <= 40 ? b.reusedFrom : null;
  const auditBase = { actorId: guard.userId, actorEmail: guard.email, targetType: "broadcast", targetId: id };
  const details = {
    title: c.title,
    severity: c.severity,
    audience: c.audience,
    all_schools: c.allSchools,
    school_count: c.allSchools ? null : c.schoolIds.length,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt?.toISOString() ?? null,
    ...(reusedFrom ? { reused_from: reusedFrom } : {}),
  };
  if (!(await logAudit(admin, { ...auditBase, action: "broadcast.create", details }))) {
    return NextResponse.json({ error: "Couldn't write the audit record, so nothing was sent. Try again." }, { status: 500 });
  }

  const { error: insertError } = await admin.from("announcements").insert({
    id,
    title: c.title,
    body: c.body,
    severity: c.severity,
    audience: c.audience,
    all_schools: c.allSchools,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt?.toISOString() ?? null,
    created_by: guard.userId,
  });
  if (insertError) {
    await logAudit(admin, { ...auditBase, action: "broadcast.create_failed", details: { error: insertError.message } });
    return NextResponse.json({ error: "Couldn't send the broadcast. Nothing was sent." }, { status: 500 });
  }

  if (!c.allSchools) {
    const { error: linkError } = await admin.from("announcement_schools").insert(c.schoolIds.map((school_id) => ({ announcement_id: id, school_id })));
    if (linkError) {
      await admin.from("announcements").delete().eq("id", id); // links cascade; a half-made broadcast never lingers
      await logAudit(admin, { ...auditBase, action: "broadcast.create_failed", details: { error: linkError.message } });
      return NextResponse.json({ error: "Couldn't send the broadcast. Nothing was sent." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, id });
}

/**
 * PATCH
 *  - { id, action: "end" }  stops a live broadcast now, or cancels a scheduled one. The record is kept.
 *  - { id, action: "edit", title, body, severity, audience, allSchools, schoolIds, startsAt?, endsAt?, reshow? }
 *    changes a live or scheduled broadcast in one all-or-nothing step (migration 029). A broadcast that has
 *    already started keeps its original start time. `reshow: true` clears everyone's "I closed this" marks so
 *    people who already dismissed it see it again. Ended broadcasts can't be edited (use "Reuse" to send a copy).
 */
export async function PATCH(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const b = await req.json().catch(() => ({}));
  const id = typeof b.id === "string" ? b.id : "";
  if (!id || (b.action !== "end" && b.action !== "edit")) return NextResponse.json({ error: "id and action (\"end\" or \"edit\") are required." }, { status: 400 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("announcements")
    .select("id, title, body, severity, audience, all_schools, starts_at, ends_at, ended_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Broadcast not found." }, { status: 404 });
  if (row.ended_at || (row.ends_at && new Date(row.ends_at as string).getTime() <= Date.now())) {
    return NextResponse.json({ error: b.action === "edit" ? "That broadcast has already ended. Use Reuse to send a copy." : "That broadcast has already ended." }, { status: 409 });
  }

  if (b.action === "end") {
    if (!(await logAudit(admin, { actorId: guard.userId, actorEmail: guard.email, action: "broadcast.end", targetType: "broadcast", targetId: id, details: { title: row.title } }))) {
      return NextResponse.json({ error: "Couldn't write the audit record, so nothing was changed. Try again." }, { status: 500 });
    }
    const { error } = await admin.from("announcements").update({ ended_at: new Date().toISOString() }).eq("id", id);
    if (error) return NextResponse.json({ error: "Couldn't end the broadcast." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ---- edit
  const c = check(b);
  if (!c.ok) return NextResponse.json({ error: c.error }, { status: 400 });

  const now = Date.now();
  const alreadyStarted = new Date(row.starts_at as string).getTime() <= now;
  const startsAt = alreadyStarted ? new Date(row.starts_at as string) : (c.startsAt ?? new Date(now));
  const endsAt = c.endsAt;
  if (endsAt && (endsAt.getTime() <= startsAt.getTime() || endsAt.getTime() <= now)) {
    return NextResponse.json({ error: "The end time must be in the future and after the start." }, { status: 400 });
  }
  if (!c.allSchools) {
    const { data: found } = await admin.from("schools").select("id").in("id", c.schoolIds);
    if ((found ?? []).length !== c.schoolIds.length) return NextResponse.json({ error: "One of the chosen schools no longer exists. Refresh and try again." }, { status: 409 });
  }

  const { data: oldLinks } = await admin.from("announcement_schools").select("school_id").eq("announcement_id", id);
  const oldSchoolIds = (oldLinks ?? []).map((l) => l.school_id as string).sort();
  const newSchoolIds = c.allSchools ? [] : [...c.schoolIds].sort();
  const reshow = b.reshow === true;

  const changed: string[] = [];
  if (c.title !== row.title) changed.push("title");
  if (c.body !== row.body) changed.push("message");
  if (c.severity !== row.severity) changed.push("importance");
  if (c.audience !== row.audience) changed.push("audience");
  if (c.allSchools !== row.all_schools || oldSchoolIds.join() !== newSchoolIds.join()) changed.push("schools");
  if (!alreadyStarted && startsAt.getTime() !== new Date(row.starts_at as string).getTime()) changed.push("start time");
  if ((endsAt?.getTime() ?? null) !== (row.ends_at ? new Date(row.ends_at as string).getTime() : null)) changed.push("end time");
  if (changed.length === 0 && !reshow) return NextResponse.json({ ok: true, changed: false });

  const auditBase = { actorId: guard.userId, actorEmail: guard.email, targetType: "broadcast", targetId: id };
  if (!(await logAudit(admin, { ...auditBase, action: "broadcast.edit", details: { title: c.title, changed, reshow } }))) {
    return NextResponse.json({ error: "Couldn't write the audit record, so nothing was changed. Try again." }, { status: 500 });
  }

  const { error } = await admin.rpc("edit_announcement", {
    p_id: id,
    p_title: c.title,
    p_body: c.body,
    p_severity: c.severity,
    p_audience: c.audience,
    p_all_schools: c.allSchools,
    p_school_ids: c.allSchools ? [] : c.schoolIds,
    p_starts_at: startsAt.toISOString(),
    p_ends_at: endsAt?.toISOString() ?? null,
    p_reshow: reshow,
  });
  if (error) {
    await logAudit(admin, { ...auditBase, action: "broadcast.edit_failed", details: { error: error.message } });
    if (error.message.includes("broadcast_ended")) return NextResponse.json({ error: "That broadcast has already ended. Use Reuse to send a copy." }, { status: 409 });
    if (error.message.includes("broadcast_not_found")) return NextResponse.json({ error: "Broadcast not found." }, { status: 404 });
    return NextResponse.json({ error: "Couldn't save the changes. Nothing was changed." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, changed: true });
}
