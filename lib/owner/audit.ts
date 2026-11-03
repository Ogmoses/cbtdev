import type { SupabaseClient } from "@supabase/supabase-js";

/** One audit entry. Never put secrets, passwords, invite links or student personal data in `details`. */
export interface AuditEntry {
  actorId: string;
  actorEmail?: string | null;
  /** Dotted verb, e.g. "school.approve". */
  action: string;
  targetType?: string;
  targetId?: string;
  schoolId?: string | null;
  schoolName?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Appends one entry to the tamper-evident audit log (migration 022).
 * Returns true if it was written. Callers decide what a failure means:
 * destructive actions (like deleting a school) should STOP when this returns false.
 */
export async function logAudit(admin: SupabaseClient, entry: AuditEntry): Promise<boolean> {
  try {
    const { error } = await admin.rpc("log_audit", {
      p_actor_id: entry.actorId,
      p_actor_email: entry.actorEmail ?? null,
      p_action: entry.action,
      p_target_type: entry.targetType ?? null,
      p_target_id: entry.targetId ?? null,
      p_school_id: entry.schoolId ?? null,
      p_school_name: entry.schoolName ?? null,
      p_details: entry.details ?? {},
    });
    if (error) {
      console.error("[audit] write failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[audit] write failed:", err);
    return false;
  }
}
