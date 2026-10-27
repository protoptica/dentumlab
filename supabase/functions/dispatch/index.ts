import {
  admin,
  json,
  secretEquals,
  telegram,
  telegramFile,
} from "../_shared/common.ts";
Deno.serve(async (req) => {
  if (
    !secretEquals(
      req.headers.get("Authorization") || "",
      "Bearer " + (Deno.env.get("DISPATCH_SECRET") || ""),
    ) ||
    !Deno.env.get("DISPATCH_SECRET")
  )
    return json({ error: "Нет доступа" }, 403);
  const db = admin();
  let done = 0;
  for (const kind of ["reply", "archive"]) {
    const { data: j, error } = await db.rpc("claim_job", { p_kind: kind });
    if (error || !j) continue;
    try {
      if (kind === "reply") {
        if (j.payload.message_id) {
          const response = await fetch(
            `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}/editMessageText`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(j.payload),
              signal: AbortSignal.timeout(45000),
            },
          );
          const result = await response.json();
          if (
            !result.ok &&
            !String(result.description).includes("message is not modified")
          )
            throw Error("Не удалось обновить карточку Telegram");
        } else await telegram("sendMessage", j.payload);
        await db.rpc("finish_job", { p_id: j.id, p_token: j.lease_token });
        done++;
        continue;
      }
      const { data: d, error: e } = await db
        .from("document")
        .select("*")
        .eq("id", j.document_id)
        .single();
      if (e) throw Error("Документ недоступен");
      const archive = Deno.env.get("TELEGRAM_ARCHIVE_CHAT_ID");
      if (!archive) throw Error("Не настроен архивный чат");
      // Hash before queuing recognition, including uploads from the website.
      let source: Blob;
      if (d.file_id) source = await telegramFile(d.file_id);
      else {
        const downloaded = await db.storage
          .from("incoming")
          .download(d.storage_path);
        if (downloaded.error || !downloaded.data)
          throw Error("Временный файл недоступен");
        source = downloaded.data;
      }
      if (source.size > 20 * 1024 * 1024) throw Error("Файл больше 20 МБ");
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await source.arrayBuffer()),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      let archived;
      if (d.file_id) {
        try {
          const copied = await telegram("copyMessage", {
            chat_id: archive,
            from_chat_id: d.chat_id,
            message_id: d.message_id,
          });
          archived = {
            chat: { id: archive },
            message_id: copied.message_id,
            document: { file_id: d.file_id },
          };
        } catch {
          const file = source;
          const body = new FormData();
          body.append("chat_id", archive);
          body.append("document", file, d.name);
          archived = await telegram("sendDocument", body);
        }
      } else {
        const { data: file, error } = await db.storage
          .from("incoming")
          .download(d.storage_path);
        if (error || !file) throw Error("Временный файл недоступен");
        if (file.size > 20 * 1024 * 1024) throw Error("Файл больше 20 МБ");
        const body = new FormData();
        body.append("chat_id", archive);
        body.append("document", file, d.name);
        archived = await telegram("sendDocument", body);
      }
      const fileId =
        archived.document?.file_id || archived.photo?.at(-1)?.file_id;
      if (!fileId) throw Error("Архив не вернул идентификатор файла");
      const result = await db.rpc("complete_archive_checked", {
        p_hash: hash,
        p_job: j.id,
        p_token: j.lease_token,
        p_file: fileId,
        p_chat: archived.chat.id,
        p_message: archived.message_id,
      });
      if (result.error || !result.data)
        throw Error("Не удалось сохранить архивные идентификаторы");
      if (d.storage_path) {
        const removed = await db.storage
          .from("incoming")
          .remove([d.storage_path]);
        if (!removed.error)
          await db
            .from("document")
            .update({ storage_path: null })
            .eq("id", d.id);
      }
      done++;
    } catch (e) {
      await db.rpc("finish_job", {
        p_id: j.id,
        p_token: j.lease_token,
        p_error: e instanceof Error ? e.message : "Ошибка обработки",
      });
    }
  }
  // Delete only preview copies older than one hour and uploads already archived.
  const { data: old } = await db
    .schema("public")
    .from("document")
    .select("id,storage_path")
    .eq("archive_status", "saved")
    .not("storage_path", "is", null)
    .limit(10);
  for (const d of old || []) {
    const r = await db.storage.from("incoming").remove([d.storage_path]);
    if (!r.error)
      await db.from("document").update({ storage_path: null }).eq("id", d.id);
  }
  const { data: previews } = await db.storage
    .from("previews")
    .list("", { limit: 100, sortBy: { column: "created_at", order: "asc" } });
  const expired = (previews || [])
    .filter(
      (f) => f.created_at && Date.parse(f.created_at) < Date.now() - 3600000,
    )
    .map((f) => f.name);
  if (expired.length) await db.storage.from("previews").remove(expired);
  return json({ processed: done });
});
