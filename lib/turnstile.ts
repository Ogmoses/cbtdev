/**
 * Cloudflare Turnstile — a free "are you a person?" check that's usually
 * invisible. Entirely optional: with no keys configured, every check passes
 * and nothing changes. To turn it on, set TURNSTILE_SECRET_KEY (server) and
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY (browser) in Vercel.
 */
export async function verifyTurnstile(token: unknown, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured — no check
  if (typeof token !== "string" || !token) return false;

  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false; // can't confirm — treat as not verified; the person just retries
  }
}
