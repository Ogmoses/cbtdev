import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { allow } from "@/lib/rateLimit";

const BUCKET = "support-attachments";
const CATEGORIES = ["bug", "billing", "account", "question", "other"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const MAX_FILES = 3;
const MAX_FILE_BYTES = 1_400_000; // the app shrinks screenshots first; this is the hard server-side ceiling
const MAX_TOTAL_BYTES = 4_000_000; // stays under the host's ~4.5 MB request limit

/** What the file REALLY is, from its first bytes (the label a browser sends can be faked). */
function sniffImage(bytes: Uint8Array): { type: "image/png" | "image/jpeg" | "image/webp"; ext: string } | null {
  if (bytes.length > 12 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { type: "image/png", ext: "png" };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { type: "image/webp", ext: "webp" };
  return null;
}

/** Signed-in school admin / teacher of an ACTIVE school, or an error response. */
async function requireStaff() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };

  const admin = createAdminClient();
  const { data: me } = await admin.from("users").select("id, role, school_id, full_name, email").eq("id", auth.user.id).maybeSingle();
  if (!me || (me.role !== "super_admin" && me.role !== "teacher") || !me.school_id) {
    return { error: NextResponse.json({ error: "Only school admins and teachers can use support." }, { status: 403 }) };
  }
  const { data: school } = await admin.from("schools").select("status").eq("id", me.school_id).maybeSingle();
  if (school?.status !== "active") return { error: NextResponse.json({ error: "Your school isn't active." }, { status: 403 }) };
  return { supabase, admin, me };
}

/** GET — the signed-in person's visible tickets (admins: the whole school's; teachers: their own), with screenshot links. */
export async function GET() {
  const ctx = await requireStaff();
  if ("error" in ctx) return ctx.error;
  const { supabase, admin } = ctx;

  // Read with the person's own session so the database rules decide what they may see.
  const { data: tickets, error } = await supabase
    .from("support_tickets")
    .select("id, subject, category, priority, message, status, owner_reply, replied_at, created_at, created_by_name")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: "Couldn't load your requests." }, { status: 500 });

  const ids = (tickets ?? []).map((t) => t.id as string);
  const { data: files } = ids.length
    ? await supabase.from("support_ticket_attachments").select("id, ticket_id, path").in("ticket_id", ids)
    : { data: [] as { id: string; ticket_id: string; path: string }[] };

  const urls = new Map<string, string>();
  if ((files ?? []).length) {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(
      (files ?? []).map((f) => f.path),
      3600
    );
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }

  return NextResponse.json({
    tickets: (tickets ?? []).map((t) => ({
      id: t.id,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      message: t.message,
      status: t.status,
      ownerReply: t.owner_reply,
      repliedAt: t.replied_at,
      createdAt: t.created_at,
      sentBy: t.created_by_name,
      screenshots: (files ?? []).filter((f) => f.ticket_id === t.id).map((f) => ({ id: f.id, url: urls.get(f.path) ?? null })).filter((f) => f.url),
    })),
  });
}

/** POST (multipart) — send a request to the platform owner: subject, category, priority, message, up to 3 screenshots. */
export async function POST(req: NextRequest) {
  const ctx = await requireStaff();
  if ("error" in ctx) return ctx.error;
  const { admin, me } = ctx;

  if (!(await allow(admin, `support:${me.id}`, 5, 3600))) {
    return NextResponse.json({ error: "You've sent several requests in a short time. Please wait a while before sending another." }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Couldn't read your request. Try again." }, { status: 400 });

  const subject = String(form.get("subject") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();
  const category = String(form.get("category") ?? "question");
  const priority = String(form.get("priority") ?? "normal");
  if (!subject || subject.length > 120) return NextResponse.json({ error: "Add a subject (up to 120 characters)." }, { status: 400 });
  if (!message || message.length > 4000) return NextResponse.json({ error: "Describe the problem (up to 4000 characters)." }, { status: 400 });
  if (!CATEGORIES.includes(category)) return NextResponse.json({ error: "Pick a valid category." }, { status: 400 });
  if (!PRIORITIES.includes(priority)) return NextResponse.json({ error: "Pick a valid priority." }, { status: 400 });

  const files = form.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
  if (files.length > MAX_FILES) return NextResponse.json({ error: `You can attach up to ${MAX_FILES} screenshots.` }, { status: 400 });

  const prepared: { buffer: Buffer; type: string; ext: string }[] = [];
  let total = 0;
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) return NextResponse.json({ error: "A screenshot is too large. Try a smaller one." }, { status: 413 });
    total += f.size;
    if (total > MAX_TOTAL_BYTES) return NextResponse.json({ error: "The screenshots are too large together. Attach fewer or smaller ones." }, { status: 413 });
    const buffer = Buffer.from(await f.arrayBuffer());
    const kind = sniffImage(buffer);
    if (!kind) return NextResponse.json({ error: "Screenshots must be PNG, JPEG or WebP images." }, { status: 400 });
    prepared.push({ buffer, type: kind.type, ext: kind.ext });
  }

  const ticketId = crypto.randomUUID();
  const uploaded: { path: string; type: string; size: number }[] = [];
  const cleanup = async () => {
    if (uploaded.length) await admin.storage.from(BUCKET).remove(uploaded.map((u) => u.path));
  };

  for (const p of prepared) {
    const path = `${me.school_id}/${ticketId}/${crypto.randomUUID()}.${p.ext}`;
    const { error } = await admin.storage.from(BUCKET).upload(path, p.buffer, { contentType: p.type, upsert: false });
    if (error) {
      await cleanup();
      return NextResponse.json({ error: "Couldn't upload a screenshot. Nothing was sent." }, { status: 500 });
    }
    uploaded.push({ path, type: p.type, size: p.buffer.length });
  }

  const { error: ticketError } = await admin.from("support_tickets").insert({
    id: ticketId,
    school_id: me.school_id,
    created_by: me.id,
    created_by_name: me.full_name,
    created_by_email: me.email ?? null,
    created_by_role: me.role,
    subject,
    category,
    priority,
    message,
  });
  if (ticketError) {
    await cleanup();
    return NextResponse.json({ error: "Couldn't send your request. Please try again." }, { status: 500 });
  }

  if (uploaded.length) {
    const { error: attachError } = await admin
      .from("support_ticket_attachments")
      .insert(uploaded.map((u) => ({ ticket_id: ticketId, path: u.path, content_type: u.type, size_bytes: u.size })));
    if (attachError) {
      await admin.from("support_tickets").delete().eq("id", ticketId); // attachment rows cascade
      await cleanup();
      return NextResponse.json({ error: "Couldn't send your request. Please try again." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, id: ticketId });
}
