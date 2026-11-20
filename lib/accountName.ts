/**
 * Rules for a person's display name (school admin, teacher, platform owner). Pure: used by the server route and testable alone.
 * Students are not allowed to rename themselves here: their sign-in password is built from their name.
 */
export const NAME_MIN = 2;
export const NAME_MAX = 100;

export function validateFullName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Enter your name." };
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length < NAME_MIN) return { ok: false, error: `Your name must be at least ${NAME_MIN} characters.` };
  if ([...name].length > NAME_MAX) return { ok: false, error: `Your name can be up to ${NAME_MAX} characters.` };
  if (/[\p{Cc}\p{Cf}<>]/u.test(name)) return { ok: false, error: "Your name contains characters that aren't allowed." };
  if (!/\p{L}/u.test(name)) return { ok: false, error: "Your name must contain letters." };
  return { ok: true, name };
}
