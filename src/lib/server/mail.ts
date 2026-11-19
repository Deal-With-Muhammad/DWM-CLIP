import "server-only";

import { randomBytes } from "node:crypto";
import { connect } from "node:tls";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { setting } from "@/lib/server/settings";

// Sign-in codes and notifications go out through Cloudflare Email Service (the `EMAIL` binding in
// wrangler.jsonc; dealwithmuhammad.com is onboarded under Email Service → Email Sending). That
// service gives a new account a small daily quota (200 emails, shared by every DWM site), and on
// a busy day it runs out: every sign-in then failed. So when Cloudflare refuses an email, the
// same email goes out through Gmail (SMTP_USER / SMTP_PASS) instead, and the other way round on
// a host without the binding.

/** Thrown when neither service will take another email for now. */
export class MailLimitError extends Error {}

/** Cloudflare's "no more today" and Gmail's "550 5.4.5 Daily user sending limit exceeded". */
const isLimit = (e: unknown) => /LIMIT|QUOTA|5\.4\.5|too many/i.test(`${(e as { code?: string })?.code ?? ""} ${e instanceof Error ? e.message : String(e)}`);

/** After Cloudflare refuses for its quota, skip it for a while instead of asking on every email. */
let cloudflareFullUntil = 0;

type EmailBinding = {
  send(message: { from: string | { email: string; name: string }; to: string; subject: string; text: string; html: string }): Promise<{ messageId: string }>;
};

function emailBinding(): EmailBinding | null {
  try {
    const b = (getCloudflareContext().env as unknown as Record<string, unknown>).EMAIL;
    return b && typeof (b as EmailBinding).send === "function" ? (b as EmailBinding) : null;
  } catch {
    return null;
  }
}

const page = (code: string, link: string) => `<div style="font-family:system-ui,sans-serif;max-width:440px;margin:0 auto;padding:32px 24px;background:#f6f7f7;color:#14201e">
  <p style="font-size:15px;color:#0e9384;margin:0">DWM Clip</p>
  <h1 style="font-weight:600;font-size:24px;margin:12px 0 8px">Your sign-in code</h1>
  <p style="font-size:15px;line-height:1.5;margin:0 0 20px">Enter this code on the sign-in page. It works for 10 minutes.</p>
  <p style="font-family:monospace;font-size:34px;letter-spacing:.35em;background:#0e9384;color:#ffffff;text-align:center;padding:16px;border-radius:14px;margin:0 0 20px">${code}</p>
  <p style="font-size:14px;line-height:1.5;margin:0 0 24px">Or <a href="${link}" style="color:#0e9384">sign in with this link</a> on this device.</p>
  <p style="font-size:12px;color:#5d6965;margin:0">Didn't ask for this? You can ignore this email.</p>
</div>`;

const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Subjects can hold guests' names and album titles: no line breaks, and non-English text encoded. */
const encodeSubject = (t: string) => {
  const one = t.replace(/[\r\n]+/g, " ").slice(0, 150);
  return /^[\x20-\x7e]*$/.test(one) ? one : `=?UTF-8?B?${Buffer.from(one).toString("base64")}?=`;
};

export async function sendMail({ to, subject, text, html }: { to: string; subject: string; text: string; html?: string }) {
  const body = html ?? `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(text)}</div>`;
  const binding = process.env.NODE_ENV === "production" ? emailBinding() : null;
  const user = setting("SMTP_USER");
  const pass = setting("SMTP_PASS");
  let refused: unknown = null;
  if (binding && (Date.now() >= cloudflareFullUntil || !user || !pass)) {
    try {
      await binding.send({
        from: { email: setting("SMTP_FROM") || "me@dealwithmuhammad.com", name: "DWM Clip" },
        to,
        subject: subject.replace(/[\r\n]+/g, " ").slice(0, 150),
        text,
        html: body,
      });
      return;
    } catch (e) {
      refused = e;
      if (isLimit(e)) cloudflareFullUntil = Date.now() + 10 * 60_000;
      console.error("Cloudflare email refused", (e as { code?: string })?.code ?? "", e);
    }
  } else if (binding) {
    refused = new MailLimitError("Cloudflare's daily quota is used up");
  }
  if (!user || !pass) {
    if (refused) throw isLimit(refused) ? new MailLimitError(String(refused)) : refused;
    if (process.env.NODE_ENV === "production") throw new Error("SMTP_USER and SMTP_PASS are not set");
    console.log(`[dev] email to ${to}: ${subject}\n${text}`);
    return;
  }
  const host = setting("SMTP_HOST") || "smtp.gmail.com";
  const from = setting("SMTP_FROM") || user;
  const boundary = randomBytes(12).toString("hex");
  const part = (type: string, body: string) => `--${boundary}\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body).toString("base64").replace(/.{76}/g, "$&\r\n")}\r\n`;
  const message = [
    `From: DWM Clip <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${boundary}@dealwithmuhammad.com>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    part("text/plain", text) + part("text/html", body) + `--${boundary}--`,
    ".",
  ].join("\r\n");
  try {
    await smtp(host, [
      ["EHLO dealwithmuhammad.com", 250],
      [`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString("base64")}`, 235],
      [`MAIL FROM:<${user}>`, 250],
      [`RCPT TO:<${to}>`, 250],
      ["DATA", 354],
      [message, 250],
      ["QUIT", 221],
    ]);
  } catch (e) {
    console.error("Gmail email refused", e);
    // Both services said no: say so when either one was out of its daily allowance.
    if (isLimit(e) || (refused && isLimit(refused))) throw new MailLimitError(e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export function sendCode(to: string, code: string, link: string) {
  return sendMail({
    to,
    subject: `Your DWM Clip code: ${code}`,
    text: `Your DWM Clip sign-in code is ${code}. It works for 10 minutes.\n\nOr sign in with this link on this device: ${link}\n\nDidn't ask for this? You can ignore this email.`,
    html: page(code, link),
  });
}

/** The first admin email, where notifications go. */
export const adminEmail = () => setting("ADMIN_EMAILS").split(",")[0]?.trim() || null;

/** A short SMTP conversation over TLS: each line sent must get the expected reply code. */
function smtp(host: string, steps: [line: string, expect: number][]) {
  return new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port: 465, servername: host });
    const timer = setTimeout(() => done(new Error("SMTP timed out")), 15_000);
    let buffer = "";
    let step = -1; // Waiting for the server's greeting.
    function done(e?: Error) {
      clearTimeout(timer);
      socket.destroy();
      if (e) reject(e);
      else resolve();
    }
    socket.on("error", done);
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      // A reply is complete at a line like "250 OK" (not "250-more to come").
      const lines = buffer.split("\r\n");
      const last = lines.findLast((l) => /^\d{3} /.test(l));
      if (!last) return;
      buffer = "";
      const expected = step < 0 ? 220 : steps[step][1];
      if (Number(last.slice(0, 3)) !== expected) return done(new Error(`SMTP step ${step} got: ${last.slice(0, 120)}`));
      step++;
      if (step === steps.length) return done();
      socket.write(`${steps[step][0]}\r\n`);
    });
  });
}
