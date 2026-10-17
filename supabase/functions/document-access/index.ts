import { cors, json, userClient, telegramFile } from "../_shared/common.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { db, user } = await userClient(req);
    const { document_id } = await req.json();
    const { data: d } = await db
      .from("document")
      .select("lab_id,file_id,name")
      .eq("id", document_id)
      .single();
    if (!d) return json({ error: "Документ не найден" }, 404);
    const { data: member } = await db
      .from("lab_member")
      .select("lab_id")
      .eq("lab_id", d.lab_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) return json({ error: "Нет доступа" }, 403);
    if (!d.file_id)
      return json({ error: "Оригинал ещё не сохранён в архиве" }, 409);
    const file = await telegramFile(d.file_id);
    const ext = d.name.toLowerCase().endsWith(".pdf")
      ? "pdf"
      : d.name.toLowerCase().endsWith(".png")
        ? "png"
        : "jpg";
    const type =
      ext === "pdf"
        ? "application/pdf"
        : ext === "png"
          ? "image/png"
          : "image/jpeg";
    const path = crypto.randomUUID() + "." + ext;
    const { error } = await db.storage
      .from("previews")
      .upload(path, file, { contentType: type });
    if (error) throw Error("Не удалось подготовить оригинал");
    const { data, error: err } = await db.storage
      .from("previews")
      .createSignedUrl(path, 300);
    if (err) throw Error("Не удалось открыть оригинал");
    return json({ url: data.signedUrl, expires_in: 300 });
  } catch {
    return json(
      { error: "Оригинал недоступен. Проверьте вход и Telegram-архив." },
      400,
    );
  }
});
