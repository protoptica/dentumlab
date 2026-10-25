import { createClient, Session } from "@supabase/supabase-js";
import {
  Data,
  Invoice,
  Material,
  emptyData,
  uid,
  validateInvoice,
} from "./domain";
import { demoData } from "./demo";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export const isDemo = !supabase;
let cacheKey = "demo",
  labId = "";
let cacheEpoch = 0;
const identityKey = (id: string) => "dentum-lab:" + id;
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("dentum-procurement", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("snapshots");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function cache(
  data?: Data,
  remove = false,
): Promise<Data | undefined> {
  const epoch = cacheEpoch,
    selectedKey = cacheKey;
  const db = await database();
  if (epoch !== cacheEpoch) {
    db.close();
    return undefined;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      "snapshots",
      data || remove ? "readwrite" : "readonly",
    );
    const store = tx.objectStore("snapshots");
    if (data) data.synced_at = new Date().toISOString();
    const r = remove
      ? store.delete(selectedKey)
      : data
        ? store.put(data, selectedKey)
        : store.get(selectedKey);
    tx.oncomplete = () => {
      db.close();
      resolve(data ?? r.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function clearSessionCache() {
  cacheEpoch++;
  const user = cacheKey.split(":")[0];
  localStorage.removeItem(identityKey(user));
  await cache(undefined, true);
  cacheKey = "signed-out";
  labId = "";
}
export async function signOut() {
  await clearSessionCache();
  await supabase?.auth.signOut();
}
export async function initialize(session: Session | null) {
  if (!supabase) return;
  if (cacheKey.includes(":") && !cacheKey.startsWith(session!.user.id + ":"))
    await clearSessionCache();
  cacheKey = session?.user.id || "signed-out";
  const prior = localStorage.getItem(identityKey(session!.user.id));
  if (!navigator.onLine && prior) {
    labId = prior;
    cacheKey = `${session!.user.id}:${labId}`;
    return;
  }
  const { data, error } = await supabase
    .from("lab_member")
    .select("lab_id")
    .eq("user_id", session!.user.id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw Error(
      "У вашей учётной записи нет доступа к лаборатории. Обратитесь к администратору.",
    );
  labId = data.lab_id;
  localStorage.setItem(identityKey(session!.user.id), labId);
  cacheKey = `${session!.user.id}:${labId}`;
}
export async function load(): Promise<Data> {
  if (!supabase) return (await cache()) || emptyData();
  const scope = cacheKey;
  const { data, error } = await supabase.rpc("app_snapshot", { p_lab: labId });
  if (error) throw error;
  if (scope !== cacheKey) throw Error("Сессия изменена");
  await cache(data);
  return data;
}
export async function demoReset(withExamples: boolean) {
  const d = withExamples ? demoData() : emptyData();
  await cache(d);
  return d;
}
export async function saveInvoice(
  data: Data,
  invoice: Invoice,
  confirmed: boolean,
): Promise<Data> {
  validateInvoice(invoice);
  if (supabase) {
    const { error } = await supabase.rpc("save_invoice", {
      p_lab: labId,
      p_invoice: invoice,
      p_confirm: confirmed,
    });
    if (error) throw Error(error.message);
    return load();
  }
  const old = data.invoices.find((i) => i.id === invoice.id);
  if (old && old.version !== invoice.version)
    throw Error("Счёт уже изменён. Обновите данные.");
  const next = structuredClone(data);
  const i = structuredClone(invoice);
  i.status = confirmed
    ? "confirmed"
    : old?.status === "confirmed"
      ? "confirmed"
      : "review";
  i.version = (old?.version || 0) + 1;
  for (const l of i.lines) {
    if (!l.material_id && confirmed) {
      const m: Material = {
        id: uid(),
        name: l.name,
        category: l.category || "Без категории",
        manufacturer: "",
        sku: "",
        unit: l.base_unit || l.unit,
        pack: l.factor ? `${l.factor} ${l.base_unit || l.unit}` : "",
        properties: "",
        version: 1,
      };
      next.materials.push(m);
      l.material_id = m.id;
    }
  }
  next.invoices = next.invoices.filter((v) => v.id !== i.id).concat(i);
  next.audit.unshift({
    id: uid(),
    created_at: new Date().toISOString(),
    action: confirmed ? "Счёт подтверждён" : "Счёт сохранён",
    entity_id: i.id,
    before: old,
    after: i,
  });
  await cache(next);
  return next;
}
export async function saveMaterial(data: Data, m: Material) {
  if (supabase) {
    const { error } = await supabase.rpc("save_material", {
      p_lab: labId,
      p_material: m,
    });
    if (error) throw Error(error.message);
    return load();
  }
  const old = data.materials.find((x) => x.id === m.id);
  if (
    old &&
    old.unit !== m.unit &&
    data.invoices.some((i) => i.lines.some((l) => l.material_id === m.id))
  )
    throw Error(
      "Нельзя менять базовую единицу материала с историей. Создайте отдельную карточку",
    );
  if (old && old.version !== m.version)
    throw Error("Карточка уже изменена. Обновите данные.");
  const next = structuredClone(data);
  next.materials = next.materials
    .filter((x) => x.id !== m.id)
    .concat({ ...m, version: m.version + 1 });
  next.audit.unshift({
    id: uid(),
    created_at: new Date().toISOString(),
    action: "Материал изменён",
    entity_id: m.id,
    before: old,
    after: m,
  });
  await cache(next);
  return next;
}
export async function addSupplier(data: Data, name: string, inn: string) {
  const s = { id: uid(), name, inn };
  if (supabase) {
    const { error } = await supabase
      .from("supplier")
      .insert({ ...s, lab_id: labId });
    if (error) throw error;
    return load();
  }
  const next = { ...data, suppliers: [...data.suppliers, s] };
  await cache(next);
  return next;
}
export async function upload(file: File) {
  if (file.size > 20 * 1024 * 1024) throw Error("Файл больше 20 МБ");
  if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type))
    throw Error("Поддерживаются PDF, JPG и PNG");
  if (!supabase)
    throw Error(
      "Для загрузки документов подключите Supabase и Telegram. В деморежиме можно создать счёт вручную.",
    );
  const path = `${labId}/${uid()}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error } = await supabase.storage
    .from("incoming")
    .upload(path, file, { contentType: file.type });
  if (error) throw error;
  const result = await supabase.rpc("register_upload", {
    p_lab: labId,
    p_path: path,
    p_name: file.name,
    p_size: file.size,
  });
  if (result.error) {
    await supabase.storage.from("incoming").remove([path]);
    throw result.error;
  }
}
export async function retry(id: string) {
  if (!supabase) return;
  const { error } = await supabase.rpc("retry_document", {
    p_lab: labId,
    p_document: id,
  });
  if (error) throw error;
}
export async function original(documentId: string): Promise<string> {
  if (!supabase) throw Error("В демонстрационных счетах нет оригиналов");
  const { data, error } = await supabase.functions.invoke("document-access", {
    body: { document_id: documentId },
  });
  if (error) {
    let message = "Не удалось получить оригинал";
    try {
      const response = await error.context.json();
      if (typeof response.error === "string") message = response.error;
    } catch {}
    throw Error(message);
  }
  if (data.error) throw Error(data.error);
  return data.url;
}
export async function moveLines(
  data: Data,
  source: Material,
  target: string,
  newName: string,
  lineIds: string[],
  factor: string,
) {
  const versions = Object.fromEntries(
    data.invoices
      .filter((i) => i.lines.some((l) => lineIds.includes(l.id)))
      .map((i) => [i.id, i.version]),
  );
  if (supabase) {
    const { error } = await supabase.rpc("move_material_lines", {
      p_lab: labId,
      p_source: source.id,
      p_target: target || null,
      p_new_name: newName,
      p_lines: lineIds,
      p_versions: versions,
      p_factor: factor || null,
    });
    if (error) throw Error(error.message);
    return load();
  }
  const next = structuredClone(data);
  let dest = next.materials.find((m) => m.id === target);
  if (!dest) {
    if (!newName.trim()) throw Error("Укажите название нового материала");
    dest = { ...source, id: uid(), name: newName, version: 1 };
    next.materials.push(dest);
  }
  if (dest.unit !== source.unit)
    throw Error("Базовые единицы должны совпадать");
  if (factor && (!/^\d+(\.\d{1,3})?$/.test(factor) || Number(factor) <= 0))
    throw Error("Проверьте коэффициент фасовки");
  const before = data.invoices
    .flatMap((i) => i.lines)
    .filter((l) => lineIds.includes(l.id));
  if (!before.length) throw Error("Выберите строки");
  for (const i of next.invoices) {
    if (i.lines.some((l) => lineIds.includes(l.id))) {
      i.version++;
      i.lines = i.lines.map((l) =>
        lineIds.includes(l.id)
          ? {
              ...l,
              material_id: dest!.id,
              category: dest!.category,
              factor: factor || l.factor,
            }
          : l,
      );
    }
  }
  const after = next.invoices
    .flatMap((i) => i.lines)
    .filter((l) => lineIds.includes(l.id));
  next.audit.unshift({
    id: uid(),
    created_at: new Date().toISOString(),
    action: "Связи материалов и фасовка изменены",
    entity_id: source.id,
    before: { lines: before },
    after: {
      lines: after,
      versions: Object.fromEntries(
        next.invoices
          .filter((i) => i.id in versions)
          .map((i) => [i.id, i.version]),
      ),
    },
  });
  await cache(next);
  return next;
}
export async function undoMove(data: Data, eventId: string) {
  if (supabase) {
    const { error } = await supabase.rpc("undo_material_move", {
      p_lab: labId,
      p_event: eventId,
    });
    if (error) throw Error(error.message);
    return load();
  }
  const event = data.audit.find((a) => a.id === eventId);
  if (!event) throw Error("Операция не найдена");
  if (
    data.audit.some(
      (a) => a.action === "Связи восстановлены" && a.entity_id === eventId,
    )
  )
    throw Error("Операция уже отменена");
  const before = event.before as { lines: Invoice["lines"] },
    after = event.after as { versions: Record<string, number> };
  for (const [id, v] of Object.entries(after.versions)) {
    if (data.invoices.find((i) => i.id === id)?.version !== v)
      throw Error(
        "После операции счёт изменился. Автоматическая отмена недоступна",
      );
  }
  const next = structuredClone(data);
  next.invoices = next.invoices.map((i) =>
    i.id in after.versions
      ? {
          ...i,
          version: i.version + 1,
          lines: i.lines.map(
            (l) => before.lines.find((old) => old.id === l.id) || l,
          ),
        }
      : i,
  );
  next.audit.unshift({
    id: uid(),
    created_at: new Date().toISOString(),
    action: "Связи восстановлены",
    entity_id: eventId,
    before: event.after,
    after: event.before,
  });
  await cache(next);
  return next;
}
export async function archiveInvoice(data: Data, i: Invoice) {
  if (supabase) {
    const { error } = await supabase.rpc("archive_invoice", {
      p_lab: labId,
      p_id: i.id,
      p_version: i.version,
    });
    if (error) throw Error(error.message);
    return load();
  }
  const next = structuredClone(data);
  const row = next.invoices.find((x) => x.id === i.id);
  if (!row || row.version !== i.version) throw Error("Счёт уже изменён");
  row.status = "archived";
  row.version++;
  next.audit.unshift({
    id: uid(),
    created_at: new Date().toISOString(),
    action: "Счёт архивирован",
    entity_id: i.id,
    before: i,
    after: row,
  });
  await cache(next);
  return next;
}

export async function declineInvoice(data: Data, i: Invoice) {
  if (supabase) {
    const { error } = await supabase.rpc("decline_invoice", {
      p_lab: labId,
      p_id: i.id,
      p_version: i.version,
    });
    if (error) throw Error(error.message);
    return load();
  }
  const next = structuredClone(data);
  const row = next.invoices.find((x) => x.id === i.id);
  if (!row || row.version !== i.version) throw Error("Счёт уже изменён");
  const before = structuredClone(row);
  row.status = "declined";
  row.version++;
  const doc = next.documents.find((d) => d.id === row.document_id);
  if (doc) doc.status = "declined";
  next.audit.unshift({
    id: uid(),
    created_at: new Date().toISOString(),
    action: "Счёт отклонён",
    entity_id: i.id,
    before,
    after: structuredClone(row),
  });
  await cache(next);
  return next;
}
