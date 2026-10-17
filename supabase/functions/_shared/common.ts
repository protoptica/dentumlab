import { createClient } from "npm:@supabase/supabase-js@2";
export const admin = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_ORIGIN") || "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
export function secretEquals(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++)
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
export async function telegram(method: string, body: object | FormData) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) throw Error("Telegram не настроен");
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers:
        body instanceof FormData ? {} : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    },
  );
  const data = await response.json();
  if (!data.ok) throw Error("Операция Telegram не выполнена");
  return data.result;
}
export async function telegramFile(fileId: string) {
  const f = await telegram("getFile", { file_id: fileId });
  if (f.file_size > 20 * 1024 * 1024) throw Error("Файл больше 20 МБ");
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const response = await fetch(
    `https://api.telegram.org/file/bot${token}/${f.file_path}`,
    { signal: AbortSignal.timeout(45000) },
  );
  if (!response.ok) throw Error("Оригинал недоступен в Telegram");
  const blob = await response.blob();
  if (blob.size > 20 * 1024 * 1024) throw Error("Файл больше 20 МБ");
  return blob;
}
export async function userClient(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!token) throw Error("Требуется вход");
  const db = admin();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw Error("Требуется вход");
  return { db, user: data.user };
}
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
