import { admin, json, digest, telegramFile } from "../_shared/common.ts";
Deno.serve(async (req) => {
  const token = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!token) return json({ error: "Нет доступа" }, 403);
  const db = admin();
  const { data: cred } = await db
    .from("worker_credential")
    .select("lab_id")
    .eq("token_hash", await digest(token))
    .eq("revoked", false)
    .maybeSingle();
  if (!cred) return json({ error: "Нет доступа" }, 403);
  try {
    const body = await req.json();
    if (body.action === "health") return json({ ok: true });
    if (body.action === "claim") {
      const { data, error } = await db.rpc("claim_job", {
        p_kind: "extract",
        p_lab: cred.lab_id,
      });
      if (error) throw Error("Не удалось получить задание");
      return json(data);
    }
    const { data: j } = await db
      .from("job")
      .select("*")
      .eq("id", body.job_id)
      .eq("lab_id", cred.lab_id)
      .eq("kind", "extract")
      .eq("state", "running")
      .eq("lease_token", body.lease_token)
      .gt("lease_until", new Date().toISOString())
      .maybeSingle();
    if (!j) return json({ error: "Аренда задания истекла" }, 409);
    if (body.action === "download") {
      const { data: d } = await db
        .from("document")
        .select("file_id")
        .eq("id", j.document_id)
        .single();
      if (!d?.file_id) throw Error("Оригинал не найден");
      const blob = await telegramFile(d.file_id);
      return new Response(blob, {
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
    if (body.action === "renew") {
      const { error } = await db
        .from("job")
        .update({ lease_until: new Date(Date.now() + 600000).toISOString() })
        .eq("id", j.id)
        .eq("lease_token", body.lease_token);
      if (error) throw Error("Не удалось продлить аренду");
      return json({ ok: true });
    }
    if (body.action === "complete") {
      if (!/^[a-f0-9]{64}$/.test(body.hash)) throw Error("Некорректный хеш");
      const { data, error } = await db.rpc("complete_extraction", {
        p_job: j.id,
        p_token: body.lease_token,
        p_hash: body.hash,
        p_result: body.result,
      });
      if (error || !data)
        throw Error("Результат не сохранён. Проверьте строки и аренду задания");
      return json({ ok: true });
    }
    if (body.action === "fail") {
      await db.rpc("finish_job", {
        p_id: j.id,
        p_token: body.lease_token,
        p_error: String(body.error || "Ошибка распознавания").slice(0, 300),
      });
      return json({ ok: true });
    }
    return json({ error: "Неизвестная операция" }, 400);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Ошибка обработки" },
      400,
    );
  }
});
