import nodemailer from "nodemailer";

/**
 * Server-only SMTP mailer. Never import this from a "use client" component.
 *
 * Deliberately generic SMTP rather than a provider-specific SDK (e.g. the
 * SendGrid SDK) — SMTP credentials work the same way across SendGrid,
 * Resend, Postmark, Mailgun, or a school's own mail server, so swapping
 * providers later is an env var change, not a code change.
 *
 * Required env vars (Vercel → Project Settings → Environment Variables):
 *   SMTP_HOST        e.g. smtp.sendgrid.net
 *   SMTP_PORT        e.g. 587
 *   SMTP_USER        for SendGrid this is literally the string "apikey"
 *   SMTP_PASS        for SendGrid this is your SendGrid API key
 *   SMTP_FROM_EMAIL  the verified "from" address (SendGrid requires this
 *                    address, or its domain, to be a verified sender)
 *   SMTP_FROM_NAME   optional, defaults to the school name passed in
 */

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP isn't configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS in your environment variables."
    );
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit TLS; 587/25 use STARTTLS instead
    auth: { user, pass },
  });
  return cachedTransporter;
}

/** A readable plain-text version of an HTML email (links kept as "label: url"). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return text && text !== href ? `${text}: ${href}` : href;
    })
    .replace(/<\/(p|div|h[1-6]|tr|li)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendMail(opts: { to: string; subject: string; html: string; fromName?: string }) {
  const fromEmail = process.env.SMTP_FROM_EMAIL;
  if (!fromEmail) {
    throw new Error("SMTP_FROM_EMAIL isn't set. Add it in your environment variables.");
  }
  const fromName = opts.fromName || process.env.SMTP_FROM_NAME || "School CBT Platform";

  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    // Mail with only an HTML part looks more like spam to inbox filters than mail that also has plain text.
    text: htmlToText(opts.html),
  });
}
