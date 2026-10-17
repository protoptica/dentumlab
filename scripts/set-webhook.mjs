const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, SUPABASE_URL } =
  process.env;
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET || !SUPABASE_URL)
  throw Error("Заполните переменные окружения Telegram и Supabase");
try {
  const r = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/telegram-webhook",
        secret_token: TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message"],
        drop_pending_updates: false,
      }),
    },
  );
  const result = await r.json();
  if (!result.ok) throw Error("Telegram отклонил настройку");
  console.log("Webhook настроен");
} catch {
  console.error("Не удалось настроить webhook. Проверьте переменные и сеть.");
  process.exitCode = 1;
}
