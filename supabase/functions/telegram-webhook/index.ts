import { admin, json, secretEquals, telegram } from "../_shared/common.ts";
Deno.serve(async (req) => {
  if (req.method !== "POST")
    return json({ error: "Метод не поддерживается" }, 405);
  if (
    !secretEquals(
      req.headers.get("X-Telegram-Bot-Api-Secret-Token") || "",
      Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "",
    )
  )
    return json({ error: "Нет доступа" }, 403);
  try {
    const update = await req.json();
    const callback = update.callback_query;
    const m = callback
      ? {
          ...callback.message,
          from: callback.from,
          text: callback.data,
          document: undefined,
          photo: undefined,
        }
      : update.message;
    const db = admin();
    if (!m?.from?.id) return json({ ok: true });
    const { data: user } = await db
      .from("telegram_user")
      .select("lab_id")
      .eq("telegram_id", m.from.id)
      .maybeSingle();
    if (!user) {
      if (callback)
        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "Нет доступа",
        }).catch(() => {});
      return json({ ok: true });
    }
    const f = m.document || m.photo?.at(-1);
    if (f) {
      const { error } = await db.rpc("ingest_telegram", {
        p_update: update.update_id,
        p_telegram: m.from.id,
        p_chat: m.chat.id,
        p_message: m.message_id,
        p_file: f.file_id,
        p_unique: f.file_unique_id,
        p_name: f.file_name || "Фото.jpg",
        p_size: f.file_size || 0,
      });
      if (error) return json({ error: "Приём временно недоступен" }, 503);
    } else {
      const { error } = await db.rpc("ingest_telegram_command", {
        p_update: update.update_id,
        p_telegram: m.from.id,
        p_chat: m.chat.id,
        p_text: String(m.text || ""),
        p_site: Deno.env.get("SITE_ORIGIN") || "",
      });
      if (error) return json({ error: "Приём временно недоступен" }, 503);
    }
    if (callback)
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
      }).catch(() => {});
    // A periodic dispatch invocation also retries this durable queue if this invocation ends early.
    const task = fetch(
      Deno.env.get("SUPABASE_URL") + "/functions/v1/dispatch",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + Deno.env.get("DISPATCH_SECRET") },
      },
    ).catch(() => {});
    EdgeRuntime.waitUntil(task);
    return json({ ok: true });
  } catch {
    return json({ error: "Приём временно недоступен" }, 503);
  }
});
