/**
 * HTML email templates. Kept deliberately simple/table-free-but-inline-styled
 * — email clients (Outlook especially, which schools disproportionately use)
 * don't render Tailwind, webfonts, or most modern CSS, so this hand-codes
 * the same accent colors as tailwind.config.ts (crimson #AB1509, cream
 * #FFF7D3, ink #1A1A1A) with inline styles and a web-safe font stack, so the
 * email *looks* like it came from the same place as the site without
 * depending on anything that might get stripped by a mail client.
 */

function shell(schoolName: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#FFF7D3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF7D3;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(26,26,26,0.08);">
            <tr>
              <td style="background-color:#AB1509;padding:20px 28px;">
                <span style="color:#ffffff;font-size:15px;font-weight:600;">${escapeHtml(schoolName)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;background-color:#F8F9FA;">
                <span style="color:#1A1A1A80;font-size:11.5px;">This is an automated message from ${escapeHtml(schoolName)}'s CBT platform. If you weren't expecting it, you can ignore it.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
    <tr>
      <td style="border-radius:10px;background-color:#AB1509;">
        <a href="${url}" style="display:inline-block;padding:13px 24px;color:#ffffff;font-size:13.5px;font-weight:600;text-decoration:none;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

export function inviteEmailHtml(opts: { schoolName: string; fullName: string; link: string; expiresInHours: number }): string {
  const body = `
    <h1 style="margin:0 0 12px;color:#1A1A1A;font-size:17px;font-weight:600;">Welcome to ${escapeHtml(opts.schoolName)}</h1>
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">Hi ${escapeHtml(opts.fullName)},</p>
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">An account has been created for you on the school's CBT platform. Set a password to get started:</p>
    ${button("Set your password", opts.link)}
    <p style="margin:16px 0 0;color:#1A1A1A80;font-size:12px;line-height:1.6;">This link expires in ${opts.expiresInHours} hours. If it stops working, ask your admin to resend it from Students &amp; Teachers.</p>
    <p style="margin:8px 0 0;color:#1A1A1A80;font-size:11px;line-height:1.6;word-break:break-all;">Or paste this into your browser: ${opts.link}</p>
  `;
  return shell(opts.schoolName, body);
}

/**
 * `requestedBy`: "admin" (default) when a school admin sent the reset from the People page,
 * "self" when the person used "Forgot password?" on the login screen themselves.
 */
export function resetEmailHtml(opts: { schoolName: string; fullName: string; link: string; expiresInHours: number; requestedBy?: "admin" | "self" }): string {
  const intro =
    opts.requestedBy === "self"
      ? `We received a request to reset the password for your account at ${escapeHtml(opts.schoolName)}. Set a new password here:`
      : `Your admin at ${escapeHtml(opts.schoolName)} requested a password reset for your account. Set a new password here:`;
  const body = `
    <h1 style="margin:0 0 12px;color:#1A1A1A;font-size:17px;font-weight:600;">Reset your password</h1>
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">Hi ${escapeHtml(opts.fullName)},</p>
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">${intro}</p>
    ${button("Reset your password", opts.link)}
    <p style="margin:16px 0 0;color:#1A1A1A80;font-size:12px;line-height:1.6;">This link expires in ${opts.expiresInHours} hours. Didn't request this? You can ignore it — your password won't change unless this link is used.</p>
    <p style="margin:8px 0 0;color:#1A1A1A80;font-size:11px;line-height:1.6;word-break:break-all;">Or paste this into your browser: ${opts.link}</p>
  `;
  return shell(opts.schoolName, body);
}

export function verifySchoolEmailHtml(opts: { schoolName: string; fullName: string; link: string; expiresInHours: number }): string {
  const body = `
    <h1 style="margin:0 0 12px;color:#1A1A1A;font-size:17px;font-weight:600;">Confirm your email</h1>
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">Hi ${escapeHtml(opts.fullName)},</p>
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">Thanks for registering ${escapeHtml(opts.schoolName)}. Confirm this email address to finish your request:</p>
    ${button("Confirm my email", opts.link)}
    <p style="margin:16px 0 0;color:#1A1A1A80;font-size:12px;line-height:1.6;">After you confirm, your school waits for approval. We'll email you your school's link as soon as it's approved. This link expires in ${opts.expiresInHours} hours.</p>
    <p style="margin:8px 0 0;color:#1A1A1A80;font-size:11px;line-height:1.6;word-break:break-all;">Or paste this into your browser: ${opts.link}</p>
  `;
  return shell(opts.schoolName, body);
}

export function schoolApprovedEmailHtml(opts: { schoolName: string; fullName: string; link: string }): string {
  const body = `
    <h1 style="margin:0 0 12px;color:#1A1A1A;font-size:17px;font-weight:600;">${escapeHtml(opts.schoolName)} is approved</h1>
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">Hi ${escapeHtml(opts.fullName)},</p>
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">Your school is ready. This is its own link — bookmark it and share it with your teachers and students:</p>
    ${button("Open your school", opts.link)}
    <p style="margin:16px 0 0;color:#1A1A1A80;font-size:12px;line-height:1.6;">Sign in with the email and password you registered with (the Teacher / Admin tab), then add your classes, subjects, teachers and students.</p>
    <p style="margin:8px 0 0;color:#1A1A1A80;font-size:11px;line-height:1.6;word-break:break-all;">Your link: ${opts.link}</p>
  `;
  return shell(opts.schoolName, body);
}

export function ownerNewSignupEmailHtml(opts: { schoolName: string; adminName: string; adminEmail: string; link: string }): string {
  const body = `
    <h1 style="margin:0 0 12px;color:#1A1A1A;font-size:17px;font-weight:600;">A school is waiting for approval</h1>
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;"><strong>${escapeHtml(opts.schoolName)}</strong> has registered and confirmed its admin's email.</p>
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">Admin: ${escapeHtml(opts.adminName)} (${escapeHtml(opts.adminEmail)})</p>
    ${button("Review in the console", opts.link)}
  `;
  return shell("Platform console", body);
}


/** Sent to a school when the platform owner replies to, or changes the status of, one of its support requests. */
export function supportUpdateEmailHtml(opts: {
  schoolName: string;
  recipientName: string;
  subject: string;
  statusLabel: string;
  reply: string | null;
  link: string;
}): string {
  const reply = opts.reply
    ? `<p style="margin:14px 0 4px;color:#1A1A1A80;font-size:11.5px;text-transform:uppercase;letter-spacing:0.04em;">Reply</p>
       <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;white-space:pre-line;">${escapeHtml(opts.reply)}</p>`
    : "";
  const body = `
    <h1 style="margin:0 0 12px;color:#1A1A1A;font-size:17px;font-weight:600;">An update on your support request</h1>
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">Hi ${escapeHtml(opts.recipientName)},</p>
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;"><strong>${escapeHtml(opts.subject)}</strong></p>
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">Status: <strong>${escapeHtml(opts.statusLabel)}</strong></p>
    ${reply}
    ${button("View your request", opts.link)}`;
  return shell(opts.schoolName, body);
}

/** Sent to a school's admins about 7 days before its term access ends. */
export function renewalReminderEmailHtml(opts: {
  schoolName: string;
  fullName: string;
  endsOn: string; // already formatted, e.g. "Monday 15 December 2026"
  daysLeft: number;
  contactEmail: string | null;
  contactPhone: string | null;
  message: string | null;
}): string {
  const contact = [opts.contactEmail ? `Email: ${escapeHtml(opts.contactEmail)}` : "", opts.contactPhone ? `Phone: ${escapeHtml(opts.contactPhone)}` : ""].filter(Boolean).join("<br>");
  const note = opts.message ? `<p style="margin:0 0 12px;color:#1A1A1A;font-size:13.5px;line-height:1.6;white-space:pre-line;">${escapeHtml(opts.message)}</p>` : "";
  const body = `
    <h1 style="margin:0 0 12px;color:#1A1A1A;font-size:17px;font-weight:600;">Your school's access is ending soon</h1>
    <p style="margin:0 0 12px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">Hi ${escapeHtml(opts.fullName)},</p>
    <p style="margin:0 0 12px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">Access to the CBT platform for <strong>${escapeHtml(opts.schoolName)}</strong> ends on <strong>${escapeHtml(opts.endsOn)}</strong> (${opts.daysLeft} day${opts.daysLeft === 1 ? "" : "s"} from now). After that date, staff and students will see a renewal notice instead of the dashboard.</p>
    ${note}
    <p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.6;">To renew, please get in touch${contact ? ":" : " with the platform administrator."}</p>
    ${contact ? `<p style="margin:0 0 6px;color:#1A1A1A;font-size:13.5px;line-height:1.7;">${contact}</p>` : ""}
    <p style="margin:12px 0 0;color:#1A1A1A80;font-size:12px;line-height:1.6;">Exams already in progress when access ends can still be finished.</p>`;
  return shell(opts.schoolName, body);
}
