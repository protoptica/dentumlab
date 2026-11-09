import nodemailer from "npm:nodemailer@10.4.0";
import { accountMail, mailSender } from "./account-mail.ts";

export function mailTransport() {
  const pass = Deno.env.get("SMTP_PASSWORD");
  if (!pass) return null;
  return nodemailer.createTransport({
    host: "smtp.yandex.ru",
    port: 465,
    secure: true,
    auth: { user: mailSender, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    logger: false,
    debug: false,
  });
}

export async function sendAccountMail(email: string, password: string) {
  const transport = mailTransport();
  if (!transport) return "not_configured";
  try {
    const result = await transport.sendMail(accountMail(email, password));
    return result.accepted?.length && !result.rejected?.length
      ? "sent"
      : "failed";
  } catch {
    // SMTP exceptions may include credentials or message content. Do not log them.
    return "failed";
  } finally {
    transport.close();
  }
}
